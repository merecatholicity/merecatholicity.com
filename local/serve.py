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
import socket
import sqlite3
import sys
import threading
import time
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

_VECTORS = None
_veclock = threading.Lock()


def vectors():
    """The embedded corpus, memory-mapped on first use.

    Loaded lazily rather than at import time so this module can be imported on
    a machine that has never built the index — local/data/ is derived state
    (git-ignored, rebuilt by build_index.py), and the Layer-1 unit tests import
    serve.py for pure helpers like ThinkStrip. main() reads it before serving,
    so a missing index still fails the daemon fast and loudly at startup,
    exactly as the old eager load did.
    """
    global _VECTORS
    if _VECTORS is None:
        with _veclock:
            if _VECTORS is None:
                _VECTORS = np.load(VEC_PATH, mmap_mode="r")
    return _VECTORS


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


# The reranker canary: /health proves the reranker accepts a budget-sized
# query+document pair (the 2026-07-29 failure was a server whose physical
# batch silently couldn't). /health must answer instantly (the worker pings
# it thrice in ~1.5s for the admin status dots), so it always serves the
# cached verdict and refreshes it in a background thread when stale; state
# changes are logged to the journal.
_canary_lock = threading.Lock()
_canary = {"at": 0.0, "state": "unchecked", "detail": "", "busy": False}
_CANARY_TTL = 60


def _canary_refresh():
    state, detail = llm.rerank_canary(CFG)
    with _canary_lock:
        if state != _canary["state"]:
            print(f"reranker canary: {_canary['state']} -> {state}"
                  + (f" ({detail})" if detail else ""), flush=True)
        _canary.update(at=time.time(), state=state, detail=detail, busy=False)


def rerank_state(wait=False):
    if not CFG.get("rerank", True):
        return {"state": "disabled", "detail": ""}
    with _canary_lock:
        stale = time.time() - _canary["at"] >= _CANARY_TTL
        kick = stale and not _canary["busy"]
        if kick:
            _canary["busy"] = True
    if kick:
        t = threading.Thread(target=_canary_refresh, daemon=True)
        t.start()
        if wait:
            t.join(90)
    with _canary_lock:
        return {"state": _canary["state"], "detail": _canary["detail"]}


# Ask preflight (the owner's ruling, 2026-07-29): a question must never enter
# a pipeline whose retrieval is KNOWN to be crippled. If the embedder is
# unreachable (the semantic leg dead) or the reranker is down outright (not
# 'degraded' — that state is self-healed by the salvage layer at full
# quality), /ask answers 503 without `busy`, which the worker reads as
# "offline" and — with failover on — sends the question to Cloudflare, whose
# own retrieval and reranker still stand. `rerank: false` in mc_config.yml
# means fusion order is the deliberate design, so it never bounces.
_ready_lock = threading.Lock()
_ready = {"at": 0.0, "ok": True, "why": ""}
_READY_TTL = 30


