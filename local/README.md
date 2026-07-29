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
ollama pull qwen3:30b-a3b bge-m3

# 3. the reranker GGUF (CPU) — into local/models/
curl -L -o local/models/bge-reranker-v2-m3-Q8_0.gguf \
  https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/main/bge-reranker-v2-m3-Q8_0.gguf
llama-server -m local/models/bge-reranker-v2-m3-Q8_0.gguf --reranking \
  --host 127.0.0.1 --port 8181 &

# 4. build the index from the shared sources (~15-20 min once)
python local/build_index.py

# 5. ask
./local/merecat "your question"
```

If the reranker server is not running, retrieval still works — it falls back
to reciprocal-rank fusion over the legs. Everything is tunable in
`mc_config.yml` (models, topk, context window, weight-related dials).

## Services and lifecycle

**Nothing is enabled at boot — on purpose.** While we are still judging the
local answers, the two daemons run as plain foreground/background processes
under your own user, not as systemd services:

- `ollama serve` — the chat + embed server. Run as **your user** so it reads
  the models in `~/.ollama`. (The package ships a `ollama.service` unit but it
  is **disabled**, and it runs as the `ollama` system user, which looks in a
  *different* models directory — do not `systemctl enable` it expecting to see
  the models pulled here. Persisting the stack is a deploy-time decision, in
  the "Not yet" section below.)
- `llama-server --reranking … --port 8181` — the reranker. Optional; if it is
  down, retrieval falls back to reciprocal-rank fusion.

**Bring the stack up (after a reboot, or a fresh shell):**

```sh
pgrep -f 'ollama serve' >/dev/null || (ollama serve &)      # chat + embed
pgrep -f 'llama-server.*reranking' >/dev/null || \          # reranker (optional)
  (llama-server -m local/models/bge-reranker-v2-m3-Q8_0.gguf --reranking \
     --host 127.0.0.1 --port 8181 --ctx-size 8192 &)
./local/merecat "…"                                          # ask
```

The index (`data/`) survives reboots — it only needs rebuilding when the
sources or the embed model change. Check health any time:
`curl -s localhost:11434/api/version` (ollama) and
`curl -s localhost:8181/health` (reranker).

## Files (all tracked in git)

| file | what |
|---|---|
| `merecat` | the CLI: retrieve → prompt with the shared `persona.md` → stream the answer → sources footer |
| `build_index.py` | imports `../librarian/ingest.py`, builds every work, writes the sqlite + FTS5 index and the embeddings |
| `retrieve.py` | the five legs (semantic, tier-weighted BM25, raw BM25, phrase, verse), ported line-for-line from `comments-worker/src/index.js` — same Bible table, DR slug map, stopwords, and weight ladder |
| `llm.py` | stdlib urllib clients for ollama chat/embed and the llama.cpp reranker |
| `persona.local.md` | **your local prompt, maintained separately from the online bot** (see below) |
| `mc_config.yml` | models, ports, topk, context, paths, persona mode |

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
- **Stronger models**: qwen3:30b-a3b (vs the fp8 served build), bge-reranker
  **v2**-m3 (vs `-base`), and more chunks in context (`topk` 12 vs 8).
- **No caps, no budget, no token ceiling** — answers run long, reasoning on.

The weights, bands, legs, anchors, persona, and deep-link URLs are identical.

## Teardown (if we abort the local project)

Everything this project added is external to the site and fully reversible.
It touches **none** of the shared sources, the private shelf, or the Cloudflare
bot. To remove it completely:

```sh
# 1. stop the daemons (they are not services, so just kill them)
pkill -f 'ollama serve'; pkill -f 'llama-server.*reranking'

# 2. delete the pulled models (~19 GB) and the reranker GGUF
ollama rm qwen3:30b-a3b bge-m3        # or: rm -rf ~/.ollama  (all ollama data)
rm -rf local/data local/models        # the git-ignored derived state

# 3. uninstall the runtime (removes deps too; safe — nothing else needs them)
sudo pacman -Rns ollama-vulkan llama-cpp

# 4. the packages created an `ollama` system user (uid 963); pacman leaves it.
#    Harmless, but to remove: sudo userdel ollama 2>/dev/null

# 5. drop the code from the repo
git rm -r local/                      # then revert the two local/ lines in .gitignore
```

Nothing else was changed: no systemd units enabled, no boot hooks, no edits
outside `local/` and the two `.gitignore` lines. The disk footprint while it
lives is ~19 GB of models (`~/.ollama`) + ~1.5 GB of index (`local/data`) +
~0.6 GB reranker (`local/models`).

## Not yet (next step)

Serving this over the network and defaulting to it with a Cloudflare fallback
when the machine is offline — deferred until the local answers are judged good.
