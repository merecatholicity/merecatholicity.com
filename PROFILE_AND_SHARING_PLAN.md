# Custom @handles · per-page social sharing · looser avatars

## Context

Three related requests, to make profiles feel like real profiles and make shared links look right:

1. **Custom @handle** — a member can set a URL handle in the profile editor; the profile URL is based on it, falling back to the auto-generated pseudonym/hash when unset.
2. **Better social sharing everywhere** — page-specific `<head>` Open Graph/Twitter meta so a shared link shows *what the page actually is*: a member's profile shows their **avatar + nick + @handle + bio**; Home / Community / a specific public post / a book each get their own card.
3. **Looser avatars** — allow larger than 400×400 (constrain at display via CSS) and raise the size cap to 1 MB.

**Decisions locked this session:** handle = a **dedicated, unique field** separate from the display nick (Twitter model); handle URL = **query-param `profile.html?u=<handle>` for now**, the pretty `/@handle` deferred.

**Hard constraints found in the code:**
- `profiles` has **no** handle column (`schema.sql:161`); `nick` is free-form and non-unique (`Domain.Profile.limits.nick = 40`). The unique auto-name is `displayName(hash)` (`Domain.Pseudonym`).
- Profiles are addressed `profile.html?u=<hash>`; `?u=` is resolved at `comments.js:7650` (`viewProfile`). The value is a 64-hex hash today.
- The worker routes **`/api/*` only** (`index.js:5838+`) — nothing serves `/@x`, and nothing rewrites `profile.html`'s head. Static Pages + JS-blind crawlers ⇒ **dynamic per-entity OG needs an edge transform** (see B2).
- OG/Twitter meta exists on **only** `index.html`, `book.html`, `the-book.html`; `content.py` emits only `<meta name="description">` (`content.py:75`).
- Avatars today: **400×400 JPEG, 500 KB** (worker `handleAvatarUpload` + the client canvas rasterize; CLAUDE.md).

**Collision note:** another agent is live in `index.js` (DM/notif/wall), `comments.js` (DM/profile/feed), the `Domain` layer, and `app/views/profile.js` (Phase C puts a wall on the profile). Features **A** and **C** touch the same functions + need a worker deploy → sequence to avoid conflicts (below).

---

## Feature A — Custom @handle (dedicated field, `?u=<handle>`)

**Schema (additive):** `profiles.handle TEXT` + a **case-insensitive UNIQUE index** (store lowercased; `CREATE UNIQUE INDEX profiles_handle ON profiles(handle)`). Mirror in `schema.sql`; apply to prod D1.

**Domain (single-sourced client+worker):** new `Domain.Handle` — `mkHandle :: String -> Either HandleError Handle` with **sane constraints**: lowercase `[a-z0-9_]`, **3–30 chars**, must start with a letter, no leading/trailing/double `_`, not all-digits (avoid hash confusion), and a **reserved-word list** (`merecat, admin, api, about, community, profile, messages, index, home, terms, contact, library, sources, feed, null, me, u`). Tests in `tests/purescript/handle.test.mjs`.

**Worker:**
- `handleProfileSave` accepts `data.handle` → validate via the kernel, lowercase, **uniqueness check** (`SELECT hash FROM profiles WHERE handle=? AND hash<>?`) → `409 {error:'handle_taken'}` on clash; empty clears it.
- **Resolver:** `handleProfileGet` (and any author payload) accepts a **handle OR hash** for `?u=`: 64-hex → hash; else lowercase → `SELECT hash FROM profiles WHERE handle=?`. Return the `handle` in the profile payload so the client can build the pretty URL.

**Client (`comments.js`):**
- `editProfile` gains a **"Profile URL — @handle"** field with inline validation (reuse the kernel via `mcCore`) + a live availability hint (debounced) and a shown result URL.
- `profileHref(hash)` (`:405`) prefers the member's handle when known (thread `handle` through the author/profile payloads), else the hash.
- `viewProfile` (`:4180`, dispatched `:7650`) resolves **handle-or-hash** via the resolver. `Domain.Route` needs **no new ctor** (the `?u`/`?profile` value simply becomes handle-or-hash).

**Fallback:** no handle ⇒ URL stays `profile.html?u=<hash>` and `displayName(hash)` remains the shown name — unchanged behavior.

**Pretty `/@handle` (deferred):** when wanted, one Cloudflare URL-rewrite rule `^/@(.+)$ → /profile.html?u=$1`; then `profileHref` emits `/@handle`. No code blocker now.

