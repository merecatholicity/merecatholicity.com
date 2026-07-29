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


def build_messages(q, history, summary):
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
    sys_prompt += ("\n\nSOURCES (cite by bracketed number, like [3] — write the "
                   "digit; these are the only citable sources this turn):\n\n"
                   + (block or "(none)"))
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
        try:
            messages, sources = build_messages(q, data.get("history"), data.get("summary"))
        except Exception as e:
            return self._json(503, {"ok": False, "error": f"retrieval failed: {e}"})

        # stream: sources line, blank line, then think-stripped answer tokens.
        # Close-delimited (Connection: close) rather than chunked — a proxy in
        # front (Tailscale Funnel) plus http.server keep-alive choked on manual
        # chunked framing; body-until-EOF is simplest and robust.
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(s):
            if not s:
                return
            self.wfile.write(s if isinstance(s, bytes) else s.encode())
            self.wfile.flush()

        try:
            emit(json.dumps({"sources": sources}) + "\n\n")
            strip = ThinkStrip()
            for kind, delta in llm.chat_stream(CFG, messages, think=True):
                if kind != "answer":
                    continue
                emit(strip.feed(delta))
            emit(strip.flush())
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    if not KEY:
        sys.exit("no shared key — create local/serve.key or set MERECAT_LOCAL_KEY")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"merecat-local serving on 127.0.0.1:{PORT} "
          f"({VECTORS.shape[0]} chunks, model {CFG['chat_model']})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
