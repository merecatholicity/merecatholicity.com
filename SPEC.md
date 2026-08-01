# SPEC.md — merecatholicity.com: the architecture, and *why*

This document is for a human. `CLAUDE.md` is the operational bible (how to build,
deploy, and not break things) and `docs/architecture/CODEBASE.md` is the measured
module map. This file is the one that explains **what we built, and why we chose
what we chose** — from the languages up to the economics.

Read this first if you want to understand the *shape of the thinking*.

---

## 1. What this is, in one paragraph

merecatholicity.com is two products wearing one skin. The first is a **library**:
our own book plus ~250 public-domain theological and classical works we
re-typeset from source into clean, deep-linkable HTML and PDF. The second is a
**community platform** — a "Facebook-lite" with a forum, end-to-end-encrypted
disappearing direct messages, per-user walls, a global feed, notifications, and
**merecat**, a retrieval-augmented AI librarian trained on the library and tuned
to the site's theological voice. All of it runs for **≈ $0/month** on GitHub
Pages + Cloudflare's free tier, maintained by one person.

That last sentence is the whole design brief. Everything below is downstream of
it.

---

## 2. The thesis

> A single person can run a real social platform **and** a domain-specific AI for
> a niche audience at near-zero cost — *if* the architecture is chosen so that
> (a) the reading experience is **static** (free to serve, fast, indexable,
> survives with no JavaScript), (b) everything dynamic is **delegated to
> free-tier edge functions** with hard budget discipline, and (c) the **domain
> logic is single-sourced** so the browser and the server can never disagree.

Most "cheap to run" advice ends at "use a static site generator." That gets you a
blog. To get a *platform* — accounts, real-time forums, private messaging, an AI
that cites a 200-work corpus — on the same budget, you have to be deliberate about
where each byte of logic lives and which free-tier limits it consumes. The rest of
this document is that deliberation, made explicit.

---

## 3. The layers, and why each technology

Reading order is bottom-up: hosting → build → domain kernel → UI → backend →
storage → AI.

### 3.1 GitHub Pages + Cloudflare — *why static-first*

The site is **prebuilt static files** committed into `docs/` and served by GitHub
Pages, fronted by Cloudflare (DNS, CDN, edge rules). "Deploying the site" is just
`git push` — there is no server-side build.

**Why:** a static reading surface is free forever, is the fastest possible page
load, is trivially indexable by search engines, and **degrades to plain HTML** if
every script fails. For a library whose whole point is that people *read* it, the
reading path must never depend on a server being up or a bundle loading. Cloudflare
in front adds a CDN, TLS, WAF/CSAM scanning, WebSocket termination, and the edge
rules we need — again, free.

The cost of static-first is that anything dynamic has to be *bolted on* rather than
rendered server-side. We embraced that: see §3.5.

### 3.2 The build pipeline: TeX + Pandoc — *why we typeset our own library*

The library isn't scraped HTML. Each work is converted from a preserved source
(Project Gutenberg, CCEL ThML, Wikisource, LacusCurtius, …) by a Python converter
into **our own LaTeX**, then rendered two ways: **pdflatex** produces print-quality
PDFs, and **Pandoc** produces clean, semantic HTML with stable heading ids.

**Why TeX:** it is the only typesetting system that makes a 900-page critical
edition with Greek, Hebrew, footnotes, and a table of contents look *right*, and it
is byte-for-byte reproducible (we pin `SOURCE_DATE_EPOCH`), so git only churns when
the text actually changes. **Why Pandoc:** one source (`*-body.tex`) yields both the
PDF and the web edition, and Pandoc's `.unnumbered` heading model is exactly what
our client-side deep-linker keys on to make every paragraph of every Father
addressable by URL. The library is *content as infrastructure*: it is also the
corpus the AI retrieves from, so its cleanliness is load-bearing twice.

### 3.3 PureScript — *the domain kernel, and why a typed functional core*

The application's **rules** — validation, permissions, ranking, routing, identity
classification, FTS-injection safety, DM lifetimes, the board taxonomy — live in a
**PureScript kernel**: `purescript/src/Domain/*.purs`, ~22 small modules, compiled
to plain ES modules.

**Why PureScript, specifically:**

- **Illegal states are made unrepresentable.** `Fts.SafeMatch` has no public
  constructor, so an un-sanitized full-text-search query *cannot exist* as a
  value — the injection guarantee is enforced by the type system, not by a
  reviewer remembering to call a sanitizer. `Auth.AuthState` cannot hold a hash
  without a key. This is the payoff a mainstream language can't give you: whole
  classes of bug become unspellable.
