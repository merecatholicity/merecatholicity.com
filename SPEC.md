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
to the site's theological voice. All of it runs for **≈ $0/month**, on free-tier
infrastructure, maintained by one person.

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
this document is that deliberation, made explicit. It is about the *system we
built*, not the vendors we rent from.

---

## 3. The layers, and why each one is shaped the way it is

Reading order is bottom-up: hosting → build → domain kernel → UI → backend →
storage → AI.

### 3.0 The rented infrastructure, named once

So the rest of this document can talk about *what we built* instead of *whose
cloud we built it on*, here is the entire commercial stack, stated once and never
belabored again: the static site is hosted on **GitHub Pages** and fronted by
**Cloudflare** (DNS, CDN, TLS, WAF/CSAM scanning, edge rules); the dynamic
backend runs on **Cloudflare Workers**; persistent state lives in **D1** (edge
SQLite), **R2** (egress-free object storage), **Durable Objects** (stateful
coordination + WebSockets), and **Vectorize** (a semantic index); AI inference
runs on **Cloudflare Workers AI** with an optional fallback to the owner's local
GPU. Every one of these sits inside a free tier.

From here on we refer to these by **role** — *static hosting*, *the edge
functions*, *the relational store*, *the object store*, *the coordination layer*,
*the vector index*, *managed inference* — because the interesting part of this
project is not which products we picked. It is the system we assembled on top of
them, and that system is designed to outlive any one of them (see §6).

### 3.1 A static-first reading surface — *the reading path depends on nothing*

The site is **prebuilt static files** committed into `docs/`. "Deploying the site"
is just `git push`; there is no server-side build and no server-side render. Every
page, PDF, image, and generated artifact is committed and served as-is.

**Why we built it this way:** a static reading surface is free forever, is the
fastest possible page load, is trivially indexable, and **degrades to plain HTML**
if every script fails. For a library whose whole point is that people *read* it,
the reading path must never depend on a server being up or a bundle loading. This
is the load-bearing constraint of the entire project — everything dynamic is an
*enhancement bolted onto* an already-complete static page, never a prerequisite
for it. The cost is that dynamic features cannot be server-rendered into the page;
we embraced that, and §3.5 is how we made the enhancement seamless anyway.

### 3.2 A library we typeset ourselves — *content as infrastructure*

The library isn't scraped HTML. Each of ~250 works is converted from a preserved
source (Project Gutenberg, CCEL ThML, Wikisource, LacusCurtius, …) by a Python
converter **we wrote** into **our own LaTeX**, then rendered two ways: `pdflatex`
produces print-quality PDFs, and Pandoc produces clean, semantic HTML with stable
heading ids.

**Why we went to this trouble:** TeX is the only system that makes a 900-page
critical edition with Greek, Hebrew, footnotes, and a table of contents look
*right*, and it is byte-for-byte reproducible (we pin `SOURCE_DATE_EPOCH`), so git
only churns when the text actually changes. One source (`*-body.tex`) yields both
the PDF and the web edition, and Pandoc's `.unnumbered` heading model is exactly
what **our client-side deep-linker** keys on to make every paragraph of every
Father addressable by URL. The library is *content as infrastructure*: the same
clean corpus is what the AI retrieves from, so its cleanliness is load-bearing
twice — for the human reader and for the machine.

### 3.3 A typed, pure domain kernel — *the heart is a shared rulebook*

The application's **rules** — validation, permissions, ranking, routing, identity
classification, full-text-search-injection safety, DM lifetimes, the board
taxonomy — live in a **PureScript kernel**: `purescript/src/Domain/*.purs`, ~22
small modules, compiled to plain ES modules. This is the single most deliberate
thing we built.

**Why a typed functional core:**

- **Illegal states are made unrepresentable.** `Fts.SafeMatch` has no public
  constructor, so an un-sanitized full-text-search query *cannot exist* as a
  value — the injection guarantee is enforced by the type system, not by a
  reviewer remembering to call a sanitizer. `Auth.AuthState` cannot hold a hash
  without a key. This is the payoff a mainstream language can't give you: whole
  classes of bug become unspellable.
