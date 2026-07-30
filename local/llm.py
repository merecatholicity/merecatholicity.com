"""Thin stdlib clients for the local model servers.

ollama (Vulkan, GPU) serves the chat model and the embedder; llama.cpp
(CPU) serves the reranker. Everything is plain urllib against their REST
APIs so the local bot needs no pip packages beyond the numpy/pyyaml already
on the machine.
"""
import json
import sys
import urllib.request
import urllib.error


class LLMError(RuntimeError):
    pass


def _post(url, payload, timeout=600):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return urllib.request.urlopen(req, timeout=timeout)


def embed(cfg, texts, timeout=600):
    """Embed a batch of strings with the ollama embedder. Returns a list of
    float lists, one per input, in order. bge-m3 is 1024-dim."""
    if not texts:
        return []
    try:
        resp = _post(cfg["ollama_url"] + "/api/embed",
                     {"model": cfg["embed_model"], "input": texts},
                     timeout=timeout)
        data = json.loads(resp.read())
    except urllib.error.URLError as e:
        raise LLMError(f"embed failed ({cfg['embed_model']}): {e}")
    vecs = data.get("embeddings")
    if not vecs or len(vecs) != len(texts):
        raise LLMError("embed returned the wrong count")
    return vecs


# ---- Reranking, hardened (2026-07-29 postmortem). llama.cpp scores each
# query+document pair as ONE physical batch, and a single pair past the
# server's batch size fails the WHOLE /rerank request — which once turned
# one 703-token Greek-dense chunk into three "my resources do not address
# this" answers in a row (the pool fell back to fusion order silently).
# Three layers now stand between a fat chunk and a bad answer:
#   1. PREVENT — every query/document is trimmed to a token budget before
#      the request, exactly via the server's own /tokenize when possible,
#      by a conservative estimate when not.
#   2. HEAL — a refused batch is binary-split until the offending document
#      is isolated, that one document is progressively truncated, and only
#      it can ever lose its score; the other 119 rerank normally.
#   3. DISCLOSE — every degradation prints to the journal, and the /health
#      canary (rerank_canary) proves a budget-sized pair end-to-end so a
#      misconfigured server is visible before a member ever hits it.

_PAIR_BUDGET_DEFAULT = 1400   # max query+document tokens we aim for; the
                              # server's physical batch is 2048 (-b/-ub in
                              # the systemd unit) — the gap is headroom for
                              # the template's special tokens and drift.
_QUERY_TOKEN_CAP = 600        # a rerank query never needs more; questions
                              # are capped at 2,000 chars upstream.
_DOC_TOKEN_FLOOR = 256        # a doc is never trimmed below this.
_FAILED_SCORE = -1e9          # a doc the server refused at every length
                              # sorts to the bottom, never to the middle.


class RerankRefused(Exception):
    """The server answered and said no (HTTP error with a body) — a payload
    problem, distinct from an unreachable server."""


def tok_count(cfg, text):
    """Exact token count from the reranker's own tokenizer, or None if the
    /tokenize endpoint is unavailable."""
    try:
        resp = _post(cfg["rerank_url"] + "/tokenize", {"content": text},
                     timeout=15)
        toks = json.loads(resp.read()).get("tokens")
        return len(toks) if isinstance(toks, list) else None
    except (urllib.error.URLError, OSError, ValueError):
        return None


def _est_tokens(text):
    """Tokenizer-free overestimate. English runs ~4 chars/token; Greek and
    Hebrew ~2 chars/token (measured). 2.5 and 1.2 leave a safety margin,
    and the salvage layer catches any text that still beats the estimate."""
    non_ascii = sum(1 for ch in text if ord(ch) > 127)
    return int((len(text) - non_ascii) / 2.5 + non_ascii * 1.2) + 8


def _trim_tokens(cfg, text, budget):
    """Cut text to fit a token budget: proportional cuts checked against the
    real tokenizer (converges in a call or two), estimate-only if /tokenize
    is down. Returns the (possibly shortened) text."""
    if budget <= 0:
        return ""
    for _ in range(4):
        n = tok_count(cfg, text)
        if n is None:
            n = _est_tokens(text)
        if n <= budget:
            return text
        text = text[:max(1, int(len(text) * budget / n * 0.92))]
    return text


def _rerank_call(cfg, query, documents, timeout=120):
    """One raw /rerank POST. Returns scores aligned to documents. Raises
    RerankRefused on an HTTP-level rejection (with the server's own words),
    or URLError/OSError when the server is unreachable."""
    try:
        resp = _post(cfg["rerank_url"] + "/rerank",
                     {"model": "reranker", "query": query,
                      "documents": documents, "top_n": len(documents)},
                     timeout=timeout)
        data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:  # noqa: BLE001
            detail = ""
        raise RerankRefused(f"HTTP {e.code}: {detail or e.reason}") from e
    except ValueError as e:  # a 200 whose body is not JSON
        raise RerankRefused(f"unparseable response: {e}") from e
    if not isinstance(data, dict):
        raise RerankRefused("unexpected response shape")
    scores = [None] * len(documents)
    for r in data.get("results", []):
        idx = r.get("index")
        if isinstance(idx, int) and 0 <= idx < len(documents):
            scores[idx] = r.get("relevance_score", r.get("score", 0.0))
    return [s if s is not None else _FAILED_SCORE for s in scores]