- **It is shared by the browser and the server.** The same compiled kernel is
  imported by the client bundle *and* by the Cloudflare Worker. A rank threshold,
  a faith code, a category key, a pseudonym derivation, a DM TTL — each is defined
  **once**. Before the kernel, the client and worker each had their own copy and
  they drifted (a real bug: bio cap 1000 in the client, 500 in the worker). Now
  drift is impossible by construction.
- **ADTs + smart constructors + `Maybe`/`Either`** force every edge case to be
  handled at the boundary instead of `undefined` leaking through.

The kernel is the *model* in the truest sense: the pure, testable heart. Everything
else is an edge around it.

### 3.4 TypeScript — *why (and where) over PureScript*

Everything that is **not** pure domain logic is **TypeScript**: the Lit views, the
app shell, the 8,000-line browser client, and both Cloudflare Workers. As of this
work, the entire hand-written surface is strict-`tsc`-clean.

**Why not PureScript everywhere?** Because the edges are *effectful and DOM/host
shaped*, and there PureScript's FFI ceremony buys nothing. Typing a `fetch` retry
loop, a WebSocket lifecycle, an `HTMLRewriter`, a D1 query, or a Lit template in
PureScript means writing as much FFI as logic. TypeScript gives you 90% of the
safety with zero boundary tax when the code is *already* just orchestrating a host
API.

**Why not JavaScript (what TypeScript buys here):** the client and workers are
6,000–8,000-line files full of dynamic JSON rows and DOM grab-bags. `tsc --strict`
turns "this field might be undefined" and "this handler is called with the wrong
args" into compile errors. During the JS→TS migration the compiler surfaced real
latent issues the linter never could. And crucially, TS is a **type-erasure**
language: we proved every conversion behavior-neutral by rebuilding the bundle and
showing it was byte-identical (types compile to nothing), which is why a 20,000-line
migration could ship with confidence.

**The decision rule, stated plainly:**

> New *rules* (validation, permissions, state transitions, parsing, math,
> shared constants) → **PureScript**, in a `Domain.*` module, tested once, used
> by both sides. New *edges* (DOM, fetch, crypto, WebSocket, storage, HTML
> rendering, SQL) → **TypeScript**. When unsure, ask "is this a rule or an
> effect?" Rules go in the kernel; effects stay in TS.

### 3.5 Lit — *why the view layer is thin and presentational*

The reading site is static HTML. A **Lit** app shell progressively upgrades it into
a single-page app: every page becomes a "boot," navigation soft-swaps `<main>`, and
each forum view (`board`, `topic`, `member`, `profile`, …) is a reactive Lit
component in light DOM.

**Why Lit and not React/Vue/Svelte:** Lit is a *thin* library (~a few KB) of
standards — Web Components + reactive `html` templates — with no virtual DOM, no
build-time framework runtime, and no opinion about your data. That matters because
**Lit is deliberately kept presentational**: the components hold no business logic.
They render state that the PureScript kernel computed and call effects the TS FFI
provides. A React app tends to accrete logic in components and hooks; we wanted the
opposite — a render layer so dumb it can be swapped without touching a rule. Lit's
light-DOM + "progressive enhancement over a static page" model is also the only one
that respects §3.1: if the bundle never loads, the static HTML is still there.

### 3.6 Cloudflare Workers — *why the backend is edge functions*

The two dynamic features (comments/forum/DM/bot, and the contact form) are
**Cloudflare Workers** — functions that run at the edge, same-origin with the pages
(so no CORS), spun up per request, billed per request.

**Why Workers over a VPS/container:** a server you rent is a server you pay for and
patch, 24/7, whether or not anyone is posting. Workers cost nothing at idle, scale
to zero, need no OS, and sit in the same Cloudflare edge that's already fronting the
CDN. The whole platform's compute is "run this function when a request arrives."
For a bursty, niche community that is exactly the right billing model and the right
operational surface (there is nothing to keep alive).

### 3.7 D1 + R2 + Durable Objects + Vectorize — *why this storage split*

Four storage primitives, each chosen for what it's uniquely good at:

- **D1** (SQLite at the edge) — the relational store: comments, profiles, DMs,
  notifications, walls, the librarian's chunk index. SQL is the right model for
  threaded, joined, filtered social data, and D1 is free up to real limits.
- **R2** (object storage, **egress-free**) — avatars, DM media, wall media,
  backups, the 3.26 GB of KJV audio. The egress-free part is decisive: serving
  media from R2 costs nothing to *read*, which is what a media-heavy social app
  does constantly.
- **Durable Objects** — the one place we need **coordination + a live socket
  fan-out**: `BoardHub` broadcasts new posts to everyone watching a board over
  WebSockets (a real-time forum with no polling), and `ChatRoom` is a
  per-conversation state machine that owns an AI generation so it survives a
  reader refreshing mid-answer. DOs give single-writer consistency and
  hibernatable WebSockets on the free plan.
