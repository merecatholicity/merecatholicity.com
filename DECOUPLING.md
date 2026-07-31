# Decoupling & mobile-readiness audit

**Goal.** Prepare the platform so business logic never knows or cares whether a
request came from the browser, a native iOS/Android app, or a CLI — and so new
front-ends and integrations (Discord/Matrix/Telegram/webhooks, push) can be
added without touching the forum core.

**Headline verdict.** The platform is already **substantially decoupled** — far
more than a first look suggests. Identity is a hashed key in the request body
with no cookies or sessions; a missing `Origin` header is deliberately allowed
so non-browser clients work as-is; storage, search, media, and permissions all
sit behind a clean, uniform `{ok, …}` JSON contract that never leaks SQL or R2;
email is fully out of the core; the event fan-out is already a single
structured sink. A native client can **read everything and drive the entire
live-WebSocket layer today with zero server change.**

The honest gaps are **narrow and named**, not architectural rot. There are five
worth acting on, in rough priority, plus three small security fixes to land
before any app ships:

1. **Render/constant triplication** — the largest debt. ~8 constant sets and the
   whole body renderer live only in the web client and are served by no
   endpoint. → a served constants document + `assigned`/`rank` on author rows.
2. **The Turnstile wall on the four writes** — the only thing a native client
   genuinely *cannot* do today. → a mobile sitekey or device-attest exchange.
3. **No push delivery** — the one net-new backend capability a real app needs. →
   a `push_tokens` table + a best-effort fan-out from the existing notify hook.
4. **The event bus isn't quite a bus yet** — emission is inconsistent and the
   back-room privacy gate is scattered. → route all emits through one sink and
   centralize the gate; then a webhook/Discord subscriber is a one-function add.
5. **Deployment config is hardcoded** — a staging/second deployment needs source
   edits. → lift `ALLOWED_ORIGINS`, `SITE`, contact `FROM` into vars.

None of this calls for the enterprise patterns in the classic "decouple from X"
table (repository/DAL, DI containers, microservices, an ORM, a message broker).
In a single-file deno Worker with no npm, on the Cloudflare free tier, with a
proven-in-place discipline that punishes big-bang rewrites, those would add real
regression risk and buy nothing a second client can observe — **the JSON
contract already is the boundary.** Every recommendation below is either
doc-only or a small, additive, independently-testable change.

The exhaustive wire contract this audit produced is
[`comments-worker/API.md`](comments-worker/API.md).

## Shipped in this pass

A single combined worker change landed the security fixes plus the additive,
lowest-risk gaps; the two credential-dependent gaps got a server landing pad.

- **Security (§3): all fixed.** merecat chat frames now reach authenticated
  sockets only (auth-failed sockets are closed), the WS ask re-checks IP bans
  (connecting IP threaded into the DO), `/report` returns an identical 404 for
  back-room ids, and the `Upgrade` compare is case-insensitive.
- **Gap 1 (§2.1): shipped, additive.** `GET /api/comments/config` serves the
  constant tables; every author row now carries `assigned` (and `rank` where a
  count exists). The web client keeps its inline copies as a fallback — the
  de-duplication of `comments.js` is the remaining follow-up.
- **Gap 4 (§2.5): shipped.** All board events funnel through one send primitive
  (`sendToHub`) that carries the back-room gate; a webhook/Discord subscriber is
  now a single addition there.
- **Gap 5 (§2.6): shipped.** `ALLOWED_ORIGINS`, `SITE`, and the contact `FROM`
  are vars (falling back to prod values); a `staging` env stanza has distinct
  rate-limit namespaces; the stale email comments are gone.
- **Gap 3 (§2.3): scaffolded.** A `push_tokens` table + register/unregister
  endpoints + a `deliverPush` hook wired into the notify and DM paths, gated off
  by `PUSH_ENABLED` — a no-op until an app and a provider exist.