def backend_ready():
    with _ready_lock:
        if time.time() - _ready["at"] < _READY_TTL:
            return _ready["ok"], _ready["why"]
    ok, why = True, ""
    try:
        llm.embed(CFG, ["canary"], timeout=8)
    except Exception as e:  # noqa: BLE001 — any embed failure kills the leg
        ok, why = False, f"embedder unreachable: {e}"
    if ok:
        rr = rerank_state()
        if rr["state"] == "down":
            ok, why = False, f"reranker down: {rr['detail']}"
    with _ready_lock:
        if (ok, why) != (_ready["ok"], _ready["why"]):
            print("ask preflight: " + ("ready" if ok else f"degraded ({why})"),
                  flush=True)
        _ready.update(at=time.time(), ok=ok, why=why)
    return ok, why


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
    chunks = retrieve.retrieve(db, vectors(), CFG, q)
    db.close()
    sources = [{"n": i + 1, "title": c["title"], "heading": c["heading"],
                "url": retrieve.source_url(CFG, c), "tier": c["tier"], "text": c["text"]}
               for i, c in enumerate(chunks)]
    block = ""
    for s in sources:
        loc = f" — {s['heading']}" if s["heading"] else ""
        # slice each source like the cloud worker does (2,800 chars): twelve
        # UNsliced chunks once built a ~14k-token prompt that left a deep
        # question no room to think, and the answer came back empty
        block += (f"[{s['n']}] ({retrieve.TIER_LABEL.get(s['tier'],'shelf')}) "
                  f"{s['title']}{loc}\n{s['text'][:2800]}\n\n")
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
            rr = rerank_state()
            ready, why = backend_ready()
            self._json(200, {"ok": True, "chunks": int(vectors().shape[0]),
                             "model": CFG["chat_model"],
                             "rerank": rr["state"],
                             **({"rerank_detail": rr["detail"]}
                                if rr["detail"] else {}),
                             "ready": ready,
                             **({"why": why} if why else {})})
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

        # Preflight: retrieval known-crippled → refuse now (a non-busy 503),
        # so the worker fails the question over to the cloud instead of
        # letting a degraded pipeline produce a sourceless answer.
        ready, why = backend_ready()
        if not ready:
            return self._json(503, {"ok": False, "degraded": True,
                                    "error": f"local retrieval degraded ({why})"})

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
        wlock = threading.Lock()

        def emit(s):
            if not s or client_gone[0]:
                return
            try:
                with wlock:
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
                # a vanished reader has nowhere to deliver — free the slot
                if client_gone[0]:
                    return
                acquired = _gpu.acquire(timeout=20)
                if acquired:
                    break
                waited += 20
                emit(json.dumps({"queue": position}) + "\n\n")
            if not acquired:
                emit(json.dumps({"sources": []}) + "\n\n")
                emit("The local librarian is overloaded right now. Please try again shortly.")
                emit("\x03")
                return
            try:
                messages, sources = build_messages(
                    q, data.get("history"), data.get("summary"), context, effort)
            except Exception as e:
                emit(json.dumps({"sources": []}) + "\n\n")
                emit(f"(retrieval failed: {e})")
                emit("\x03")
                return
            emit(json.dumps({"sources": sources}) + "\n\n")
            # Keepalive: a fresh model load or a deep think is minutes of TOTAL
            # wire silence after the sources line, and an idle proxied stream is
            # what gets reaped (it once cut a stream at zero tokens). STX every
            # 15s keeps every leg warm; the client and the mention reader strip
            # it, and it never touches parts or storage.
            hb_stop = threading.Event()

            def _beat():
                while not hb_stop.wait(15):
                    emit("\x02")
            threading.Thread(target=_beat, daemon=True).start()
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
            finally:
                hb_stop.set()
            if not "".join(parts).strip():
                # generation ended with no visible answer (reasoning ran the
                # context dry, or the model yielded nothing): say so honestly,
                # and store the saying so the thread is never left hanging
                parts.clear()
                note = ("The librarian's reasoning ran past its room and no answer "
                        "emerged. Ask again, or try a lower reasoning effort.")
                parts.append(note)
                emit(note)
            # The completion mark: ETX, a byte no body can carry. Its absence
            # at the reader's end proves a truncated stream, and the client
            # then fetches the stored whole instead of trusting half.
            emit("\x03")
        except Exception as e:  # noqa: BLE001 — never crash the handler thread
            print(f"ask handler error: {e}", flush=True)
        finally:
            if acquired:
                _gpu.release()
            with _plock:
                _pending -= 1



def sd_notify(msg):
    """One datagram to systemd's notify socket (Type=notify): READY=1 once
    bound, WATCHDOG=1 heartbeats thereafter, so a wedged-but-alive process
    is restarted by the machine itself instead of discovered days later.
    A no-op outside systemd, and never allowed to raise — liveness
    reporting must not be what kills the service."""
    path = os.environ.get("NOTIFY_SOCKET", "")
    if not path:
        return
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        try:
            s.sendto(msg.encode(),
                     "\0" + path[1:] if path.startswith("@") else path)
        finally:
            s.close()
    except OSError:
        pass


def main():
    if not KEY:
        sys.exit("no shared key — create local/serve.key or set MERECAT_LOCAL_KEY")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"merecat-local serving on 127.0.0.1:{PORT} "
          f"({vectors().shape[0]} chunks, model {CFG['chat_model']})", flush=True)
    sd_notify("READY=1")

    def _sd_watchdog():
        # every 25s against the unit's WatchdogSec=90
        while True:
            time.sleep(25)
            sd_notify("WATCHDOG=1")
    threading.Thread(target=_sd_watchdog, daemon=True).start()

    def _startup_canary():
        # Best-effort: at machine boot the reranker may still be loading;
        # the /health canary re-checks live thereafter.
        time.sleep(3)
        rr = rerank_state(wait=True)
        print("reranker at startup: " + rr["state"]
              + (f" ({rr['detail']})" if rr["detail"] else ""), flush=True)
    threading.Thread(target=_startup_canary, daemon=True).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
