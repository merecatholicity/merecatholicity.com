#!/usr/bin/env python3
"""merecat-local as an always-on HTTP service, so the Cloudflare worker can
proxy questions to this machine over Tailscale Funnel.

It speaks a tiny contract the worker understands: POST /ask with a shared key,
body {q, history?, summary?}, and it streams back one JSON line of sources, a
blank line, then the answer tokens (reasoning stripped). Only requests bearing
the shared key are served, so exposed on Funnel it still answers no one but the
worker. GET /health is open (for Funnel/uptime checks).

    python local/serve.py            # foreground
    (usually run under the systemd user service — see README)
"""
import hmac
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import llm          # noqa: E402
import retrieve     # noqa: E402

CFG = yaml.safe_load(open(os.path.join(HERE, "mc_config.yml")))
PERSONA_PATH = os.path.join(HERE, CFG.get("persona_file", "persona.local.md"))
DB_PATH = os.path.join(HERE, CFG["data_dir"], "chunks.sqlite")
VEC_PATH = os.path.join(HERE, CFG["data_dir"], "vectors.npy")
PORT = int(CFG.get("serve_port", 8790))


def shared_key():
    p = os.path.join(HERE, "serve.key")
    if os.path.exists(p):
        return open(p).read().strip()
    return os.environ.get("MERECAT_LOCAL_KEY", "").strip()


KEY = shared_key()
VECTORS = np.load(VEC_PATH, mmap_mode="r")


def store_answer(chat, msg, answer, sources):
    """Report the finished answer back to the worker so it lands on the thread
    even when the reader has disconnected from the live stream. Server-to-server,
    carrying the shared key; retried a few times so a transient blip is survived.
    `msg` is the user-question msg id — the worker's dedup key, so a retry can
    never double an answer and two generations on one thread can never drop one.
    A no-op with no store_url configured or no chat id, and only ever called for
    1-on-1 chats (mentions are stored worker-side from the fully-read stream)."""
    url = str(CFG.get("store_url", "")).strip()
    if not url or not chat or not answer:
        return
    pub = [{"n": s.get("n"), "title": s.get("title"),
            "heading": s.get("heading"), "url": s.get("url")}
           for s in (sources or [])]
    body = json.dumps({"key": KEY, "chat": chat, "msg": msg or 0,
                       "answer": answer, "sources": pub}).encode()
    last = None
    for i in range(4):
        try:
            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={"Content-Type": "application/json",
                         # Cloudflare's edge 403s the default Python-urllib UA
                         # (ingest.py sets the same for the same reason).
                         "User-Agent": "curl/8.14.1"})
            with urllib.request.urlopen(req, timeout=25) as r:
                r.read()
            return
        except urllib.error.HTTPError as e:
            # a definite server answer: 4xx never heals on retry (bad key,
            # deleted chat) — log and stop; 5xx may be transient, keep trying
            if e.code < 500:
                print(f"store_answer refused ({e.code}) — not retrying", flush=True)
                return
            last = e
            time.sleep(1.5 * (i + 1))
        except Exception as e:  # noqa: BLE001 — network blip, keep retrying
            last = e
            time.sleep(1.5 * (i + 1))
    print(f"store_answer failed after retries: {last}", flush=True)

# One GPU: a single generation at a time (_gpu), a bounded wait-queue behind
# it (_pending, capped at QUEUE_CAP = 1 running + the rest waiting), and an
# immediate busy past that. A waiting request is told how many are ahead.
_gpu = threading.Semaphore(1)
_plock = threading.Lock()
_pending = 0
QUEUE_CAP = int(CFG.get("queue_cap", 3))


def _db():
    # one connection per thread; the file is read-only at serve time
    return sqlite3.connect(DB_PATH, check_same_thread=False)


