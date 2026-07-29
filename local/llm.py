"""Thin stdlib clients for the local model servers.

ollama (Vulkan, GPU) serves the chat model and the embedder; llama.cpp
(CPU) serves the reranker. Everything is plain urllib against their REST
APIs so the local bot needs no pip packages beyond the numpy/pyyaml already
on the machine.
"""
import json
import urllib.request
import urllib.error


class LLMError(RuntimeError):
    pass


def _post(url, payload, timeout=600):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return urllib.request.urlopen(req, timeout=timeout)


def embed(cfg, texts):
    """Embed a batch of strings with the ollama embedder. Returns a list of
    float lists, one per input, in order. bge-m3 is 1024-dim."""
    if not texts:
        return []
    try:
        resp = _post(cfg["ollama_url"] + "/api/embed",
                     {"model": cfg["embed_model"], "input": texts})
        data = json.loads(resp.read())
    except urllib.error.URLError as e:
        raise LLMError(f"embed failed ({cfg['embed_model']}): {e}")
    vecs = data.get("embeddings")
    if not vecs or len(vecs) != len(texts):
        raise LLMError("embed returned the wrong count")
    return vecs


def rerank(cfg, query, documents):
    """Score documents against the query with the llama.cpp reranker.
    Returns a list of scores aligned to `documents`, or None if the rerank
    server is unreachable (the caller then falls back to fusion order)."""
    if not documents:
        return []
    try:
        resp = _post(cfg["rerank_url"] + "/rerank",
                     {"model": "reranker", "query": query,
                      "documents": documents, "top_n": len(documents)},
                     timeout=120)
        data = json.loads(resp.read())
    except (urllib.error.URLError, OSError):
        return None
    scores = [0.0] * len(documents)
    for r in data.get("results", []):
        idx = r.get("index")
        if isinstance(idx, int) and 0 <= idx < len(documents):
            scores[idx] = r.get("relevance_score", r.get("score", 0.0))
    return scores


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