- **Gap 2 (§2.2): documented.** The native-Turnstile path is written up; the
  origin var makes a future hybrid-app origin allowlist config-only. No wall
  change (still fail-closed).

Remaining owner steps before a real app ships: apply the `push_tokens` DDL to
D1; when an app exists, mint a mobile Turnstile sitekey (or a device-attest
exchange) and wire a push provider (APNs/FCM/VAPID) into `deliverPush`; and,
later, switch `comments.js` to read `/config` and delete its inline copies.

---

## 1. The classic layer table, scored for this codebase

For each layer: what it is today, whether it blocks the mobile goal, and the
calibrated move (many are "leave it").

| Layer | State today | Verdict | Move |
|---|---|---|---|
| **Transport** (HTTP/WS vs logic) | Flat exact-match dispatcher → named handlers; two WS upgrades → Durable Objects; one origin check + one try/catch wrap all. Framework-free, no HTML ever. | **Fine.** Thin and uniform; a native client speaks identical JSON/WS with no adapter. | Leave. At most a `readJson()` helper to dedupe the parse+400 boilerplate. No sweeping refactor. |
| **Authentication** (key+hash, Turnstile) | `sha256hex(key)` only; key in body or WS auth frame, never a URL; no cookies/sessions/expiry; missing `Origin` passes. | **Clean & transport-neutral.** The model needs nothing for mobile. | The one wall is **Turnstile on 4 writes** → §2.2. Keep fail-closed. |
| **Storage** (is SQL confined) | ~247 inline `.prepare()` calls; no DAL; a few shared query fragments. | **Not confined — but it doesn't matter.** The JSON contract is the boundary; the client never sees SQL. | Leave. A repository/ORM would add risk with no second-client payoff. Keep extracting reused fragments opportunistically. |
| **Business logic** (handlers thin?) | Handlers are **fat** (`handlePost` inlines validate/screen/insert/notify/broadcast) but consume parsed JSON and return `json()` — they don't know the caller. | **Not thin, but transport-agnostic in the way that counts.** | Do **not** refactor for thinness (large regression surface, no payoff). Spend the effort pulling client-only *render* logic server-ward instead. |
| **Serialization** (envelopes) | Uniform `{ok,…}`/`{ok:false,error}`; unix-second ints; consistent `{items,total,page,per}`. | **Strong & predictable.** | Pin the envelope, WS frame schemas, and the soft-success shapes in `API.md` (done). Don't change shapes. |
| **Frontends** (2nd client w/o server change) | API is complete and CORS-free, but rendering + ~8 constant sets are **client-only, served by no endpoint** (markdown grammar, emoji whitelist, `BIBLE` table, `RANKS`, `CATS`, `FAITH` labels, ADJ/NOUN pseudonyms). | **Largest decoupling debt.** A second client works but must *triplicate* the constants and reimplement the renderer. | §2.1 — served constants + `assigned`/`rank` on rows. |
| **Search** (behind what interface) | `GET /search` over FTS5; injection-safe `buildMatch`; `U+0002/U+0003` highlight markers; degrades to empty envelope, never 500s. | **Cleanly abstracted.** FTS5 fully hidden. | None. Note the marker convention (done in `API.md`). |
| **Cache** | Server `Cache-Control` (300/60/86400/1800s); back-room refusals cached byte-identically; client store + read-budget coordinator. | **Server caching is clean** and honored by any HTTP client. | The shared read bucket is the catch → §2.4 (client discipline, not a server change). |
| **File storage** (R2) | Avatars behind `/avatar` GET/POST/delete; sniff + exact 400×400 + LLaVA screen server-side; timestamp cache-buster. | **Fully behind HTTP.** Clean. | Document the 400×400/JPEG/≤500 KB *client* obligation (done). Optional later: accept common formats + resize server-side. |
| **Email** | **Removed** from the core (no `send_email` binding, only a stale comment). Contact form is a separate worker. | **Fully decoupled.** | Delete the stale `send_email` comment in `wrangler.jsonc`. |
| **Notifications** | In-app `notifications`/`watches` + `deliverNotifications` in `waitUntil`, surfaced by **polled** unread endpoints. No push anywhere. | **In-app model is clean; there is no push channel** — the one genuine backend gap mobile exposes. | §2.3 — `push_tokens` + fan-out. |
| **Background jobs** | Monthly cron, sequential `.then` chain, each prune self-`try/catch`'d so `runBackup` always runs. | **Fine, client-independent.** | None (optional `.catch(log)` between steps). |
| **Events** | `BoardHub.publish()` is a **single universal sink**; events are versioned `{v:1,t,scopes,…}` JSON — but emission is split (`publishLive` vs inline `hub.publish`) and the back-room gate is re-coded at ~6 sites. | **Partially ready.** A subscriber is addable in one place, but centrally depends on every emit site's discipline. | §2.5 — route all emits through one sink, centralize the gate. |
| **Feature flags** | Env vars (`MODERATION_MODE`, `ALLOW_ANON`→`anon`) + a live-editable `config` table (5-min per-isolate cache). | **Reasonable & lightweight.** | None. Optionally surface `ALLOW_ANON`/`MODERATION_MODE` via `/config`. |
| **Logging** | Structured `console.log(JSON.stringify({event,…}))` throughout; observability on. | **Fine.** Greppable, consistent. | None. |
| **Metrics** | D1 counter tables (`usage`/`user_usage`) + admin `/stats`; Cloudflare observability. | **Minimal but adequate** for a free-tier platform. | None — a metrics stack would be over-engineering. |
| **Configuration** | Env/secrets are sane; but `ALLOWED_ORIGINS`, `SITE`, `PAGES`, `BOARD_CATS`, the bot hash, and contact `FROM` are **hardcoded in source**; rate-limit namespace ids fixed in `wrangler`. | **Mostly fine; identity already tolerates native.** | §2.6 — lift the deployment-varying ones into vars. |
| **Permissions** | Data-driven flat `admins` table is sole truth; `isAdminHash` is a table lookup; back-room fully server-enforced with indistinguishable refusals; client learns status from `profile.admin`. | **Strong & entirely server-side.** A mobile client inherits every check. | None material (optional: normalize auth-before-validate ordering). |

