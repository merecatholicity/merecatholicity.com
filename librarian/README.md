# librarian/ — everything merecat 🐈 knows and how it thinks

merecat is the site's librarian bot: a members-only research assistant on
the Community page (`community.html?merecat=1`), answering from the site's
own corpus with citations that deep-link into the pages. It runs entirely
on the Cloudflare free tier. This directory is its whole mind:

| file         | what it is |
|--------------|------------|
| `works.yml`  | the manifest of every work the bot knows, with tiers |
| `persona.md` | the system prompt: voice, rules, how it argues |
| `config.yml` | model id, daily caps, retrieval dials, temperature, the nine band weights (the reasoning dials and the AI budget guard are set on the merecat admin page) |
| `extra/`     | drop-in folder for AI-only content (plain .txt/.md) |
| `ingest.py`  | builds chunks from the sources and pushes them; pushes the persona and dials apart (`--config`) |
| `.key`       | your admin board key, for the hand road (git-ignored; or use `MC_ADMIN_KEY`) |

## Growing the bot

**Add content.** Add one entry to `works.yml` pointing at a site page (or
drop a `.txt`/`.md` into `extra/` and list it with `kind: text`), pick its
tier, then commit and push — `merecat.yml` ingests it against the freshly built
site. Or, by hand with an admin's key, from the repo root:

    make librarian

That is the whole procedure. The push is incremental: only works whose
source bytes or manifest entry changed are re-sent, so re-running is cheap
and an interrupted run resumes where it left off. Removing an entry from
`works.yml` prunes it from the bot on the next full push.

**A BIG INGEST YIELDS TO A PENDING MIGRATION** (2026-09-18). D1's free tier
allows 100,000 row writes *per account per day*, shared by the three librarian
rooms, the comments database, every migration a worker deploy applies, and
every comment, DM and reaction a member writes. An ordinary incremental push
costs almost nothing. A run that re-ingests the whole corpus — a
`PARSER_VERSION` bump, a rebuilt shelf — costs most of the day: on 2026-09-18
one spent 109,021 rows in six minutes, the next worker deploy died on its
migration with `exceeded D1's free tier daily row write limit`, and **production
accepted no writes at all until midnight UTC** — no comments, no DMs, no
reactions — while reads answered normally and nothing on the site said why.
Nothing in the pipeline can enforce the ordering (it holds no Cloudflare
credential, by design), so it is a rule people keep: **if a worker deploy with a
pending migration is waiting, let it deploy first.** It needs a few rows; this
needs tens of thousands. `ingest.py` prints the same warning before it starts
spending, and `--budget-rows` (default 60,000 estimated ≈ 72,800 actual) is what
keeps an ordinary day's headroom.

**Change the voice or rules.** Edit `persona.md`, commit, push. `merecat.yml`
sees the file differ from what the server last took, and its `config` job
**waits for the owner's review** (the `librarian-config` environment: *Review
deployments* on the run, or `scripts/ci_approve.sh <run-id> --approve "why"`);
once approved it pushes the persona. The worker takes a persona or dials push
from no other job — the pipeline holds no key, it proves itself with GitHub's
OIDC token (2026-09-17). By hand, `make librarian` pushes it with an admin's
key. No redeploy: the worker reads the persona from its database (isolates pick
the change up within five minutes).

**Change the model, caps, temperature or band weights.** Edit `config.yml`, commit, push — the same reviewed `config` job pushes the dials (or `make librarian`). They travel only when the FILE changes, so an edit made on the merecat admin page stands until `config.yml` is next touched, as a persona edit always has. The reasoning dials and the AI budget guard are set on the merecat admin page.
The default model is the strongest answer-per-neuron on the free Workers AI
catalog; `config.yml` explains the trade if you want a bigger one.

## Copyrighted works (the private shelf)

Works you cannot host still become part of the librarian's knowledge:

1. Put the text as plain `.txt` or `.md` into `librarian/private/` — a
   SEPARATE clone of the PRIVATE repo `merecatholicity/private-shelf` (never a
   submodule: the Pages builder refuses a tree that names a private one), never
   served and never carried by the public repo, so the text lives in your private
   repo and inside the retrieval database, where it surfaces as brief quoted
   excerpts with attribution. Commit and push inside `librarian/private/` after
   adding; the private repo's own workflow dispatches `merecat.yml`, which clones
   the shelf with a read-only deploy key and ingests it. Lines starting `#`, `##`, or
   `###` become chapter labels for better retrieval.
2. Add a works.yml entry whose `url` is the purchase link:

       wright-hope:
         { src: private/surprised-by-hope.txt, url: "https://www.amazon.com/dp/0061551821",
           tier: 5, kind: text,
           title: "Surprised by Hope, by N. T. Wright (HarperOne, 2008)" }

3. `make librarian`. Citations then read like any essay's, `[n] Surprised
   by Hope, by N. T. Wright`, linking to where the book can be bought, and
   the persona keeps quotations brief. On machines without the private
   files the push just skips them with a note.

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
    python ingest.py --config-status    # do persona.md / config.yml differ from the server?
    python ingest.py --config [--force] # push the one that differs (or both)

The credential: inside a GitHub Actions job granted `id-token: write`, the
job's OIDC token (asked for with the worker's audience and renewed before it
lapses); anywhere else, an admin's board key (`MC_ADMIN_KEY` or `.key`). The
corpus run never pushes the persona or the dials.

## The server side

The bot rides the comments worker (`/api/merecat/*`): same identity system,
same blocked-list gates, per-member and community daily caps, and a
"merecat is resting" answer — naming the hours until midnight UTC — when the
shared question budget is spent or when the account's Workers AI meter has
reached the AI budget guard's line (on by default at 95% of the free day, read
live from Cloudflare's analytics; admins are held to it too). Its data
lives in its own D1 database (`merecat-library`) and Vectorize index
(`merecat-t1`) — all derived from this directory, rebuildable any time,
which is why the backup cron ignores it. Questions are never stored;
usage tables hold counters only.