---

## Feature B — Social sharing (Open Graph / Twitter cards)

### B1 — Static per-page OG (build-time; NO infra; do FIRST, zero collision)
Give every page a correct default card in its `<head>`.
- **`content.py`:** emit a full OG/Twitter block from frontmatter — `og:title` (title), `og:description` (description or the site tagline), `og:type` (article/website), `og:url` (from the output path), `og:image` (a site default banner), `twitter:card=summary_large_image`. One central change covers all `content.py` pages.
- **Hand pages** (`community, profile, messages, merecat-ai, library, about, contact, kjv, douay-rheims, where-to-begin`): add a sensible site-level OG block to each head (e.g. "Community — Mere Catholicity"). `nav.py` only rewrites the nav block, so head edits persist across `make menu`.
- **Corpus/resources pages** (Schaff/Newman/… built by pandoc via `resources/*.py`, ~250 pages): add OG through the **pandoc template/variables** (each work has a title + our blurb). A larger, separate slice — do after the primary pages.
- **Asset:** a proper **1200×630 (1.91:1)** `og:image` banner (reuse `cover.jpg` as a stopgap; a real banner is better). Owner asset or generate one.

### B2 — Dynamic per-entity OG (profiles + specific posts) — needs an edge transform (INFRA DECISION)
A shared `profile.html?u=<handle>` or `community.html?topic=T#comment-C` must carry per-entity OG **in the response HTML** (crawlers don't run JS). Only an edge worker can inject it.
- **Approach:** the **existing comments worker** (it already has the D1 data) gains routes on `merecatholicity.com/profile.html*` and `/community.html*`. For **crawler user-agents only** (`facebookexternalhit, Twitterbot, Slackbot, Discordbot, WhatsApp, LinkedInBot, TelegramBot, …` — gate to protect free-tier), it fetches the origin page and **HTMLRewriter-injects** per-entity OG: profile → avatar (R2 `/api/comments/avatar?hash=…`), nick, `@handle`, bio; post → title/snippet/author. Non-crawler traffic passes straight through (or the route early-returns on non-bot UAs).
- **Infra (the one owner decision):** approve the **new worker route** on `/profile.html*` + `/community.html*` (a `wrangler.jsonc`/dashboard route pattern). Bot-gated ⇒ negligible request volume (1 worker req + 1 origin subrequest per bot fetch). Recommend the existing worker, not a new one.

---

## Feature C — Looser avatars (needs a worker deploy)

- **Cap 500 KB → 1 MB:** client pre-upload guard + worker `handleAvatarUpload` size check.
- **Dimensions:** allow larger stored images — rasterize the client canvas from 400×400 to **512×512 (or up to 1024²)**, keep **square** (preserves the round display + R2 one-key-per-identity) or allow non-square with `object-fit:cover`. Loosen any hard 400×400 check in the worker to a **max (≤1024)**; magic-byte sniff + LLaVA screen unchanged.
- **Display stays constrained by CSS:** confirm every avatar site (`.comment-avatar`, profile header) has a fixed px size + `object-fit:cover` so a larger/non-square upload never breaks layout (add where missing).
- The preset gallery draws onto the same enlarged canvas.

---

## Sequencing (around the in-flight agent)

1. **B1 static-page OG** — Pages/build only, **zero collision, no worker, no infra** → do now.
2. **C avatar** — small; **coordinate the worker deploy** with the other agent so it doesn't race their worker testing.
3. **A @handle** — after Phase C's profile changes land (they edit `renderProfile`/`profile.js`/`Domain.Route`); schema migration + worker deploy.
4. **B2 dynamic OG** — after the owner approves the `/profile.html*` + `/community.html*` worker route; built on the same worker, alongside A (it needs the handle resolver).

## Verification

- **`make tests`** (Domain.Handle format/reserved/uniqueness-shape), **`make jscheck`**, **`make bundle`** determinism + `app.js?v=` / `comments.js?v=` bumps, **`make html`** rebuild for B1.
- **Worker/data:** apply `profiles.handle` + unique index and the avatar-cap change to prod D1/worker; deploy.
- **Layer-2 headless:** the handle editor + availability + `?u=<handle>` resolution; avatar upload of a >500 KB / >400px image renders correctly and stays capped in the UI.
- **B2 crawler check:** `curl -A facebookexternalhit https://merecatholicity.com/profile.html?u=<handle>` returns per-profile OG; validate a profile, a post, Home, and a book with the Facebook / Twitter / iMessage share-debuggers.