---

## 2. The named services, and the roadmap

Your seven target services, verdict then the single change that helps each most,
ordered as a build sequence (smallest-risk / highest-leverage first).

### 2.1 Forum + Frontends → **served constants + resolved names** *(do first)*

**Verdict: API-ready, render-leaky.** Full CRUD + moderation + live updates over
clean JSON/WS; a second client can read and post today. It just can't *render*
faithfully without vendoring the markdown grammar, emoji whitelist, `BIBLE`
table, `RANKS`, `CATS`, `FAITH` labels, and the ADJ/NOUN pseudonym wordlists —
none of which any endpoint serves. Every author-bearing row returns only
`author_hash` + a nullable `nick`, so each client re-derives the display name.

**Two additive, cached, zero-behavior-change moves collapse the whole
triplication class:**

- **`GET /api/comments/config`** (cacheable like every public read) returning:
  `cats` (key + label + blurb + order), `faiths` (codes + labels + order),
  `ranks` (thresholds + labels), `pages` (the commentable whitelist), `bot_hash`,
  the emoji whitelist (or the pack-manifest URL), the `BIBLE` slug table, the
  ADJ/NOUN wordlists, and an explicit `apiVersion`. One fetch replaces ~8
  hand-kept copies for every future client and ends the worker↔client↔mobile
  drift. *(This is the single highest-leverage change in the whole audit.)*
- **Stamp `assigned` (the server `displayName`) and `rank` onto every
  author-bearing row** — post, topic head, reply, board latest-poster, DM
  thread/message, notification, search result. The code already exists
  (`displayName`, `rankFor`); this deletes the pseudonym wordlists and the rank
  ladder from clients *for rendering* even if `/config` still ships them for
  offline use.

