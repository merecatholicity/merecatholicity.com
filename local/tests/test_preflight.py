#!/usr/bin/env python3
"""Preflight-bounce matrix on an isolated serve.py instance (port 8791) —
no production service touched, no GPU generation (the bounce fires before
the queue). Proves the owner's failover ruling: a dead embedder or a dead
reranker refuses the ask with a non-busy 503, which the worker turns into
a Cloudflare failover when failover=1.

    python3 local/tests/test_preflight.py
"""
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import serve  # noqa: E402

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    passed += ok
    failed += not ok
    print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail else ""))


def reset_caches():
    with serve._canary_lock:
        serve._canary.update(at=0.0, state="unchecked", detail="", busy=False)
    with serve._ready_lock:
        serve._ready.update(at=0.0, ok=True, why="")


def ask(port):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/ask",
        data=json.dumps({"q": "how do i get to heaven"}).encode(),
        headers={"Content-Type": "application/json", "X-Merecat-Key": serve.KEY},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read(200).decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


srv = ThreadingHTTPServer(("127.0.0.1", 8791), serve.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.3)

GOOD_RERANK = serve.CFG["rerank_url"]
GOOD_OLLAMA = serve.CFG["ollama_url"]

serve.CFG["rerank_url"] = "http://127.0.0.1:8190"
reset_caches()
serve.rerank_state(wait=True)
code, body = ask(8791)
ok = code == 503 and "degraded" in body and '"busy"' not in body
check("reranker down -> non-busy 503 (worker fails over)", ok, f"{code} {body[:90]}")

serve.CFG["rerank_url"] = GOOD_RERANK
serve.CFG["ollama_url"] = "http://127.0.0.1:8190"
reset_caches()
serve.rerank_state(wait=True)
code, body = ask(8791)
check("embedder down -> non-busy 503 (worker fails over)",
      code == 503 and "embedder" in body, f"{code} {body[:90]}")

serve.CFG["ollama_url"] = GOOD_OLLAMA
reset_caches()
serve.rerank_state(wait=True)
ready, why = serve.backend_ready()
check("healthy -> preflight ready", ready is True, why)

with urllib.request.urlopen("http://127.0.0.1:8791/health", timeout=30) as r:
    h = json.loads(r.read())
check("/health reports rerank + ready",
      h.get("rerank") == "ok" and h.get("ready") is True, json.dumps(h)[:120])

srv.shutdown()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