- **It is shared by the browser and the server.** The same compiled kernel is
  imported by the client bundle *and* by the backend. A rank threshold, a faith
  code, a category key, a pseudonym derivation, a DM TTL — each is defined
  **once**. Before the kernel, the client and server each had their own copy and
  they drifted (a real bug we shipped: bio cap 1000 in the client, 500 in the
  server). Now drift is impossible by construction.
- **ADTs + smart constructors + `Maybe`/`Either`** force every edge case to be
  handled at the boundary instead of `undefined` leaking through.

The kernel is the *model* in the truest sense: the pure, testable heart.
Everything else is an edge around it.

### 3.4 Typed effects at the edges — *TypeScript where the world is messy*

Everything that is **not** pure domain logic is **TypeScript**: the view layer,
the app shell, the ~8,000-line browser client, and both backend workers. The
entire hand-written surface is strict-`tsc`-clean.

**Why not the kernel language everywhere?** Because the edges are *effectful and
host-shaped*, and there a pure functional language's FFI ceremony buys nothing.
Typing a `fetch` retry loop, a WebSocket lifecycle, an HTML rewriter, a database
query, or a UI template in PureScript means writing as much FFI as logic.
TypeScript gives 90% of the safety with zero boundary tax when the code is
*already* just orchestrating a host API.

**What TypeScript buys over plain JS here:** the client and workers are
thousands-of-lines files full of dynamic JSON rows and DOM grab-bags.
`tsc --strict` turns "this field might be undefined" and "this handler is called
with the wrong args" into compile errors, and it surfaced real latent bugs during
the JS→TS migration that no linter caught. Crucially, TS is a **type-erasure**
language: we proved every conversion behavior-neutral by rebuilding the bundle and
showing it was byte-identical (types compile to nothing), which is how a
20,000-line migration shipped with confidence.

**The decision rule, stated plainly:**

> New *rules* (validation, permissions, state transitions, parsing, math,
> shared constants) → **the kernel** (PureScript), tested once, used by both
> sides. New *edges* (DOM, fetch, crypto, WebSocket, storage, HTML rendering,
> SQL) → **TypeScript**. When unsure, ask "is this a rule or an effect?" Rules go
> in the kernel; effects stay in TS.

### 3.5 A view layer that can vanish — *progressive enhancement over static HTML*

The reading site is static HTML. A **Lit** app shell **we built** progressively
upgrades it into a single-page app: every page becomes a "boot," navigation
soft-swaps `<main>` from a page cache, and each forum view (`board`, `topic`,
`member`, `profile`, …) is a reactive component in light DOM. The same shell owns
a persistent audio dock (one shared player that survives navigation) and installs
the site as a PWA.

**Why Lit and not React/Vue/Svelte:** Lit is a *thin* library (~a few KB) of
web-standards — Web Components + reactive templates — with no virtual DOM and no
opinion about your data. That matters because we deliberately keep the view
**presentational**: components hold no business logic. They render state the
kernel computed and call effects the TypeScript FFI provides. A React app tends to
accrete logic in components and hooks; we wanted the opposite — a render layer so
dumb it can be swapped without touching a rule. Its light-DOM,
enhancement-over-a-static-page model is also the only one that respects §3.1: if
the bundle never loads, the static HTML is still there and still readable.

### 3.6 One built stylesheet — *Tailwind as a token engine, not a paradigm*

Styling is **Tailwind v4** in CSS-first mode: one entry, `styles/main.css`,
compiles to a single committed, minified `docs/style.css`. It registers our design
tokens in an `@theme` block mapped to the **live CSS variables** the palette
redefines under dark mode, so `bg-*`/`text-*`/`border-*` inherit light/dark
switching for free, and it pulls in the `typography` plugin for the reading
corpus's `prose` surface.

**Why Tailwind at all, given the rest of the stack is anti-framework:** it earns
its place for exactly two things — the **design-token system** (one source for the
palette, dark mode for free) and the **`typography` plugin** over the ~250
generated library pages. It is a *build-time* tool with **zero runtime** and
**zero bundle cost** — it emits plain CSS — so it never touches §3.1: the output
is a static stylesheet.