- **Vectorize** — the semantic index for the AI's retrieval leg (bge-m3
  embeddings, cosine). Free-tier caps the vector count (~5k), which is why
  retrieval is *hybrid* (see §3.9) rather than pure-vector.

The art is matching each kind of data to the primitive whose free tier it fits:
relational→D1, blobs→R2 (egress-free), realtime→DO, semantic→Vectorize.

### 3.8 The in-house ORM (`db.ts`) — *why not an ORM library*

The worker's data access goes through a small repository layer, `db.ts`: typed row
mappers, single-sourced SQL fragments (the `LEFT JOIN profiles` author join was
copy-pasted 25 times), an `inList()` that emits `?N` placeholders, and a tiny
`Query` builder that auto-numbers binds.

**Why hand-rolled, not Prisma/Drizzle/Knex:** a general ORM is a dependency, a
build step, a runtime, and a bundle-size and cold-start cost — all to abstract a
database we're perfectly happy writing SQL against. On a Worker, every kilobyte of
bundle is startup latency, and every dependency is a supply-chain and
free-tier-fit risk. What we actually needed wasn't an ORM's query *abstraction*;
it was **de-duplication and type-safety for the SQL we already wrote**. So `db.ts`
is ~80 lines that kill the duplication and give us typed mappers, and the SQL stays
legible and reviewable. It is "an ORM" only in the sense of "one place that owns the
row↔object mapping." It is unit-tested (`inList` is proven to emit exactly the
strings the hand-rolled loops did), which is how we route SQL through it without
fear.

### 3.9 Cloudflare Workers AI + a local GPU — *why hybrid AI*

**merecat** answers questions by retrieving from the library and generating an
answer in the site's voice. Retrieval is **five-legged** (semantic via Vectorize,
tier-weighted BM25, raw BM25, a phrase comb, and a Bible-verse-anchor leg) then
reranked — hybrid because the free Vectorize budget can't hold the whole corpus, so
keyword legs cover what vectors don't. Generation runs either on **Cloudflare
Workers AI** (Llama Guard for moderation, a Qwen MoE for chat) or, switchably, on
the **owner's local GPU** reached over a Tailscale Funnel — same shelf, same legs,
whole-corpus vectors, an uncensored model, all behind one config flag with cloud
failover.

**Why hybrid:** Workers AI is free-tier-metered and shared with moderation/vision,
so it's the always-on baseline; the local GPU is unlimited depth for hard questions
when the owner's machine is up. The switch is a single admin setting with automatic
failover into the *same stream*, so a reader never knows which engine answered.
This is how a niche site affords a domain-tuned RAG assistant at all: it rides free
inference by default and borrows a desktop GPU when it wants more, with no code path
difference the user can see.

---

## 4. How we compare to MVC — and where we deliberately differ

If you squint, the stack is MVC-shaped:

| MVC role | Here | Note |
|---|---|---|
| **Model** | PureScript `Domain.*` kernel + `db.ts` rows | the rules + the data mapping |
| **View** | Lit components + Pandoc-rendered pages | strictly presentational |
| **Controller** | Worker route table + middleware + services | request → services → response |

But we differ from textbook MVC in three deliberate ways:

1. **The Model is shared across the client/server boundary, and it's *pure*.** In
   classic MVC the model lives on the server. Ours is a compiled kernel imported by
   *both* the browser and the Worker, so the "model" isn't a server-side object
   graph — it's a set of pure functions and unrepresentable-illegal-state types
   that both tiers agree on. There is exactly one audited place, `app/core.ts` (the
   "membrane"), where the kernel's `Maybe`/`Either`/ADTs are erased into plain
   JS shapes for the untyped consumers. That membrane is a concept MVC doesn't have
   because MVC doesn't cross a language boundary.

2. **The View can vanish and the app still works.** Progressive enhancement over
   static HTML means the "view" is two-layered: a server-rendered static page and
   an optional Lit upgrade. Classic MVC assumes the view is always rendered by the
   framework; ours assumes it might not run at all.

3. **The Controller is a declarative route table, not a fat controller.** The
   worker's dispatch is a data structure (`ROUTES`), cross-cutting concerns are
   composable middleware (`keyed`/`keyedGated` handle parse + rate-limit + auth +
   block-gate), and business operations are named services
   (`deliverNotifications`, `broadcastBoard`, the merecat retrieval/gen). Handlers
   are thin. This is closer to "functional core, imperative shell" than to
   Rails-style controllers — the shell (Worker) does IO and composition; the core
   (kernel) does decisions.

So: MVC as a *map*, "functional core / imperative shell" as the *actual
discipline*.

---

## 5. The design rules (the "how much of each," stated as law)

