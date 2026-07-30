#!/usr/bin/env python3
"""Regression matrix for the hardened rerank path (2026-07-29 postmortem:
one 703-token Greek-dense chunk over the reranker's default 512 physical
batch failed whole reranks, and three questions in a row answered "my
resources do not address this" from fusion-ordered junk).

Run it any time the reranker, its flags, or llm.py's rerank path change:

    python3 local/tests/test_rerank_robust.py

It tests against three servers:
  GOOD = the production reranker (:8181, -b/-ub 2048)
  BAD  = a clone THIS SCRIPT LAUNCHES on :8199 with the default 512 batch —
         the exact configuration that broke the live demo
  DEAD = nothing listening
and proves: token-exact trimming, whole-batch success on GOOD, per-document
salvage on BAD (real scores, relevant doc still first), canary verdicts
(ok / degraded / down), and the fusion fallback only when truly unreachable.
"""
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.dirname(HERE)
sys.path.insert(0, LOCAL)
import llm  # noqa: E402

GOOD = {"rerank_url": "http://127.0.0.1:8181"}
BAD = {"rerank_url": "http://127.0.0.1:8199"}
DEAD = {"rerank_url": "http://127.0.0.1:8190"}
MODEL = os.path.join(LOCAL, "models", "bge-reranker-v2-m3-Q8_0.gguf")

GREEK = ("ἡ βασιλεία τῶν οὐρανῶν βιάζεται καὶ βιασταὶ ἁρπάζουσιν αὐτήν "
         "καὶ ἐὰν μή τις γεννηθῇ ἐξ ὕδατος καὶ πνεύματος οὐ δύναται "
         "εἰσελθεῖν εἰς τὴν βασιλείαν τοῦ θεοῦ ") * 22
HOMER = ("μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος οὐλομένην ἣ μυρί Ἀχαιοῖς ἄλγε "
         "ἔθηκεν πολλὰς δ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν ἡρώων ") * 30
RELEVANT = ("But seek ye first the kingdom of God, and his righteousness; "
            "and all these things shall be added unto you. Verily I say unto "
            "thee, Except a man be born again, he cannot see the kingdom of "
            "God. ") * 7
FILLER = [("The senate and the roman people decreed a triumph for the consul "
           "after the campaign in hispania. ") * 15 for _ in range(28)]
Q = "according to the Bible, how do i get to Heaven"

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    passed += ok
    failed += not ok
    print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail else ""))


def wait_ready(url, secs=45):
    for _ in range(secs):
        try:
            urllib.request.urlopen(url + "/health", timeout=2)
            return True
        except Exception:  # noqa: BLE001
            time.sleep(1)
    return False


bad_srv = subprocess.Popen(
    ["/usr/bin/llama-server", "-m", MODEL, "--reranking",
     "--host", "127.0.0.1", "--port", "8199", "--ctx-size", "8192"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    if not wait_ready(BAD["rerank_url"]):
        sys.exit("the crippled clone never came up on :8199")

    # ---- tokenizer plumbing ------------------------------------------------
    n_en = llm.tok_count(GOOD, "the kingdom of heaven")
    n_gr = llm.tok_count(GOOD, GREEK[:120])
    check("tok_count english", isinstance(n_en, int) and 3 <= n_en <= 8, f"{n_en}")
    check("tok_count greek density", isinstance(n_gr, int) and n_gr >= 30,
          f"{n_gr} tokens / 120 chars")
    t = llm._trim_tokens(GOOD, GREEK, 400)
    check("_trim_tokens hits budget", llm.tok_count(GOOD, t) <= 400,
          f"{llm.tok_count(GOOD, t)} <= 400")

    # ---- healthy server ----------------------------------------------------
    s = llm.rerank(GOOD, Q, [RELEVANT] + FILLER[:10])
    top = sorted(range(len(s)), key=lambda i: -s[i])[0]
    check("GOOD normal batch scores", s is not None and len(s) == 11)
    check("GOOD relevant doc ranked first", top == 0, f"top={top}")
    s = llm.rerank(GOOD, "how does one enter the kingdom " + GREEK[:60],
                   [GREEK * 2] + FILLER[:10])
    check("GOOD greek-monster batch survives", s is not None and len(s) == 11
          and all(x > -1e8 for x in s))

    # ---- the 2026-07-29 configuration --------------------------------------
    state, detail = llm.rerank_canary(BAD)
    check("BAD canary reports degraded", state == "degraded", detail[:90])
    fat = llm._trim_tokens(GOOD, HOMER, 1300)
    s = llm.rerank(BAD, Q, [RELEVANT, fat] + FILLER[:10])
    check("BAD salvage returns scores (not None)", s is not None and len(s) == 12)
    if s is not None:
        top = sorted(range(len(s)), key=lambda i: -s[i])[0]
        check("BAD salvage: relevant doc still first", top == 0, f"top={top}")
        check("BAD salvage: fat doc got a real score", s[1] > -1e8, f"{s[1]:.2f}")
    state, detail = llm.rerank_canary(GOOD)
    check("GOOD canary reports ok", state == "ok", detail[:90])

    # ---- dead server -------------------------------------------------------
    s = llm.rerank(DEAD, Q, ["a", "b"])
    check("DEAD returns None (fusion fallback)", s is None)
    state, _ = llm.rerank_canary(DEAD)
    check("DEAD canary reports down", state == "down")
finally:
    bad_srv.terminate()
    bad_srv.wait(timeout=10)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