What still can't be server-provided: the **body renderer** itself (bodies are
stored raw markdown-ish text by design). Freeze its grammar — including the
`away.html` outbound-link interstitial, which is a real safety policy, and the
never-`innerHTML` rule — as a versioned wire-format spec every client vendors.
`API.md` §6 is that spec's first draft.

### 2.2 Authentication → **a native-friendly Turnstile path** *(land last, with live testing)*

**Verdict: ready except one browser wall.** Identity is fully transport-neutral.
The only blocker is Turnstile on the four content writes (`POST /api/comments`,
profile save, DM send, avatar upload): tokens are minted by a browser widget and
the server rejects any not solved on the site hostname (`TURNSTILE_HOSTNAMES`),
failing closed. **No API-key or app-attest path exists** — a pure-native client
can read and use both WebSockets but cannot post, DM, save a profile, or set an
avatar.

Options, best first: **(a)** provision a second Turnstile sitekey for the app,
add its hostname/value to `TURNSTILE_HOSTNAMES`, render it in a thin WebView;
**(b)** host a minimal challenge page on the production domain in a WebView,
harvest the token, POST it from native code **with no `Origin` header** (native
omission passes the origin gate, and the token's solved-hostname is the site so
it clears the allowlist); **(c)** add a server-minted device-attest token
exchange that substitutes for Turnstile on registered app builds. **Keep
`verifyTurnstile` fail-closed regardless.** Note a hybrid WebView that POSTs from
`capacitor://`/`null`/a custom scheme is hard-`403`'d by the origin gate — post
from the prod origin or from native code without `Origin`.

### 2.3 Notification → **push** *(the one net-new capability)*

**Verdict: not mobile-ready as a delivery channel.** The in-app data model is
clean and client-agnostic — any client polls the same endpoints — but delivery
is **poll-only**; there is no APNs/FCM/Web-Push/VAPID anywhere. Polling can't
wake a backgrounded native app, drains battery, and every 90 s badge poll fights
the shared read bucket (§2.4).

**Move:** add a `push_tokens` D1 table keyed by identity hash + a register
endpoint, and a best-effort fan-out from the **existing** `deliverNotifications`
`waitUntil` (and the DM send path). Web Push (VAPID) is free-tier-friendly and
Workers-native; APNs (HTTP/2, free from Apple) and FCM via `fetch` also fit.
This removes the two polling limbs entirely — the biggest native UX win *and*
the biggest relief for the read bucket.

### 2.4 Cache/read-budget → **document the client obligation** *(no server change)*

`READ_LIMIT` is **one** 15-req/60 s bucket keyed on IP, shared across every read
endpoint. Behind CGNAT, mobile users collectively drain one bucket. The web
client survives only via a read-budget coordinator + 90 s badge caches. **A
native client must ship an equivalent governor from day one**, and must key
backoff on the **HTTP 429 status**, not on the English error prose the web client
currently regexes (`/too many|slow down/i`) — that string match is fragile and a
reworded error would silently disable it. Raising or identity-keying the bucket
would cost free-tier budget; push (§2.3) is the better relief. `API.md` §2.4 + §6
document this as a client contract.

### 2.5 Webhook/event system → **one sink, one gate** *(enables integrations)*

**Verdict: one seam away.** `BoardHub.publish()` is already a single universal
sink and events are versioned structured JSON, so a Discord/Matrix/Telegram/
webhook subscriber is addable in **one place without touching handlers**. Two
things block it from being safe: emission is inconsistent (`publishLive` vs three
inline `hub.publish()` at `handlePost`, `handleApprove`, `merecatInsertComment`),
and the back-room privacy gate (`page !== ADMIN_CAT`) is re-implemented at ~6
emit sites instead of inside `publish()`.

