# merecat-local — the librarian on your own GPU

This is the offline twin of the Cloudflare merecat bot. It answers from the
**exact same shelf** (the shared `../librarian` sources) with the **same
weights, bands, and five retrieval legs**, but without the free-tier ceilings:
the **whole corpus is vectorized** (not just the ~4,880 that fit Cloudflare's
Vectorize budget), the chat model is a real 30B reasoning model, and the
answers run as long as the question deserves.

    ./merecat "What makes a valid Eucharist, and who may rightly preside?"
    echo "How does Beale read the millennium of Revelation 20?" | ./merecat
    ./merecat --think "Is the New Perspective on Paul compatible with Trent?"
    ./merecat --sources "the destruction of Jerusalem in A.D. 70"

## What it is

- **Runtime:** `ollama` (Vulkan, on the GPU) serves the chat model and the
  bge-m3 embedder; `llama.cpp` (CPU) serves the reranker. No pip packages —
  system Python plus the `numpy`/`pyyaml` already on the machine.
- **Store:** `data/chunks.sqlite` (chunk rows + an FTS5 index with the same
  `porter unicode61` tokenizer the worker uses) and `data/vectors.npy` (every
  chunk embedded, 1024-dim). Vector search is numpy brute-force cosine over the
  whole corpus — ~100 ms/query, no FAISS needed.
- **Chunks:** built by importing `../librarian/ingest.py` and calling its
  `build()` per work, so anchors and packing are byte-identical to the live
  bot. Sources are **not duplicated** — the same committed `*.html`/`*.json`
  and the git-ignored `../librarian/private/` shelves.

## Setup (reproducible on any machine with the repo)

```sh
# 1. runtime (Arch; numpy + pyyaml already present)
sudo pacman -S --needed ollama-vulkan llama-cpp

# 2. start ollama and pull the models
ollama serve &                       # or: systemctl start ollama
ollama pull huihui_ai/qwen3-abliterated:30b bge-m3

# 3. the reranker GGUF (CPU) — into local/models/
curl -L -o local/models/bge-reranker-v2-m3-Q8_0.gguf \
  https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/main/bge-reranker-v2-m3-Q8_0.gguf
llama-server -m local/models/bge-reranker-v2-m3-Q8_0.gguf --reranking \
  --host 127.0.0.1 --port 8181 --ctx-size 8192 -b 2048 -ub 2048 &
#   -b/-ub 2048 are LOAD-BEARING: the default physical batch is 512, and a
#   single query+document pair past it (Greek-dense chunks tokenize ~2x per
#   char) errors the WHOLE /rerank batch — llama.cpp cancels every task,
#   retrieval silently falls back to fusion order, and the bot answers
#   "my resources do not address this" from a junk pool (2026-07-29
#   postmortem: three questions in a row, one 703-token chunk).

# 4. build the index from the shared sources (~an hour, once)
python local/build_index.py
#    later shelf additions are incremental — minutes, not the full rebuild:
#    python local/build_index.py --add <work-id>   # then restart merecat-local

# 5. ask
./local/merecat "your question"
```

If the reranker server is not running, retrieval still works — it falls back
to reciprocal-rank fusion over the legs. Everything is tunable in
`mc_config.yml` (models, topk, context window, weight-related dials).

## Retrieval robustness (the 2026-07-29 postmortem, hardened)

The incident: three questions in a row answered "my resources do not address
this" because ONE retrieved chunk tokenized past the reranker's 512-token
physical batch, llama.cpp failed the WHOLE /rerank request, and the silent
fusion fallback surfaced junk. Nothing was down; it was data-dependent and
invisible. Four layers now stand between a fat chunk and a bad answer:

1. **Prevent** — the reranker runs with `-b 2048 -ub 2048`, and `llm.rerank`
   trims every query/document to `rerank_pair_budget` (mc_config.yml, 1400)
   token-exactly via the server's own `/tokenize` (a conservative estimate
   when that is unavailable) before anything is sent.
2. **Heal** — a refused batch is binary-split until the offender is isolated
   (`_salvage`), the offender retried at half/quarter/eighth length; at
   worst ONE document loses its score, never the rerank. Proven against a
   deliberately crippled 512-batch clone: full scores, relevant doc first.
3. **Detect** — `/health` carries `rerank: ok|degraded|down` from a cached
   background canary that scores a budget-sized pair end-to-end (it would
   have caught the misconfiguration the moment it existed), plus
   `ready: true|false` with a `why`. Every degradation prints to the
   journal (`journalctl -u merecat-local`).