def _salvage(cfg, query, documents):
    """A refused batch: binary-split to isolate the offender(s), then try the
    offender alone at half, quarter, and eighth length. Scores every document
    it possibly can; a document refused at every length gets _FAILED_SCORE.
    Transport errors propagate (the server died — nothing to salvage)."""
    scores = [_FAILED_SCORE] * len(documents)

    def go(lo, hi):
        try:
            part = _rerank_call(cfg, query, documents[lo:hi])
            scores[lo:hi] = part
            return
        except RerankRefused as e:
            if hi - lo > 1:
                mid = (lo + hi) // 2
                go(lo, mid)
                go(mid, hi)
                return
            doc = documents[lo]
            for frac in (0.5, 0.25, 0.12):
                try:
                    scores[lo] = _rerank_call(
                        cfg, query, [doc[:max(1, int(len(doc) * frac))]])[0]
                    print(f"rerank salvage: doc {lo} scored at {frac:.0%} "
                          f"length after refusal ({e})",
                          file=sys.stderr, flush=True)
                    return
                except RerankRefused:
                    continue
            print(f"rerank salvage: doc {lo} refused at every length ({e}); "
                  "scored to the bottom", file=sys.stderr, flush=True)

    go(0, len(documents))
    return scores


def rerank(cfg, query, documents):
    """Score documents against the query with the llama.cpp reranker.
    Returns a list of scores aligned to `documents`, or None only when the
    rerank server is unreachable (the caller then falls back to fusion
    order). A payload the server dislikes is prevented, then salvaged —
    it no longer costs the whole rerank."""
    if not documents:
        return []
    budget = int(cfg.get("rerank_pair_budget", _PAIR_BUDGET_DEFAULT))
    try:
        query = _trim_tokens(cfg, query, min(_QUERY_TOKEN_CAP, budget // 2))
        qtok = tok_count(cfg, query)
        if qtok is None:
            qtok = _est_tokens(query)
        doc_budget = max(_DOC_TOKEN_FLOOR, budget - qtok - 16)
        docs = []
        for d in documents:
            if _est_tokens(d) > doc_budget:
                d = _trim_tokens(cfg, d, doc_budget)
            docs.append(d)
        try:
            return _rerank_call(cfg, query, docs)
        except RerankRefused as e:
            print(f"rerank batch refused ({e}); salvaging per-document",
                  file=sys.stderr, flush=True)
            return _salvage(cfg, query, docs)
    except (urllib.error.URLError, OSError) as err:
        # Loud: a fusion-order answer looks like "my resources do not
        # address this" to the reader, so the cause must reach the journal.
        print(f"rerank unreachable, falling back to fusion order: {err}",
              file=sys.stderr, flush=True)
        return None


def rerank_canary(cfg):
    """Prove the reranker end-to-end at the operating ceiling: one document
    sized to the full pair budget, exactly what a fat retrieval chunk looks
    like. Returns (state, detail): ('ok', ''), ('degraded', why) when the
    server answers but refuses the budget-sized pair (e.g. its physical
    batch was left at the 512 default), or ('down', why)."""
    budget = int(cfg.get("rerank_pair_budget", _PAIR_BUDGET_DEFAULT))
    doc = _trim_tokens(cfg, "kingdom heaven resurrection " * budget,
                       budget - 24)
    try:
        _rerank_call(cfg, "how do I get to heaven", [doc], timeout=30)
        return ("ok", "")
    except RerankRefused as e:
        return ("degraded", str(e))
    except (urllib.error.URLError, OSError) as e:
        return ("down", str(e))


def chat_stream(cfg, messages, think=False):
    """Stream a chat completion from ollama, yielding text deltas. Reasoning
    models (qwen3) emit a separate `thinking` field when think is on; the
    visible answer arrives in message.content either way."""
    payload = {
        "model": cfg["chat_model"],
        "messages": messages,
        "stream": True,
        "think": bool(think),
        "options": {"num_ctx": cfg.get("num_ctx", 16384),
                    # leave cores for the human at the desk: expert tensors
                    # spill to CPU on this card, and unbounded threads peg
                    # all twelve during prompt eval and generation
                    "num_thread": int(cfg.get("num_thread", 8))},
    }
    try:
        resp = _post(cfg["ollama_url"] + "/api/chat", payload, timeout=1800)
    except urllib.error.URLError as e:
        raise LLMError(f"chat failed ({cfg['chat_model']}): {e}")
    for raw in resp:
        raw = raw.strip()
        if not raw:
            continue
        obj = json.loads(raw)
        msg = obj.get("message") or {}
        if think and msg.get("thinking"):
            yield ("think", msg["thinking"])
        # numeric-only deltas arrive as JSON numbers on some backends; coerce
        content = msg.get("content")
        if content is not None and content != "":
            yield ("answer", str(content))
        if obj.get("done"):
            break
