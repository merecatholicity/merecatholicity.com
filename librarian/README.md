# librarian/ — everything merecat 🐈 knows and how it thinks

merecat is the site's librarian bot: a members-only research assistant on
the Community page (`community.html?merecat=1`), answering from the site's
own corpus with citations that deep-link into the pages. It runs entirely
on the Cloudflare free tier. This directory is its whole mind:

| file         | what it is |
|--------------|------------|
| `works.yml`  | the manifest of every work the bot knows, with tiers |
| `persona.md` | the system prompt: voice, rules, how it argues |
| `config.yml` | model id, daily caps, retrieval dials |
| `extra/`     | drop-in folder for AI-only content (plain .txt/.md) |
| `ingest.py`  | builds chunks from the sources and pushes everything |
| `.key`       | your admin board key (git-ignored; or use `MC_ADMIN_KEY`) |

## Growing the bot

**Add content.** Add one entry to `works.yml` pointing at a site page (or
drop a `.txt`/`.md` into `extra/` and list it with `kind: text`), pick its
tier, then from the repo root:

    make librarian

That is the whole procedure. The push is incremental: only works whose
source bytes or manifest entry changed are re-sent, so re-running is cheap
and an interrupted run resumes where it left off. Removing an entry from
`works.yml` prunes it from the bot on the next full push.

**Change the voice or rules.** Edit `persona.md`, run `make librarian`.
No redeploy: the worker reads the persona from its database (isolates pick
the change up within five minutes).

**Change the model or caps.** Edit `config.yml`, run `make librarian`.
The default model is the strongest answer-per-neuron on the free Workers AI
catalog; `config.yml` explains the trade if you want a bigger one.

## Tiers: how importance works

- **Tier 1** — the primary works: the book, the three Charting papers, the
  credo, lex orandi. These are vectorized for semantic search, boosted in
  keyword rank, and framed to the model as "the positions of this site."
- **Tier 2** — the evidence shelf: our other papers, the curated Fathers,
  the councils and schism documents, the Catena, Newman, the prayer pages,
  both Bibles.
- **Tier 3** — the deep corpus: the 36 Schaff volumes and the Summa.

Tier is bias, not blinders: the bot retrieves from every tier on every
question, the tier only weights rank and framing, and the persona orders it
to distinguish "this site argues" from "the record shows." Promote or
demote any work by editing one number.

## What ingest.py does

For each work it parses the source into ~350-word chunks, each carrying a
**deep anchor** so citations land on the exact place: pandoc pages keep
their static heading ids plus the same `<heading-id>__pN` paragraph ids
deeplink.js assigns at runtime (the walk in `ingest.py` MUST mirror
deeplink.js — change them together); hand pages use their semantic ids
(each of the fifty objections cites as its own `#oN` row); the Bibles chunk
straight from `kjv.json`/`dr.json` with `slug-chapter-verse` anchors the
readers resolve. Anchors are validated at build time; a bad anchor fails
the push.

Pushes respect the free-tier ledgers: Vectorize holds vectors for Tier 1
only (~4,880 vector budget, warned on), and `--budget-rows` (default
90,000) stops a big push before D1's daily write cap — re-run the next day
and it resumes from the works that didn't finish. First-time full corpus:

    python ingest.py                    # dry run: counts + anchor validation
    python ingest.py --push --tiers 1,2 # day one: positions + the shelf
    python ingest.py --push             # following days: the deep corpus,
                                        # rerun until "done" lists no stops

## The server side

The bot rides the comments worker (`/api/merecat/*`): same identity system,
same blocked-list gates, per-member and community daily caps, and a
"merecat is resting" answer when the shared free budget is spent. Its data
lives in its own D1 database (`merecat-library`) and Vectorize index
(`merecat-t1`) — all derived from this directory, rebuildable any time,
which is why the backup cron ignores it. Questions are never stored;
usage tables hold counters only.