4. **Bounce** — `/ask` preflights the embedder and reranker (`backend_ready`,
   cached 30s); if either is truly DOWN it refuses with a non-busy 503,
   which the worker turns into a **Cloudflare failover** when `failover=1`
   (the owner's ruling: a known-crippled pipeline never answers members —
   the cloud's own retrieval and reranker still stand). `rerank: false` in
   mc_config.yml means fusion is deliberate and never bounces; a "degraded"
   canary keeps answering locally because salvage restores full quality.

Regression suites (run after touching the reranker, its flags, or llm.py —
the first launches its own crippled clone on :8199):

```sh
python3 local/tests/test_rerank_robust.py
python3 local/tests/test_preflight.py
```

The cloud path was audited the same day: Workers AI's `bge-reranker-base`
**silently truncates** oversized contexts (verified empirically — a
900-token context scores fine), so this failure class cannot occur there,
and its rerank already falls back to semantic-first order under a logged
`merecat_rerank_failed` event.

## Services and lifecycle

The stack runs as **three systemd units** (`/etc/systemd/system/`), all
**enabled at boot** and verified from a cold start:

- `merecat-ollama.service` — `ollama serve` (chat + embed). Runs as **your
  user** with `HOME` set, so it reads the models pulled into `~/.ollama`. (The
  package's own `ollama.service` stays disabled — it runs as the `ollama`
  system user, which looks in a *different* models directory.)
- `merecat-reranker.service` — `llama-server --reranking` on :8181 with
  `--ctx-size 8192 -b 2048 -ub 2048` (the batch flags are load-bearing — see
  the setup note above). Optional; if it is down, retrieval falls back to
  reciprocal-rank fusion, and `llm.py` logs the fallback to the journal.
- `merecat-local.service` — `serve.py` on :8790 (the site-facing service;
  `After=` the other two). Restart it after editing `serve.py` or
  `mc_config.yml`: `sudo systemctl restart merecat-local`. Editing
  `persona.local.md` needs **no** restart — it is read per question.

```sh
systemctl status merecat-ollama merecat-reranker merecat-local
journalctl -u merecat-local -f        # serve.py logs (store callbacks, errors)
```

The index (`data/`) survives reboots — it only needs rebuilding when the
sources or the embed model change. Check health any time:
`curl -s localhost:11434/api/version` (ollama),
`curl -s localhost:8181/health` (reranker), and
`curl -s localhost:8790/health` (serve.py — also what the worker's admin
status pings through the Funnel).

## Files (all tracked in git)

| file | what |
|---|---|
| `merecat` | the CLI: retrieve → prompt with the shared `persona.md` → stream the answer → sources footer |
| `build_index.py` | imports `../librarian/ingest.py`, builds every work, writes the sqlite + FTS5 index and the embeddings |
| `retrieve.py` | the five legs (semantic, tier-weighted BM25, raw BM25, phrase, verse), ported line-for-line from `comments-worker/src/index.js` — same Bible table, DR slug map, stopwords, and weight ladder |
| `llm.py` | stdlib urllib clients for ollama chat/embed and the llama.cpp reranker |
| `serve.py` | the site-facing HTTP service on :8790 (`/ask` keyed + `/health`), run by `merecat-local.service`; queues the one GPU, streams close-delimited, and reports finished answers to the worker's `/store` |
| `persona.local.md` | **your local prompt, maintained separately from the online bot** (see below) |
| `mc_config.yml` | models, ports, topk, context, paths, persona mode, `store_url`, `queue_cap` |

## The local prompt (its own file, private)

The local bot's prompt is `persona.local.md`, used **verbatim** as the system
prompt and wholly independent of the online bot's `../librarian/persona.md`
(which is never touched). The live `persona.local.md` is **git-ignored — it is
private, owner-maintained data.** The repo ships `persona.local.example.md` as
the starter; a fresh clone copies it:

    cp local/persona.local.example.md local/persona.local.md

Then edit `persona.local.md` freely — the change takes effect on the next
`./merecat`, no rebuild needed.

**Derived state is git-ignored** (`data/`, `models/`): the embeddings, the
sqlite index, and the reranker GGUF are all rebuilt from the shared sources by
`build_index.py`, so a fresh clone plus the setup steps reproduces the bot.

## Differences from the Cloudflare bot (all deliberate upgrades)

- **Every chunk is vectorized**, so semantic recall reaches every band, not
  just band 1 + the worldview core.
- **Stronger models**: huihui_ai/qwen3-abliterated:30b — the refusal-removed
  (abliterated) build of the same 30B-A3B MoE, the owner's anti-censorship
  choice (vs the stock fp8 served build in the cloud) — plus bge-reranker
  **v2**-m3 (vs `-base`), and more chunks in context (`topk` 12 vs 8).
- **No caps, no budget, no token ceiling** — answers run long, reasoning on.

The weights, bands, legs, anchors, persona, and deep-link URLs are identical.

## Teardown (if we abort the local project)

Everything this project added is external to the site and fully reversible.
It touches **none** of the shared sources, the private shelf, or the Cloudflare
bot. To remove it completely:

```sh
# 1. stop and remove the three units
sudo systemctl disable --now merecat-ollama merecat-reranker merecat-local
sudo rm /etc/systemd/system/merecat-{ollama,reranker,local}.service
sudo systemctl daemon-reload

# 2. drop the Funnel and the worker's pointers to the machine
tailscale funnel --bg off 8790        # or: tailscale funnel reset
# then in comments-worker: remove MERECAT_LOCAL_URL (wrangler.jsonc var) and
# `wrangler secret delete MERECAT_LOCAL_KEY`; set backend back to cloudflare
# in the merecat administration page first so readers never hit a dead route.

# 3. delete the pulled models (~19 GB) and the reranker GGUF
ollama rm huihui_ai/qwen3-abliterated:30b bge-m3   # or: rm -rf ~/.ollama
rm -rf local/data local/models        # the git-ignored derived state

# 4. uninstall the runtime (removes deps too; safe — nothing else needs them)
sudo pacman -Rns ollama-vulkan llama-cpp

# 5. the packages created an `ollama` system user (uid 963); pacman leaves it.
#    Harmless, but to remove: sudo userdel ollama 2>/dev/null

# 6. drop the code from the repo
git rm -r local/                      # then revert the local/ lines in .gitignore
```

Outside `local/`, the footprint is: the three systemd units, the Funnel, the
worker's `MERECAT_LOCAL_URL`/`MERECAT_LOCAL_KEY` + the `/store` endpoint and
backend config keys (all inert once backend is `cloudflare`), and the
`.gitignore` lines. Disk while it lives: ~19 GB of models (`~/.ollama`) +
~1.5 GB of index (`local/data`) + ~0.6 GB reranker (`local/models`).

## Serving to the site (Tailscale Funnel + the worker switch)

`serve.py` (the `merecat-local` systemd service) exposes an `/ask` endpoint the
Cloudflare worker proxies to over **Tailscale Funnel**:

    tailscale funnel --bg 8790     # https://<node>.<tailnet>.ts.net -> :8790

The worker holds the Funnel URL (`MERECAT_LOCAL_URL` var) and a shared key
(`MERECAT_LOCAL_KEY` secret = `local/serve.key`). `/ask` refuses any request
without the key, so on the open internet the local bot answers no one but the
worker. The browser only ever talks to merecatholicity.com.

**Routing is a config switch** in the merecat administration page (stored in
LIBDB `config`, no redeploy):

- **backend** `cloudflare` (default) | `local` — which librarian answers.
- **failover** on/off — if `local`, a downed or busy machine drops silently to
  Cloudflare. When it fails over the reader's reasoning choice does not apply.
- **mention_effort** `instant`|`off`|`low`|`medium`|`high`(default)|`xhigh`|`max`
  — the reasoning an @merecat mention gets; `instant` sends mentions to the cloud.

**Per-reader control** (merecat page, shown only when local is active,
remembered in `localStorage`): Instant (Cloudflare, no wait) or Local at a
chosen depth (off … max). The chat, article-comment mentions, and forum-thread
mentions all pass the **same context** to local that the cloud builds.

**One GPU, so requests queue**: one generation at a time plus a short wait
(`queue_cap` in `mc_config.yml`, default 3); a waiting caller is told its place
in line, and past the cap the answer is an immediate "try again shortly".

**An answer outlives the reader** (the disconnect contract): a page refresh
mid-answer must never lose the reply. The worker stores the thread + question
*before* proxying and passes the chat id **and the question's msg id** down;
`serve.py`'s stream writes are best-effort (a dead reader flips `client_gone`,
generation continues to the end); the finished answer is then reported to the
worker's keyed `POST /api/merecat/store` (`store_url` in `mc_config.yml`),
**deduped per question** on the msg id (so a retry never doubles an answer,
and two generations racing on one thread never drop one — a last-row check
did, once). Gotchas: the callback must send a browser-ish `User-Agent` —
Cloudflare's edge 403s Python-urllib's default (same trick as `ingest.py`) —
and it never retries a 4xx (a deleted chat is not a transient). While waiting
for the GPU, serve.py re-emits `{queue:N}` every 20s as a heartbeat so a long
quiet queue wait cannot idle out the proxied stream, and a vanished reader
with no chat to store to bails from the queue rather than burning the GPU.
The cloud path has its own version of the same contract (see the worker:
timed relay + partial flushes in `merecatPump`).