**Move:** route *every* emit through `publishLive`, and move the `adminsonly`
refusal **into** `publishLive`/`BoardHub.publish` (drop any event whose cat is
`adminsonly`). Then a webhook fan-out is a safe, single-function addition, and
the "a future emit site forgot the guard" leak is closed structurally. This is a
localized refactor genuinely worth cutting.

### 2.6 Media, Search, Permissions, Configuration → **mostly done**

- **Media:** ready. Avatars fully behind `/avatar`; sniffing/dimension/screen
  all server-side. Only obligation: the 400×400/JPEG/≤500 KB re-encode is the
  client's job (documented). Optional later: accept common formats + resize
  server-side.
- **Search:** ready. FTS5 hidden behind an injection-safe, never-500 contract;
  only the `U+0002/U+0003` highlight convention needed documenting (done).
- **Permissions:** ready. Entirely server-side and data-driven; a mobile client
  inherits every check and reads its status from `profile.admin`. Optional:
  normalize auth-before-validate ordering across admin endpoints.
- **Configuration:** lift `ALLOWED_ORIGINS`, `SITE`, and the contact `FROM` into
  `wrangler` vars, and give any staging deploy distinct rate-limit
  `namespace_id`s (fixed ids would share buckets on one account). Keep
  `PAGES`/`BOARD_CATS` in source (low churn). Delete the stale `send_email`
  comment.

---

## 3. Security fixes (shipped)

These surfaced during the audit; all are now fixed in the combined change (see
"Shipped in this pass" above). Kept here as the record of what and why.

1. **merecat chat socket leaks token streams (high).** `ChatRoom#emit`
   broadcasts every `state`/`meta`/`tokens` frame to *all* sockets on the DO, and
   a socket that fails auth is **not closed**. Chat ids are small sequential
   integers and the upgrade needs no key, so anyone can open
   `/api/merecat/live?chat=N`, skip auth, and receive another member's in-flight
   answer (only the `hello` resume frame is auth-gated). **Fix:** close the
   socket on auth failure and restrict `#emit` to sockets whose attachment has
   `auth:true` (or emit per-authed-socket like `#hello` does).
2. **IP bans bypassed on the WS ask (medium).** The DO's `#ask` calls the block
   check with an **empty IP**, so IP bans (and `POST_LIMIT`) apply only at
   `ask-init`; a key on a banned IP can keep asking in an owned thread by
   connecting directly. Only a hash *lock* stops it. **Fix:** capture
   `CF-Connecting-IP` at upgrade, thread it into the DO, gate `#ask` with it.
3. **Back-room existence leak via `/report` (low).** A live back-room comment id
   returns `400` while a nonexistent id returns `404`, so a keyed member can
   probe which ids are live back-room posts. **Fix:** return the same `404 "No
   such post."` for `adminsonly` targets.

A fourth, cosmetic: the WS `Upgrade` header is compared **case-sensitively** as
`websocket`; some native WS stacks send `WebSocket` and get a `404`. Lowercase
the compare.

---

## 4. Suggested sequence

Doc-only and additive first (zero prod risk), the spam wall last (needs live
testing):

1. **Ship `API.md`** (done) — the prerequisite for any second client.
2. **`GET /api/comments/config`** + **`assigned`/`rank` on author rows** —
   additive, cached, ends triplication. *(§2.1)*
3. **Config hygiene** — vars for `ALLOWED_ORIGINS`/`SITE`/`FROM`, staging
   namespace ids, delete stale comment. *(§2.6)*
4. **Event bus centralization** — one sink + one gate; unlocks webhooks. *(§2.5)*
5. **Security fixes** — the three in §3. Small, do them before apps.
6. **Push** — `push_tokens` + fan-out; the biggest native win. *(§2.3)*
7. **Native Turnstile path** — mobile sitekey or device-attest. Land last with
   live testing since it touches the spam wall. *(§2.2)*

Each step is independently shippable and testable through the existing
`webtest/` + headless gates; nothing here requires a big-bang rewrite or leaves
the free tier.