**Why mostly NOT utility classes, though:** two departures from idiomatic
Tailwind, both forced by measurement. First, **preflight (its reset) is not
imported** — the site keeps its own base reset, because preflight would flatten
the reading typography across every generated page. Second, **content
auto-detection is disabled** (`source(none)`, scanning enabled per surface via
explicit `@source` lines) because the generated prose contains ordinary English
words like "table," "block," and "hidden" that Tailwind would mistake for utility
names and emit as spurious CSS. And when we tried converting the app chrome and
forum to `@apply`/utilities, it *measurably bloated* the output (~68 KB vs ~63 KB)
for zero visual change: `@apply` drags in Tailwind's utility machinery for
stateful, breakpoint-gated component CSS that is already clean and token-driven. So
those surfaces stay hand-authored component CSS — *inside* the Tailwind build (they
consume the `@theme` tokens) but not expressed as utilities. Tailwind here is a
token engine and a `prose` generator, not a styling paradigm we adopted wholesale.

### 3.7 A backend of request-scoped functions — *the imperative shell*

The two dynamic features (the forum/DM/wall/bot platform, and the contact form)
are **edge functions**: they run same-origin with the pages (so no CORS), spin up
per request, and are billed per request.

**Why functions and not a server:** a server you rent is a server you pay for and
patch, 24/7, whether or not anyone is posting. Request-scoped functions cost
nothing at idle, scale to zero, need no OS, and sit in the same edge that already
fronts the CDN. The whole platform's compute is "run this function when a request
arrives." For a bursty, niche community that is exactly the right billing model and
the right operational surface: there is nothing to keep alive.

What we built *inside* that model is the interesting part. The backend is not a fat
controller — it is a **declarative route table** (`ROUTES`), a set of composable
**middleware** (`keyed`/`keyedGated` handle parse → rate-limit → auth →
block-gate in one place), and thin handlers that call named **services**
(`deliverNotifications`, `broadcastBoard`, the merecat retrieval/generation). The
worker was a 6,400-line monolith; we split it into a shared core, a repository
layer, the coordination objects, and the handlers — each split proven
behavior-neutral (see §5, rule 6).

### 3.8 Storage matched to the shape of the data — *four stores, four jobs*

Persistent state is split across four stores, each chosen for what its data
*is*, not for its brand:

- **The relational store** (edge SQLite) holds comments, profiles, DMs,
  notifications, walls, and the librarian's chunk index. SQL is the right model
  for threaded, joined, filtered social data. On top of it we built a small
  in-house repository layer (see §3.9) rather than pulling in an ORM.
- **The object store** (egress-free) holds avatars, DM and wall media, backups,
  and the 3.26 GB of Bible audio. Egress-free is decisive: serving media costs
  nothing to *read*, which is what a media-heavy social app does constantly. DM
  media is client-encrypted, so the store only ever holds ciphertext.
- **The coordination layer** is the one place we need single-writer consistency
  plus a live socket fan-out. We built two coordinators on it: **`BoardHub`**
  broadcasts new posts to everyone watching a board over WebSockets (a real-time
  forum with no polling), and **`ChatRoom`** is a per-conversation state machine
  that owns an AI generation so it survives a reader refreshing mid-answer. Idle
  sockets hibernate, so a busy forum doesn't multiply cost.
- **The vector index** is the semantic leg of the AI's retrieval. Its free-tier
  cap on vector count (~5k) is *why* retrieval is hybrid rather than pure-vector
  (see §3.10) — a constraint that shaped the design, not an afterthought.

The discipline is matching each kind of data to the store whose free tier it fits:
relational data to SQL, blobs to egress-free objects, realtime to the coordination
layer, semantics to vectors.

### 3.9 A hand-rolled repository, not an ORM — *`db.ts`*

The backend's data access goes through a small repository layer **we wrote**,
`db.ts`: typed row mappers, single-sourced SQL fragments (the author join was
copy-pasted 25 times before this), an `inList()` that emits `?N` placeholders, and
a tiny `Query` builder that auto-numbers binds.

**Why hand-rolled, not Prisma/Drizzle/Knex:** a general ORM is a dependency, a
build step, a runtime, and a bundle-size and cold-start cost — all to abstract a
database we're perfectly happy writing SQL against. In a request-scoped function,
every kilobyte of bundle is startup latency, and every dependency is a
supply-chain and free-tier-fit risk. What we actually needed wasn't an ORM's query
*abstraction*; it was **de-duplication and type-safety for the SQL we already
wrote**. So `db.ts` is ~80 lines that kill the duplication and give us typed
mappers, and the SQL stays legible and reviewable. It is "an ORM" only in the
sense of "one place that owns the row↔object mapping," and it is unit-tested
(`inList` is proven to emit exactly the strings the hand-rolled loops did), which
is how we route SQL through it without fear.