These are the standing rules a contributor — human or AI — follows:

1. **Rules in PureScript, effects in TypeScript, rendering in Lit.** (§3.4)
2. **Single-source everything shared.** A constant, table, or validator used by
   both client and server is defined once in a `Domain.*` module and imported both
   sides. The client used to keep inline "fallback" copies; those are retired — the
   kernel is the *only* source, so drift is impossible.
3. **One membrane.** `app/core.ts` is the single audited place where kernel types
   are erased for JS. Nothing else returns a raw PureScript constructor across the
   boundary. Type safety lives *inside* PureScript; the membrane keeps it honest at
   the edge.
4. **Lit stays dumb.** Components render kernel-computed state and call
   FFI-provided effects. Logic that creeps into a component is a smell; move it to
   the kernel.
5. **The free-tier budget is a law, not a goal.** Every feature is checked against
   Cloudflare's free limits *before* it ships (see §6). "It works" is necessary but
   not sufficient; "it works within the free tier at scale" is the bar.
6. **Behavior-neutral refactors are proven, not asserted.** Type migrations are
   proven byte-identical; SQL extractions are proven token-identical; the route
   table was proven by an independent parity diff; the file split was proven by an
   unchanged bundle function-set. We don't *hope* a refactor didn't change
   behavior — we show it.

---

## 6. The economics — how a platform + an AI run on free

The free tier isn't a happy accident; it's an engineered constraint. The relevant
limits and how we live inside them:

- **Compute (Workers):** billed per request, zero at idle. The reading site adds
  **zero** Worker requests (it's static). The SPA shell adds zero API traffic — its
  page cache makes back/forward free. Only genuine dynamic actions (post, DM, ask)
  hit a Worker.
- **Realtime (Durable Objects):** the board fan-out and the AI chat are DOs with
  **hibernatable** WebSockets — idle sockets cost nothing, and the fan-out is
  read-only (posting stays on the authenticated HTTP path), so a busy forum doesn't
  multiply write cost.
- **Database (D1):** ~100k rows written/day free. Big AI-corpus ingests are
  budgeted (`--budget-rows`) to stay under it; the social tables are tiny by
  comparison. Disappearing DMs are a *storage* win as much as a privacy one.
- **Objects (R2):** 10 GB + **egress-free**. Media (avatars, DM/wall attachments,
  3.26 GB of Bible audio) lives here precisely because reading it back costs
  nothing. DM media is client-encrypted, so R2 holds only ciphertext.
- **AI (Workers AI + Vectorize):** inference is free-tier-metered and shared, so
  the bot is rate-capped per-user/per-day and retrieval is hybrid to fit the ~5k
  vector budget; when the owner wants unlimited depth, generation switches to the
  local GPU with cloud failover.

**Why this scales until we grow:** every per-request cost is bounded and idle cost
is zero, so the bill tracks *activity*, not *existence*. A dormant niche community
costs nothing; a busy one costs a little. Nothing here has a fixed monthly floor. If
we outgrow the free tier, the *same architecture* migrates smoothly — D1→a bigger
SQL tier, Workers stay Workers (just paid), Vectorize→more vectors, the local GPU
→ a rented one — because none of the choices assume "free" as a *semantic*, only as
a *budget*. The platform was built to be correct first and cheap by consequence, so
growth is a billing event, not a rewrite.

---

## 7. A newcomer's tour (where to look)

1. **This file**, then `README.md` (how it's built) and `CLAUDE.md` (how it's
   operated), then `docs/architecture/CODEBASE.md` (the measured module map).
2. `purescript/src/Domain/Route.purs`, `Auth.purs`, `Access.purs` — the rules that
   decide what a URL shows and who may act. Small, pure, readable; each has a
   1:1 test under `tests/purescript/`.
3. `app/core.ts` — the membrane, where those rules cross into JavaScript.
4. `app/shell.ts` → `app/views/board.ts` → `topic.ts` — one full *read* path, from
   soft-navigation to a rendered Lit view over the kernel.
5. `comments-worker/src/index.ts` (the `ROUTES` table + `fetch`) → a handler →
   `lib.ts` (shared core) → `db.ts` (the SQL) — one full *write* path, HTTP to
   database.
6. `comments-worker/src/durable.ts` — how live updates and the AI chat coordinate.
7. `librarian/` + `local/` — the AI's mind: the corpus manifest, the persona, the
   ingest pipeline, and the local GPU twin.

---

*The short version: put the rules in a typed pure kernel both tiers share, keep the
view a dumb progressive-enhancement layer, do all IO in cheap edge functions with
storage matched to each free tier, and single-source everything so nothing can
drift. That is how one person serves a library, runs a social platform, and hosts a
domain-tuned AI — for the price of a domain name.*