class ThinkStrip:
    """Streaming filter that drops the model's reasoning: paired <think>…</think>
    anywhere, and a leading reasoning run that ends in a bare </think> (qwen3
    via ollama emits the close tag into content). Holds an ambiguous tail so a
    tag split across chunks is never half-emitted."""
    def __init__(self):
        self.buf = ""
        self.suppress = False

    def feed(self, s):
        self.buf += s
        out = []
        while self.buf:
            if self.suppress:
                j = self.buf.find("</think>")
                if j == -1:
                    keep = 8
                    if len(self.buf) > keep:
                        self.buf = self.buf[-keep:]
                    return "".join(out)
                self.buf = self.buf[j + 8:]
                self.suppress = False
                continue
            i = self.buf.find("<think>")
            if i != -1:
                out.append(self.buf[:i])
                self.buf = self.buf[i + 7:]
                self.suppress = True
                continue
            k = self.buf.find("</think>")     # leading untagged reasoning
            if k != -1:
                out.append("")
                self.buf = self.buf[k + 8:]
                continue
            hold = 0
            for tag in ("<think>", "</think>"):
                for n in range(1, len(tag)):
                    if self.buf.endswith(tag[:n]):
                        hold = max(hold, n)
            if hold:
                out.append(self.buf[:-hold])
                self.buf = self.buf[-hold:]
            else:
                out.append(self.buf)
                self.buf = ""
            return "".join(out)
        return "".join(out)

    def flush(self):
        r = "" if self.suppress else self.buf
        self.buf = ""
        return r


# Reasoning depth. Ollama's think is kept ON always (so qwen3's reasoning
# rides the separate thinking field and never leaks into the answer); the
# depth directive genuinely lengthens or shortens how much it reasons, and
# 'off' asks it to answer directly. True speed is the Instant→Cloudflare path.
DEPTH = {
    "off": "Answer directly and concisely, without extended deliberation.",
    "low": "Think briefly before you answer.",
    "medium": "",
    "high": "Think carefully and thoroughly before you answer.",
    "xhigh": "Reason at length, weighing several angles and objections, before you answer.",
    "max": "Reason exhaustively, working through objections and counter-arguments from the sources, before you answer.",
}