### 3.10 A hybrid RAG librarian — *merecat*

**merecat** answers questions by retrieving from the library and generating an
answer in the site's voice. The retrieval engine is ours and it is
**five-legged**: a semantic leg over the vector index, a tier-weighted BM25 leg
(the corpus is weighted into nine bands so the site's own voice and the Scriptures
outrank background sources), a *raw* BM25 leg (so a verbatim quote can't be
crowded out by boosted works), a phrase comb (so a quotation in the question finds
the text that *is* the quote), and a Bible-verse-anchor leg (so a chapter:verse
reference fetches that verse's own chunk) — merged, then reranked. It is hybrid
because the free vector budget can't hold the whole corpus, so the keyword legs
cover what vectors don't.

Generation runs one of two ways behind a single admin flag: **managed edge
inference** (a small model for moderation, a Qwen MoE for chat) as the always-on
baseline, or the **owner's local GPU** reached over a private tunnel — same shelf,
same five legs, whole-corpus vectors, an uncensored model — with automatic
failover from local back to the cloud *into the same response stream*.

**Why hybrid:** managed inference is metered and shared with moderation, so it is
the free baseline; the local GPU is unlimited depth for hard questions when the
owner's machine is up. Because the failover happens inside one stream, a reader
never knows which engine answered. The genuinely hard engineering here isn't the
model — it's the **disconnect contract**: an answer must outlive a reader who
refreshes mid-stream. The coordinator owns the generation and is the sole writer
to the thread, partial answers are flushed as they grow, and a reopened page
rejoins the *living* generation rather than losing it. That contract, not the
choice of model, is what makes a domain-tuned RAG assistant feel solid on a free
budget.

---

## 4. How we compare to MVC — and where we deliberately differ

If you squint, the stack is MVC-shaped:

| MVC role | Here | Note |
|---|---|---|
| **Model** | PureScript `Domain.*` kernel + `db.ts` rows | the rules + the data mapping |
| **View** | Lit components + Pandoc-rendered pages, styled by built CSS | strictly presentational |
| **Controller** | the route table + middleware + services | request → services → response |

But we differ from textbook MVC in three deliberate ways:

1. **The Model is shared across the client/server boundary, and it's *pure*.** In
   classic MVC the model lives on the server. Ours is a compiled kernel imported by
   *both* the browser and the backend, so the "model" isn't a server-side object
   graph — it's a set of pure functions and unrepresentable-illegal-state types
   that both tiers agree on. There is exactly one audited place, `app/core.ts` (the
   "membrane"), where the kernel's `Maybe`/`Either`/ADTs are erased into plain JS
   shapes for the untyped consumers. That membrane is a concept MVC doesn't have,
   because MVC doesn't cross a language boundary.

2. **The View can vanish and the app still works.** Progressive enhancement over
   static HTML means the "view" is two-layered: a complete static page and an
   optional reactive upgrade. Classic MVC assumes the view is always rendered by
   the framework; ours assumes it might not run at all.

3. **The Controller is a declarative route table, not a fat controller.** Dispatch
   is a data structure, cross-cutting concerns are composable middleware, and
   business operations are named services. Handlers are thin. This is closer to
   "functional core, imperative shell" than to Rails-style controllers — the shell
   does IO and composition; the core (kernel) makes the decisions.

So: MVC as a *map*, "functional core / imperative shell" as the *actual
discipline*.

---

## 5. The design rules (the "how much of each," stated as law)

These are the standing rules a contributor — human or AI — follows:

1. **Rules in the kernel, effects in TypeScript, rendering in the view layer.**
   (§3.4)
2. **Single-source everything shared.** A constant, table, or validator used by
   both client and server is defined once in a `Domain.*` module and imported both
   sides. The client used to keep inline "fallback" copies; those are retired — the
   kernel is the *only* source, so drift is impossible.
3. **One membrane.** `app/core.ts` is the single audited place where kernel types
   are erased for JS. Nothing else returns a raw kernel constructor across the
   boundary. Type safety lives *inside* the kernel; the membrane keeps it honest at
   the edge.
4. **The view stays dumb.** Components render kernel-computed state and call
   FFI-provided effects. Logic that creeps into a component is a smell; move it to
   the kernel.
5. **The budget is a law, not a goal.** Every feature is checked against the
   free-tier limits it will consume *before* it ships (see §6). "It works" is
   necessary but not sufficient; "it works within the budget at scale" is the bar.
6. **Behavior-neutral refactors are proven, not asserted.** Type migrations are
   proven byte-identical; SQL extractions are proven token-identical; the route
   table was proven by an independent parity diff; the file split was proven by an
   unchanged bundle function-set. We don't *hope* a refactor didn't change
   behavior — we show it.

---

## 6. The economics — how a platform + an AI run on free

The near-zero bill isn't a happy accident; it's an engineered constraint. Stated
by role rather than by product, the limits we live inside and *how* we live inside
them:

- **Compute:** billed per request, zero at idle. The reading site adds **zero**
  backend requests (it's static). The app shell adds zero API traffic — its page
  cache makes back/forward free. Only genuine dynamic actions (post, DM, ask) hit
  a function at all.
- **Realtime:** the board fan-out and the AI chat run on the coordination layer
  with **hibernatable** sockets — idle connections cost nothing, and the fan-out
  is read-only (posting stays on the authenticated HTTP path), so a busy forum
  doesn't multiply write cost.
- **Database:** ~100k rows written/day free. Big AI-corpus ingests are budgeted
  (`--budget-rows`) to stay under it; the social tables are tiny by comparison.
  Disappearing DMs are a *storage* win as much as a privacy one.
- **Objects:** 10 GB, egress-free. Media lives here precisely because reading it
  back costs nothing, and DM media is stored only as client-encrypted ciphertext.
- **AI:** inference is metered and shared with moderation, so the bot is
  rate-capped per-user/per-day and retrieval is hybrid to fit the ~5k-vector
  budget; when the owner wants unlimited depth, generation switches to the local
  GPU with cloud failover.

**Why this scales until we grow, and survives if a vendor doesn't:** every
per-request cost is bounded and idle cost is zero, so the bill tracks *activity*,
not *existence*. A dormant niche community costs nothing; a busy one costs a
little. And because §3.0's products are used strictly through their *roles* —
static hosting, edge functions, a relational store, an object store, a
coordination layer, a vector index, an inference endpoint — none of the
architecture assumes "free" as a *semantic*, only as a *budget*. If we outgrow the
free tier, or a provider changes, the *same system* migrates by swapping a role's
implementation: the relational store to a bigger SQL tier, the functions to a paid
plan (still functions), the vector index to more vectors, the local GPU to a
rented one. The platform was built to be correct first and cheap by consequence,
so growth is a billing event, not a rewrite.

---

## 7. A newcomer's tour (where to look)

1. **This file**, then `README.md` (how it's built) and `CLAUDE.md` (how it's
   operated), then `docs/architecture/CODEBASE.md` (the measured module map).
2. `purescript/src/Domain/Route.purs`, `Auth.purs`, `Access.purs` — the rules that
   decide what a URL shows and who may act. Small, pure, readable; each has a
   1:1 test under `tests/purescript/`.
3. `app/core.ts` — the membrane, where those rules cross into JavaScript.
4. `app/shell.ts` → `app/views/board.ts` → `topic.ts` — one full *read* path, from
   soft-navigation to a rendered view over the kernel.
5. `comments-worker/src/index.ts` (the `ROUTES` table + `fetch`) → a handler →
   `lib.ts` (shared core) → `db.ts` (the SQL) — one full *write* path, HTTP to
   database.
6. `comments-worker/src/durable.ts` — how live updates and the AI chat coordinate.
7. `librarian/` + `local/` — the AI's mind: the corpus manifest, the persona, the
   ingest pipeline, and the local GPU twin.

---

*The short version: put the rules in a typed pure kernel both tiers share, keep the
view a dumb progressive-enhancement layer, do all IO in cheap request-scoped
functions with storage matched to the shape of each kind of data, and single-source
everything so nothing can drift. The rented infrastructure is named once and used
by role; the system on top of it is the point. That is how one person serves a
library, runs a social platform, and hosts a domain-tuned AI — for the price of a
domain name.*