def build_messages(q, history, summary, context, effort):
    """Compose the prompt the same way the Cloudflare worker does, so both bots
    see identical context. `context` is an opaque block the worker builds for
    @merecat mentions (the thread/page brief + reply instructions); `history`
    and `summary` carry a 1-on-1 chat thread. Local always does its own (whole
    corpus) retrieval for the sources."""
    persona = open(PERSONA_PATH).read().strip()
    db = _db()
    chunks = retrieve.retrieve(db, VECTORS, CFG, q)
    db.close()
    sources = [{"n": i + 1, "title": c["title"], "heading": c["heading"],
                "url": retrieve.source_url(CFG, c), "tier": c["tier"], "text": c["text"]}
               for i, c in enumerate(chunks)]
    block = ""
    for s in sources:
        loc = f" — {s['heading']}" if s["heading"] else ""
        block += (f"[{s['n']}] ({retrieve.TIER_LABEL.get(s['tier'],'shelf')}) "
                  f"{s['title']}{loc}\n{s['text']}\n\n")
    sys_prompt = persona
    if summary:
        sys_prompt += "\n\nTHE CONVERSATION SO FAR, condensed:\n" + summary
    if context:
        sys_prompt += "\n\n" + str(context)
    sys_prompt += ("\n\nSOURCES (cite by bracketed number, like [3] — write the "
                   "digit; cite 2-4 distinct sources for an answer of 250-500 "
                   "words and 4-8 for 500 words and beyond, spreading them "
                   "across every source that genuinely informed the answer "
                   "rather than leaning on one or two; these are the only "
                   "citable sources this turn):\n\n"
                   + (block or "(none)"))
    d = DEPTH.get(effort, "")
    if d:
        sys_prompt += "\n\n" + d
    messages = [{"role": "system", "content": sys_prompt}]
    for h in (history or []):
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:1200]})
    messages.append({"role": "user", "content": q})
    pub = [{"n": s["n"], "title": s["title"], "heading": s["heading"], "url": s["url"]}
           for s in sources]
    return messages, pub


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "chunks": int(VECTORS.shape[0]),
                             "model": CFG["chat_model"]})
        else:
            self._json(404, {"ok": False})

    def do_POST(self):
        if self.path != "/ask":
            return self._json(404, {"ok": False})
        got = self.headers.get("X-Merecat-Key", "")
        if not KEY or not hmac.compare_digest(got, KEY):
            return self._json(403, {"ok": False, "error": "No."})
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "Bad request."})
        q = str(data.get("q", "")).strip()[:2000]
        if not q:
            return self._json(400, {"ok": False, "error": "Bad request."})
        effort = str(data.get("effort", "high"))
        context = data.get("context") or ""
        chat = data.get("chat")   # 1-on-1 thread id; present → store the answer
        msg = data.get("msg")     # the question's msg id — the /store dedup key

        # Queue admission: past the cap, refuse at once (with the count ahead)
        # so nothing piles onto the GPU; within it, we will wait our turn.
        global _pending
        with _plock:
            if _pending >= QUEUE_CAP:
                return self._json(503, {"ok": False, "busy": True, "ahead": _pending,
                    "error": "The local librarian is answering others right now. Try again in a moment."})
            position = _pending
            _pending += 1

        # Close-delimited stream (Connection: close) — a proxy in front plus
        # http.server keep-alive choked on manual chunked framing.
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        # The reader (a browser, through the worker) may vanish mid-answer. When
        # it does, writes fail — so emit() is best-effort and never raises: we
        # keep generating to the end and store the answer by callback, so a
        # thread is never left with a question and no reply.
        client_gone = [False]

        def emit(s):
            if not s or client_gone[0]:
                return
            try:
                self.wfile.write(s if isinstance(s, bytes) else s.encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                client_gone[0] = True

        acquired = False
        sources = []
        parts = []
        strip = ThinkStrip()
        try:
            # Tell the caller the line length (0 = no one ahead), then block for
            # the GPU in short rounds, re-emitting the notice as a heartbeat —
            # a deep queue can mean many silent minutes, and an idle proxied
            # stream (worker fetch, Funnel) is what gets reaped, not a slow one.
            emit(json.dumps({"queue": position}) + "\n\n")
            waited = 0
            while waited < 900:
                # a vanished reader with no thread to store to (a mention read
                # whose caller died) has nowhere to deliver — free the slot
                if client_gone[0] and not chat:
                    return
                acquired = _gpu.acquire(timeout=20)
                if acquired:
                    break
                waited += 20
                emit(json.dumps({"queue": position}) + "\n\n")
            if not acquired:
                emit(json.dumps({"sources": []}) + "\n\n")
                emit("The local librarian is overloaded right now. Please try again shortly.")
                return
            try:
                messages, sources = build_messages(
                    q, data.get("history"), data.get("summary"), context, effort)
            except Exception as e:
                emit(json.dumps({"sources": []}) + "\n\n")
                emit(f"(retrieval failed: {e})")
                return
            emit(json.dumps({"sources": sources}) + "\n\n")
            try:
                for kind, delta in llm.chat_stream(CFG, messages, think=True):
                    if kind != "answer":
                        continue
                    vis = strip.feed(delta)
                    if vis:
                        parts.append(vis)
                        emit(vis)
                tail = strip.flush()
                if tail:
                    parts.append(tail)
                    emit(tail)
            except Exception as e:
                # the engine died mid-answer: disclose it on the wire and in
                # anything stored, rather than passing off a truncation as whole
                print(f"ask generation error: {e}", flush=True)
                if parts:
                    note = "\n\n*(the answer was cut short by an engine fault on the librarian's machine)*"
                    parts.append(note)
                    emit(note)
                else:
                    emit("The librarian's engine faltered before the answer began. Please ask again.")
        except Exception as e:  # noqa: BLE001 — never crash the handler thread
            print(f"ask handler error: {e}", flush=True)
        finally:
            if acquired:
                _gpu.release()
            with _plock:
                _pending -= 1

        # Store after releasing the GPU, so a slow callback never blocks the next
        # in line. This is the path that outlives a reader disconnect.
        answer = "".join(parts).strip()
        if chat and answer:
            store_answer(chat, msg, answer, sources)


def main():
    if not KEY:
        sys.exit("no shared key — create local/serve.key or set MERECAT_LOCAL_KEY")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"merecat-local serving on 127.0.0.1:{PORT} "
          f"({VECTORS.shape[0]} chunks, model {CFG['chat_model']})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
