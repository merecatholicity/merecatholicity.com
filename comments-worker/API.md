# The Mere Catholicity headless API

The dynamic side of the site is a real headless API: two Cloudflare Workers
over D1, R2, Durable Objects, Workers AI, and Vectorize. Every route is
same-origin under `merecatholicity.com` (no CORS on the comments worker). The
web app consumes it through `app/api.js` (reads via the `app/store.js` cache;
writes direct) and `app/live.js` (the two WebSockets), but **nothing in the
worker knows or cares whether the caller is the browser, a mobile app, or
`curl`** — identity is a key in the request body, not a cookie or session.

This file is the **contract**. It is written to be complete enough that an
iOS/Android developer can build a native client from it without reading the
worker source. Keep it current when a route changes. For the architecture and
the decoupling roadmap that this contract enables, see
[`DECOUPLING.md`](../DECOUPLING.md).

- **Two workers.** `comments-worker/` serves everything under
  `/api/comments*` and `/api/merecat*` on `merecatholicity.com` and
  `www.merecatholicity.com`. `contact-worker/` serves the contact form on
  `contact-api.merecatholicity.com` (its own custom domain).
- **Free-tier only.** Every feature stays inside Cloudflare's free plan; the
  design constraints below (one shared read bucket, top-8 retrieval, hibernating
  Durable Objects) exist to honor that.

---

## 0. Read this first if you are writing a native client

The API is already native-friendly in its bones — key-in-body auth, no cookies,
missing `Origin` is allowed — but nine things will bite you if you don't know
them up front. Each is detailed later; this is the checklist.

1. **Turnstile is a hard wall on four writes.** Posting a comment/topic/reply
   (`POST /api/comments`), saving your profile (`POST /api/comments/profile`),
   sending a DM (`POST /api/comments/dm/send`), and uploading an avatar
   (`POST /api/comments/avatar`) all require a Cloudflare Turnstile token, and
   the server rejects any token **not solved on `merecatholicity.com` /
   `www`** (`TURNSTILE_HOSTNAMES`). There is no API-key bypass. A native app
   must mint tokens via an embedded WebView on the production hostname, or the
   owner must register a second (mobile) sitekey and add its hostname. **Reads,
   edits, deletes, reports, watches, DMs read/block/delete, notifications, and
   every merecat endpoint carry no Turnstile.** See §3.4.
2. **Send no `Origin` header, or send exactly the site origin.** Every POST is
   origin-checked: a *present* `Origin` that isn't `https://merecatholicity.com`
   or `https://www.merecatholicity.com` is `403 Bad origin.`; an *absent* Origin
   passes. Native HTTP clients simply omit it. WebView-wrapped apps whose
   origin is `capacitor://`/`null`/a custom scheme will be rejected — they need
   allowlisting. See §2.3.
3. **Never send a `website` field.** It is a honeypot on `POST /api/comments`
   (and on the contact form). A non-empty `website` returns a *fake success*
   `{ok:true, status:'live'}` **with no `comment` object** — your post is
   silently discarded and a naive renderer that reads `d.comment` will crash.
4. **Budget your reads.** All read endpoints share **one** per-IP bucket:
   `READ_LIMIT` = 15 requests / 60 s / IP. A badge poller + a thread view + a
   chat-resume poll on one CGNAT'd IP will 429 each other. You must implement a
   read-budget governor (§2.4). 429s currently come back as HTTP 429 *and* a
   prose error; key on the **status code**, not the wording.
5. **You must reimplement the render + naming stack.** Bodies are stored as raw
   markdown-ish text; the server never renders. The pseudonym generator,
   markdown grammar, emoji whitelist, scripture autolinker, faith labels, and
   rank ladder all live only in the web client. §6 is the catalog of what to
   replicate and where a small server change would remove the need.
6. **The merecat chat is a WebSocket state machine, not an HTTP stream.** Ask
   flow is `POST /api/merecat/ask-init` → adopt the returned `chatId` → open
   `GET /api/merecat/live?chat=<id>` → send `{t:'auth',key}` → send
   `{t:'ask',...}`. The old `POST /api/merecat/ask` **is deleted (404).** §5.
7. **Deep-linking a comment: send `find` XOR `p`, never both.** On
   `GET /api/comments/board/topic`, `find=<commentId>` is honored *only when no
   `p` is present*; defaulting `p=1` silently disables the jump. §4.1.
8. **Two soft-success traps.** `POST /api/comments/backup` answers `200
   {ok:true, backup:{error:...}}` when R2 is unbound; several endpoints return
   `{ok:true}` idempotently whether or not anything happened (`/report`,
   `/approve`, `/admin` revoke, `/board/reads`). Do not treat `ok:true` as "the
   action changed state." §3.5.
9. **Avatars are your job to prepare.** The server accepts **only** a baseline
   JPEG that is **exactly 400×400** and **≤500 KB** (dimensions parsed from the
   JPEG itself, not trusted). PNG/WebP/HEIC are refused whatever the
   `Content-Type` claims. You resize + re-encode client-side. §3.3.

The merecat chat socket was **hardened** (unauthenticated sockets no longer
receive another member's answer tokens; the WS ask re-checks IP bans; the
`Upgrade` header is matched case-insensitively) — see §5.4 for the current
contract.

---

## 1. Base, transport, versioning

| | |
|---|---|
| **Base (comments/merecat)** | `https://merecatholicity.com` (and `www.`) |
| **Base (contact)** | `https://contact-api.merecatholicity.com` |
| **Content type** | `application/json` in and out, except: avatar upload is `multipart/form-data`; avatar GET returns raw image bytes; `/feed` returns RSS XML; contact form takes form-encoded; WebSocket frames are JSON text. |
| **CORS** | None on the comments worker (same-origin by design; a foreign *web* origin can never read it, a native client never needs it). The contact worker echoes CORS for the two site origins. |
| **Auth** | A client-generated random key string in the request body field `key` (or the WS `auth` frame). No cookies, no headers, no sessions, no expiry. §2.2. |
| **Versioning** | There is **no explicit API version** today. WebSocket board frames carry `v:1`; chat frames do not. `merecat` ask frames carry `rv` (retrieval build number, currently `15`). Treat the absence of a version header as a gap — pin your client to this document's date and watch `CLAUDE.md` for changes. Recommended fix in `DECOUPLING.md`. |

---

## 2. Conventions

### 2.1 Response envelope

Every JSON response is `{ok:true, …}` or `{ok:false, error:"<human
sentence>"}`. Exceptions: `/feed` (RSS body, plain-text errors), `GET /avatar`
(raw bytes, plain-text errors), and the WebSocket upgrade endpoints (plain-text
HTTP errors, then framed JSON).

- Unknown route → `404 {ok:false, error:"Not found."}`
- Any uncaught server error → `500 {ok:false, error:"Server hiccup. Please try
  again shortly."}`
- Trailing slashes are stripped before routing (`/api/comments///` == `/api/comments`).

### 2.2 Identity

The client invents a random secret string (`key`); the server stores and
compares **only** `sha256hex(key)` (lowercase hex SHA-256 of the UTF-8 bytes).
Possession of the string *is* the account — there is no registration step. The
hash is a member's public id, used to address them (DMs, mentions, profiles,
admin actions). The key travels in **every** authenticated call; the hash
authenticates nothing on its own.

- **Generate:** 32 random bytes → base64url (`+`→`-`, `/`→`_`, strip `=`), ~43
  chars. (Web client: `crypto.getRandomValues` + `btoa`.)
- **Transport of the key:** JSON body field `key` on keyed POSTs; multipart
  field `key` on avatar upload; WS frame `{"t":"auth","key":"…"}` on the chat
  socket. Never in a URL.
- **Derive the hash yourself** to render your own name/controls, but the server
  re-derives it from `key` on every call.
- **Auth tiers:** *public* (no key) · *keyed* (any key) · *admin* (the key's
  hash is a row in the `admins` D1 table). Admin refusals are a uniform `403
  {ok:false, error:"No."}`.
- **Blocked identities:** a locked/IP-banned/legacy-banned identity gets `403
  {ok:false, blocked:"locked"|"ipban"|"banned", error:"Interaction is not
  available."}` on gated calls. The web client treats any `{blocked}` response
  as a forced logout (clears the key, redirects to `terms.html`). Your client
  should do the same. Note: this gate is applied to **writes and the two unread
  polls**, not to every keyed read — see §2.6.

### 2.3 Origin

`originOk`: a POST (and either WebSocket upgrade) with a *present* `Origin`
header not in `{https://merecatholicity.com, https://www.merecatholicity.com}`
→ `403 {ok:false, error:"Bad origin."}`. A *missing* `Origin` is allowed
(native clients: omit it). GETs are not origin-checked. This is the CSRF wall
for browsers; it does not authenticate a native client (which the `key`
already does).

### 2.4 Rate limits

Three per-IP sliding windows (`CF-Connecting-IP`), all Cloudflare rate-limit
bindings (`simple`, only 10 s/60 s windows are supported):

| Bucket | Limit | Covers |
|---|---|---|
| `POST_LIMIT` | **5 / 60 s** | Member writes: post, edit, delete, DM send, report, watch mutations, profile save, avatar upload, avatar delete, merecat ask-init, merecat forward/delete, board read/read-all, deleteuser. |
| `READ_LIMIT` | **15 / 60 s** | **One shared bucket** across *all* reads (public GETs and keyed POST-reads) **and most admin actions** (`meta`, `audit`, `trust`, `moderate`, `move`, `board/admin`, `profile/admin`, `profile/clear`, `lock`, `ipban(s)`, `rdns`, `approve`, `pending`, `report/dismiss`, `admins`, `admin`, `backup`, `chat/save`). |
| `CONNECT_LIMIT` | **10 / 60 s** | WebSocket upgrades only (`/api/comments/live`, `/api/merecat/live`). Own bucket so a reconnect storm can't starve reads. |
| `SEND_LIMIT` (contact worker) | **3 / 60 s** | The contact form. |

429 bodies are `{ok:false, error:"Too many …"}` (wording varies per endpoint);
`/feed` and the WS upgrades return plain text. **A native client with any
background polling MUST implement a read-budget governor** — the web client's
is `readMark`/`readPace`/`readEase` in `comments.js` (§6, "read-budget
coordinator"): stamp every polled read into a rolling 60 s ledger, stretch the
next poll to ≥12 s when within 2 of the ceiling, and open an 8 s ease window
whenever any response looks throttled. Without this, a badge poll + a thread
open will 429 the user's own taps — especially behind CGNAT where many users
share one v4.

Some admin **mutations** ride `READ_LIMIT` rather than `POST_LIMIT` (see the
table). An admin dashboard therefore shares one 15/60 s bucket across its list
reads and its moderation actions.

**Application quotas** (separate from rate limits, stored in the merecat DB):
per-member **10 questions/day** (only when `user_cap_on`), global **150/day**,
reset at **00:00 UTC**. Admins bypass both but are still tallied.

### 2.5 Caching & freshness

Public GET reads carry `Cache-Control: public, max-age=300`, dropping to
`max-age=60` when the request carries `?fresh=1`. Keyed/admin POST reads carry
no cache header. `/feed` is `max-age=1800`. `GET /avatar` is `max-age=86400`
on a hit, `300` on a miss. **Back-room refusals are served *with* the normal
cache header** so they are byte- and cache-identical to genuine 404/400s (a
prober can't distinguish a hidden category from a nonexistent one).

Freshness idiom: after a write, a client should bypass its own cache for its
own reads for ~90 s (the web client stamps `mc-posted-at` and sends
`cache:'no-store'`; keyed users also append `fresh=1` to select the 60 s
server profile). `fresh=1` is **not** authentication — it only selects the
shorter cache TTL.

### 2.6 Pagination, caps, timestamps

- **Page size is 20** almost everywhere (`topics`, `replies`, `search`,
  `author posts`, `notifications`, `dm/threads`, `dm/thread`). Exceptions:
  `admin/threads` per=30; page comments are un-paginated with a hard `LIMIT
  500`; `/feed` is `LIMIT 50`; merecat `/chat` returns up to `LIMIT 400`
  messages; `/chats` up to 50; audit is `300+300+200`.
- `p` clamps to `[1, 1000]` (`min(1000, max(1, floor(Number(p)||1)))`). List
  responses carry `{items|topics|comments|threads|messages, total, page, per}`.
- **Text caps** (all: CRLF→LF, trimmed, and `CONTROL_RE` `[ --]`
  refused — tab and newline allowed): body 4000, title 120 (min 3), nick 40,
  bio 500, signature 200, report reason 200. These control-char bars are what
  make the search-highlight sentinels (`U+0002`/`U+0003`) collision-free.
- **All timestamps are unix seconds** (integers). Only `/feed` (RFC-1123) and
  the client render anything human. Compute local time yourself.

### 2.7 Full error catalog

Statuses used: `200` (success, incl. soft/idempotent), `400` (bad
request/validation), `403` (bad origin · Turnstile fail · `{blocked}` · admin
`"No."` · locked topic · back-room refusal), `404` (not found · hidden
resource), `413` (avatar too large), `429` (rate limit), `500` (server), `503`
(binding unavailable). Non-JSON error surfaces: `/feed` and `GET /avatar`
(plain text), WS upgrades (plain text + close codes).

---

## 3. Comments & board

### 3.1 Reads (public, cacheable, `READ_LIMIT`)

| Route | Query | Returns |
|---|---|---|
| `GET /api/comments` | `page` (required, one of the 7 whitelisted paths — §7); `fresh` | `{ok, anon, comments:[…]}` — a page's `live` comments, `ORDER BY id LIMIT 500` (no pagination). |
| `GET /api/comments/board` | `fresh` | `{ok, cats:{<catKey>:{topics, posts, last, latest:{topic_id,id,title,author_hash,nick,created_at}}}}`. **Categories with zero live posts are absent.** Back room excluded. |
| `GET /api/comments/board/cat` | `cat` (required key), `p`, `q` (title filter), `fresh` | `{ok, topics:[…], total, page, per:20}`. `ORDER BY sticky DESC, last DESC`. |
| `GET /api/comments/board/topic` | `id` (required), `p`, `find` (comment id — **only when no `p`**), `fresh` | `{ok, anon, cat, topic:{…}, replies:[…], total, page, per:20}`. Replies `ORDER BY id ASC`. |
| `GET /api/comments/board/author` | `hash` (required 64-hex), `p`, `fresh` | `{ok, items:[{comment_id,topic_id,title,cat,created_at,snippet}], total, page, per:20}` — a member's live forum posts, newest first. |
| `GET /api/comments/search` | `q`, `cat`, `author` (64-hex), `sort` (`new`\|else bm25), `p`, `fresh` | `{ok, items:[{comment_id,topic_id,title,author_hash,nick,cat,created_at,snip}], total, page, per:20, q}`. **Never 500s** — an empty/unusable query or any SQL error returns the empty envelope. |
| `GET /api/comments/profile` | `hash` (required), `fresh` | `{ok, profile:{hash,nick,bio,signature,avatar,faith,posts,assigned,admin}}`. `assigned` is the **server-computed pseudonym**; `admin` is public. |
| `GET /api/comments/dm/directory` | `fresh` | `{ok, users:[{hash, joined, nick}]}` — up to 2000, newest first. Bot and any `merecat…` nick excluded. All fuzzy matching is client-side. |
| `GET /api/comments/feed` | `topic` \| `cat` \| `page` (precedence in that order) | RSS 2.0 XML. Renders `displayName` server-side. |
| `GET /api/comments/config` | — | `{ok, apiVersion, media:{enabled, kinds:{dm,wall,board}, max_bytes:{image,video,audio}, audio_max_seconds, autocompress, sections:{dm,wall,board}}, cats:[{key,label,blurb,order,link?}], faiths:[{code,label,order}], ranks:[{min,label}], pages:[…], bot_hash, bible:[{slug,spellings}], emoji:{custom,named,data_url}}` — the shared constants a native client would otherwise triplicate. `media.sections.<ctx>` is the per-SECTION policy (2026-08-02): `{kinds, voice, max_bytes:{image,video,audio}, audio_max_seconds}` plus `scan` on `wall`/`board` only — `dm` carries **no** `scan` field because DM media is E2E ciphertext and structurally unscannable; the absence is the statement. The flat legacy fields beside `sections` are kept for older clients. Gate client-side from the served policy, never a literal (everything is admin-tunable). Cacheable. |
| `GET /api/comments/avatar` | `hash` (required), `v` (cache-buster) | Raw JPEG bytes, `max-age=86400`, `nosniff`, `CSP default-src 'none'`. **No rate limit.** |

**Row shapes.** A comment/reply row is `{id, author_hash, nick, assigned,
signature, avatar, faith, body, created_at, edited_at, posts, rank}`. A topic
head adds `title, locked, sticky`. A category topic row is `{id, title,
author_hash, nick, assigned, created_at, locked, sticky, replies, last,
last_id}`. **`assigned` is the server-resolved pseudonym** — present on every
author-bearing row now (comments, topic, replies, board latest-poster, search
items, DM `other`/threads as `assigned`, notifications as `actor_assigned`,
`/dm/directory` users), so you no longer need to derive it from the hash. `nick`
is still `null` when unset (show `nick || assigned`). `rank` is the scriptorium
label and rides wherever `posts` does (comments, topic view, `/profile`); the
raw `posts` count is still there. `faith` is a raw code
(`nicene`/`indo-european`/`seeker`) — resolve its label from `/config`.

**Search highlight.** `snip` wraps matched terms in `U+0002…U+0003`. Split on
those control bytes into highlight spans; never display them raw, and never
`innerHTML`.

### 3.2 Writes (keyed)

**`POST /api/comments`** — the single write pipeline. `POST_LIMIT`, **Turnstile
required**, `blockedReason`-gated, origin-gated.

Target is exactly one of three shapes:
- reply: `{topic:<int>}` — topic must be a live, unlocked root; a locked topic
  → `403 "This topic is locked."`
- new topic: `{cat:<key>, title:<string>}` — title trimmed, 3–120 chars.
- page comment: `{page:<whitelisted path>}`.

Common fields: `body` (required unless a valid `media_key` rides along, ≤4000),
`token` (Turnstile, required), `key`, and optional `media_key` (a board
attachment from `POST /board/media` — **board topics and replies only**: an
article page refuses it, the back room refuses it outright, and the claim
re-checks the board kinds mask + per-kind cap, so an upload smuggled through
another context still fails here), `faith` (fill-only into your profile),
`mentions` (array of 64-hex hashes, ≤10 — see the honor-system note in §6),
`tz` (IANA-ish string, display-only), `ipv4`/`ipv6` (client-fetched
opposite-family address for ban coverage, §6), and **never** `website`
(honeypot, §0.3).

Returns `200 {ok:true, status:"live"|"pending", comment:{id,title,author_hash,
nick,signature,avatar,faith,body,created_at,media_key}}`. `status` is `pending` when the
AI screen (or the ≥3-links rule, or `MODERATION_MODE=hold-all`, or an AI
error) holds it — a `pending` post is invisible to others until an admin
approves it. There is **no `held` status for comments**; `pending` *is* held.
Side effects on a live board post: topic stats refresh, author auto-watch,
mention + reply notifications, `@merecat` auto-reply if the unquoted body
contains `@merecat`, dual-stack IP capture, and a **live broadcast** to the
board WebSocket (§5.1).

**Media uploads** (`POST /api/comments/wall/media` and `POST
/api/comments/board/media`) — `multipart/form-data` with `key` + `file`.
`POST_LIMIT`, gated, **no Turnstile** (the linking post is the Turnstile gate),
and the identity must be ESTABLISHED (a saved profile, a comment, or a wall
post — i.e. has passed Turnstile at least once; a fresh key gets `403
"Attachments unlock after your first post or profile save."`). The two routes enforce their own SECTION's
policy (2026-08-02): kinds mask (`media_kinds_wall` vs `media_kinds_board`),
per-section per-kind byte caps (from `/config` `media.sections.*`), each
section's own storage budget (live per-`ctx` SUM; 90% of
`media_cap_wall_bytes`/`media_cap_board_bytes` → `507`), and each section's AI
image screen toggle (`media_scan_wall`/`media_scan_board`, on by default —
flagged images get `422`; fail-open when the model itself errs). Images are
magic-byte-sniffed (jpeg/png/webp only); video/audio validate against the exact
whitelist (video: mp4/quicktime/webm; audio: mpeg/mp3/mp4/x-m4a/aac/webm/ogg/wav
— Domain.Media is the source). Returns `{ok,
media_key:"wall/<i|v|a>/<64hex>", size, kind}`; the key is UNLINKED until a
post claims it (unlinked orphans sweep after ~15 minutes; the claiming post
re-stamps the row's accounting section, so budgets and purges always follow
where the media actually lives). Serve with
`GET /api/comments/wall/media?key=…` — keyless, public, cacheable a day,
`nosniff` + deny-all CSP + CORP; a key linked into the back room answers the
byte-identical 404 a missing object gets.

**1v1 voice calls (2026-08-03).** Media is peer-to-peer DTLS-SRTP (genuinely
E2E — the operator relays only setup metadata; a TURN relay carries opaque
ciphertext). Setup rides two keyed POSTs, **no Turnstile** (ring-spam is fenced
by keyedGated + POST_LIMIT + the ESTABLISHED-identity gate + block-with-fake-
success; the remedy is block, the Signal semantic):
`POST /call/offer {key, to, call, sdp}` (`to` 64-hex, `call` 16–64 hex minted
by the caller, sdp `v=`-prefixed ≤32 KB; refuses self/bot; **a dm_blocks row
answers a fake `{ok:true}`** — the caller rings out to silence,
indistinguishable; else fans `{t:'call-offer', from, call, sdp}` to
`user:<to>` and fires the coalesced `'call'` notification + a Web-Push nudge
when the callee has no live socket). `POST /call/answer {key, to, call, sdp}`
(symmetric; also read-marks the caller's missed-call row, targeted).
`POST /call/turn {key}` (READ_LIMIT + established) → `{ok, iceServers, relay}`
— short-TTL Cloudflare TURN credentials when the TURN key pair AND the
`calls_turn` admin toggle stand, else the free STUN-only fallback
(`relay:false`). Transient signaling (ICE batches + end/decline/busy/taken)
rides the live socket's `t:'call-sig'` frame `{to, call, kind, payload}` —
relayed to `user:<to>` tagged with the authenticated sender, ≤4 KB, no
storage. `GET /config` serves `calls:{enabled}`; app_settings `calls_enabled`
(global kill switch, server-enforced) and `calls_turn` are admin-set in
`/admin/settings`. Notification kind `'call'` (migration 0009).

**`POST /api/comments/edit`** — `{id, key, body}`. `POST_LIMIT`, gated, **no
Turnstile** (despite older docs; the web SDK sends a `token` the server
ignores). An attachment survives a body edit untouched; a media-only post
(empty body) cannot be edited at all. Author-only, even for admins. Re-screens; a flagged edit drops the
post to `pending`. Returns `{ok, status, edited_at}`. `403 "Not yours, or
already gone."` otherwise.

**`POST /api/comments/delete`** — `{id, key}`. `POST_LIMIT`, gated, no
Turnstile. Soft delete (`status='deleted'`). **Doubles as the admin delete**:
if the caller is an admin the author check is dropped, so an admin deletes any
comment through this route. `403 "Not yours, or already gone."` otherwise.

**`POST /api/comments/report`** — `{key, id, reason?}` (reason ≤200). Keyed,
`POST_LIMIT`, gated. Flags a live post for moderators; **never changes its
status** (anti-brigade). Idempotent `{ok:true}` for a fresh or duplicate
report. `404 "No such post."` for a missing live comment; `400` for a
back-room target (this leaks back-room existence — see `DECOUPLING.md`).

**`POST /api/comments/watch`** — `{key, topic, act:"status"|"watch"|"unwatch"}`.
`status` rides `READ_LIMIT`, mutations `POST_LIMIT`, gated. Returns `{ok,
watching:0|1}`. No existence check on the topic id.

**Read-state** (all keyed, gated):
- `POST /api/comments/board/unread` `{key}` → `{ok, total, byCat:{<cat>:n}}`.
  First-ever call sets a per-user "read-all floor" (a newcomer starts all-read)
  and registers the profile row. `READ_LIMIT`.
- `POST /api/comments/board/reads` `{key, cat}` → `{ok, unread:[topicIds]}`.
  `READ_LIMIT`. Soft-fails to `{ok:true, unread:[]}` on a missing key or
  unknown cat.
- `POST /api/comments/board/read` `{key, topic}` → `{ok, notif_unread}`.
  `POST_LIMIT`. Marks the thread read and its notifications read; returns the
  remaining unread-notification count so a badge updates on the same call.
- `POST /api/comments/board/read-all` `{key}` → `{ok, notif_unread:0}`.
  `POST_LIMIT`. Raises the floor and clears per-thread rows + all notifications.

### 3.3 Profiles & avatars (keyed; AI-screened)

**`POST /api/comments/profile`** — `{key, token, nick?, bio?, signature?,
faith?}`. `POST_LIMIT`, **Turnstile required**, gated. **Whole-record
replace**: an omitted or empty text field **clears** that column (a native
client must always resend all three text fields; `faith` and `avatar` are the
only keep-if-absent fields). Nick matching `/merecat/i` → `400`. The three text
fields are screened as one blob; flagged → `400 "That text was flagged…"` (a
profile has no pending state). Returns `{ok, profile:{…, assigned, admin}}`
(no `posts` key on the save response).

**`POST /api/comments/avatar`** — `multipart/form-data` with fields `key`,
`token`, `avatar` (file). `POST_LIMIT`, **Turnstile required**, gated. Accepts
**only** `image/jpeg`, **exactly 400×400**, **≤500 KB** — dimensions are parsed
from the JPEG's SOF marker, never trusted from the client; PNG/WebP are
recognized by the sniffer but **refused**. LLaVA screens the image (fails
open). Stored at a fixed R2 key per identity (upload = overwrite). Returns
`{ok, avatar:"<unix-seconds string>"}`; use that value as the `&v=` cache
buster on `GET /avatar`. Resize + re-encode is **your** job.

**`POST /api/comments/avatar/delete`** — `{key}`. `POST_LIMIT`, no gate, no
Turnstile (a key holder may always remove their own avatar, even if locked).

### 3.4 Turnstile (the four gated writes)

`verifyTurnstile` POSTs `secret`/`response`/`remoteip` to Cloudflare
`siteverify`, **fails closed** on any network error, and additionally rejects a
token whose `hostname` is not in `TURNSTILE_HOSTNAMES`
(`merecatholicity.com,www.merecatholicity.com`). The sitekey is
`0x4AAAAAAD8IYH9_xQ0HE0yB`, domain-locked to the site. Consequence for native:
you cannot mint an acceptable token without an embedded WebView on the site's
hostname, or a second mobile sitekey the owner adds to the allowlist. Failure
→ `403 "Verification failed. Reload the page and try again."`

### 3.5 Idempotent / soft-success shapes (don't read `ok:true` as "changed")

- `/report`: identical `{ok:true}` for a new or duplicate report.
- `/approve`: `{ok:true, approved:false}` when the id wasn't pending.
- `/admin` (revoke): `{ok:true, admin:false}` even for a never-admin hash.
- `/board/reads`: `{ok:true, unread:[]}` for a missing key / unknown cat.
- `/backup`: `{ok:true, backup:{error:"…"}}` when R2 is unbound — check
  `backup.error`.
- `POST /api/comments` honeypot: `{ok:true, status:"live"}` **with no
  `comment`** — §0.3.

---

## 4. Direct messages & notifications (keyed)

### 4.1 Direct messages

Strictly 1-v-1 threads, canonical-pair keyed. Private by design (no admin read
path). Shadow-block: a blocked sender's messages read as delivered to *them*
but are stored `held` and invisible to the recipient; unblock releases them at
their original timestamps.

| Route | Body | Returns | Gate |
|---|---|---|---|
| `POST /api/comments/dm/send` | `{key, to:<64-hex>, body:<≤4000>, token}` | `{ok, id, thread_id, created_at}` — **same shape even when shadow-held** (undetectable to the sender). | `POST_LIMIT` · **Turnstile** · gated. Refuses self (`"That would be a soliloquy."`) and the bot. |
| `POST /api/comments/dm/threads` | `{key, p?}` | `{ok, threads:[{id,other_hash,nick,avatar,msgs,last_at,unread}], total, unread_total, page, per:20}`. Threads with 0 visible messages are absent. | `READ_LIMIT`, **not** gated. |
| `POST /api/comments/dm/thread` | `{key, with:<64-hex>, p?}` | `{ok, thread_id, other:{hash,nick,avatar}, messages:[{id,sender_hash,body,created_at}], total, page, per:20, blocked}`. **`p` absent → the LAST page.** Opening marks the thread read. | `READ_LIMIT`, not gated. |
| `POST /api/comments/dm/unread` | `{key}` | `{ok, unread}` — unread **thread** count. | `READ_LIMIT`, **gated** (this poll is the reliable logout trip). |
| `POST /api/comments/dm/block` | `{key, hash, blocked:<bool>}` | `{ok, blocked}` | `POST_LIMIT`, not gated. Unblock releases held messages and rings the badge. |
| `POST /api/comments/dm/delete` | `{key, with}` | `{ok, purged}` — per-side "fresh start"; both sides cleared with nothing newer → the thread is hard-deleted. | `POST_LIMIT`, gated. |

### 4.2 Notifications

`reply` and `mention` events (the codes are a server `CHECK` + a client-only
label map). Jump target: `community.html?topic=<topic_id>#comment-<comment_id>`.

| Route | Body | Returns | Gate |
|---|---|---|---|
| `POST /api/comments/notifications` | `{key, p?}` | `{ok, items:[{id,kind,topic_id,comment_id,actor_hash,created_at,read_at,topic_title,actor_nick,snippet}], total, unread_total, page, per:20}`. Listing does **not** mark read. | `READ_LIMIT`, not gated. |
| `POST /api/comments/notifications/unread` | `{key}` | `{ok, unread}` | `READ_LIMIT`, **gated**. |
| `POST /api/comments/notifications/read` | `{key}` | `{ok}` — stamps all unread read (all-or-nothing). | `POST_LIMIT`, gated. |

### 4.3 Push registration (scaffold)

The mobile-notification landing pad. Endpoints work today; **delivery is dark**
until the owner sets a provider and `PUSH_ENABLED=true` (there is no app yet). A
registered device is nudged from the same server path that writes in-app
notifications and DMs.

| Route | Body | Returns | Gate |
|---|---|---|---|
| `POST /api/comments/push/register` | `{key, platform, token}` (`platform` `[a-z0-9_-]{1,20}`, `token` ≤4096) | `{ok}` — upsert on `(hash, token)`. | `POST_LIMIT`, `blockedReason`-gated. |
| `POST /api/comments/push/unregister` | `{key, token}` | `{ok}` — drop that token. | `POST_LIMIT`. |

---

## 5. merecat, the librarian (RAG chat, `/api/merecat/*`)

merecat is a members-only Catholic-library RAG assistant. Generation runs in a
**per-conversation Durable Object** (`ChatRoom`) over a WebSocket; the DO owns
generation and is the sole writer of the `chats`/`chat_msgs` tables, so a
dropped socket never stops an answer and a reconnect replays it. The old HTTP
stream (`POST /api/merecat/ask`) is **deleted (404)**; `POST /api/merecat/store`
is a **retired no-op** kept for one deploy (returns `{ok:true}`, writes
nothing — do not build against it).

### 5.1 The board WebSocket (`GET /api/comments/live`)

Read-only fan-out of public board changes; **no auth, anonymous, public data
only**. Origin-checked (absent Origin OK), `CONNECT_LIMIT`. Upgrade with
`Upgrade: websocket` (compared case-sensitively as the lowercase string
`websocket` — send it lowercase).

- **Subscribe** (client→server): `{"t":"sub","scope":[…]}` — the key is
  **`scope`** (singular), an **array**, ≤4 entries, each `board:index` |
  `cat:<key>` (not `adminsonly`) | `topic:<positive int>`. Each `sub`
  **replaces** the whole subscription set. No ack is sent. After a page fetch,
  subscribe **then refetch** to close the gap (there is no snapshot/replay).
- **Keepalive:** send the literal 13-byte string `{"t":"ping"}`; the runtime
  auto-responds `{"t":"pong"}` without waking the DO. The match is
  **byte-exact** — different key order/spacing gets no pong.
- **Event frames** (server→client) all carry `v:1`, a `t`, and `scopes` (you
  receive an event iff one of your subscribed scopes is in `event.scopes`):

| `t` | Payload |
|---|---|
| `new-topic` | `{v:1,t,scopes,cat, topic:{id,title,author_hash,nick,created_at,locked,sticky,replies,last,last_id}}` |
| `new-reply` | `{v:1,t,scopes:['topic:<id>'],topic_id, comment:{id,author_hash,nick,signature,avatar,faith,body,created_at}}` |
| `topic-stats` | `{v:1,t,scopes,cat,topic_id,title,replies,last,last_id,author_hash,nick}` (always paired after `new-reply`) |
| `moderation` | `{v:1,t,act:'delete'|'lock'|'unlock'|'sticky'|'unsticky',id,topic_id,cat[,locked|sticky],scopes}` |
| `edited` | `{v:1,t,topic_id,id,body,edited_at,scopes:['topic:<id>']}` |
| `moved` | `{v:1,t,id,from,scopes}` (followed by a `new-topic` into the destination cat, for public destinations) |

Only `status='live'` posts on public (`board:*`, not `adminsonly`) pages ever
broadcast. Sockets **hibernate** when idle; there is no server heartbeat.

### 5.2 The ask flow (`POST /api/merecat/ask-init` → chat WebSocket)

**Step 1 — mint/verify the thread.** `POST /api/merecat/ask-init` `{key,
chat?, q}`. `POST_LIMIT`, `blockedReason`-gated. `chat` absent/0 mints a new
thread titled from `q` (≤90 chars); `chat` set verifies ownership (else `404
"No such conversation."`). Returns `{ok, chatId, backend:"cloudflare"|"local",
used:{you,cap,cap_on,today,gcap,admin}}` (pre-ask counts). **Adopt `chatId`
into your state before connecting.**

**Step 2 — open the socket.** `GET /api/merecat/live?chat=<id>` with `Upgrade:
websocket`. Origin-checked, `CONNECT_LIMIT`; `400` without a chat id. The DO
accepts immediately.

**Step 3 — authenticate.** Send `{"t":"auth","key":"<member key>"}` (the key
rides the frame, never the URL). On success the server replies `hello`; on
failure it sends a `state`/`error` frame **but leaves the socket open**.

**Step 4 — ask.** Send `{"t":"ask","q":"<question>","effort":"off"|"low"|
"medium"|"high"|"xhigh"|"max"}` **or** `{"t":"ask","q":"…","instant":true}`
(never both; `effort` defaults to `high`; `instant` forces the cloud backend).
`q` is silently truncated to 2000 chars; an empty `q` gets **no frame at all**
(so you need your own give-up timer — the web client uses 12 s). Single-flight:
asking while one is in flight → `{t:'state',phase:'busy'}`.

### 5.3 Chat frames (server→client)

| `t` | Shape / meaning |
|---|---|
| `hello` | `{t,chatId,phase:'idle'|'queued'|'thinking'|'streaming'|'done'|'error',answer:"<so-far>",sources:[…],used:{…}|null,startedAtMs,backend}`. **This is the entire resume protocol** — on reconnect, `hello` replays phase + answer-so-far + sources. `phase:'idle'` with empty `answer` means no in-flight generation: render the finished thread from `POST /api/merecat/chat` instead. |
| `state` | `{t,phase}` transitions: `busy` · `thinking`(+chatId,used) · `queued`(+place,backend:'local') · `streaming` · `done`(+chatId) · `error`(+error, optional `resting:true`/`capped:true`). |
| `meta` | `{t,sources:[{n,title,heading,url}],used:{…},rv:15,backend,chatId}` — emitted when retrieval lands, before tokens. |
| `tokens` | `{t,d:"<text delta>"}` — batched ~60 ms. May contain `U+0002` (strip) and `U+0003` (= clean end; truncate there). The DO already strips both, but strip defensively. |

The `used` object is `{you,cap,cap_on,today,gcap,admin,backend}`. Quota is
meaningful **only** when `backend==='cloudflare'` (local mode meters nothing —
hide the quota line then). Reset time is **not served**: compute next 00:00 UTC
in the user's local clock.

**Answer text format.** Bot answers (and forwarded ones) are markdown with
`[n]` citation markers renumbered to `1..k` by first appearance, followed by
`\n\nSources:\n` and one line per cited source: `[k] [label](url)` when `url`
is non-empty, or `[k] label` bare when `url==''` (the private shelves). You
render this exactly as the forum renders any post (§6). `chat_msgs.sources` is
a **JSON string** you must `JSON.parse` (fallback `[]`).

### 5.4 Chat socket privacy contract (hardened)

These were defects, now fixed — documented so a client author knows the
guarantees to rely on:

- **Frames reach the owner only.** Every `state`/`meta`/`tokens` frame is sent
  only to **authenticated** sockets, and a socket that fails auth is **closed**
  (`1008`). Only the thread's owner can authenticate (`chats WHERE id=? AND
  hash=me`), so opening `?chat=N` for someone else's conversation and skipping
  auth yields nothing and the socket closes. `hello` was already owner-gated.
- **IP bans apply on the WS ask.** The connecting IP is captured at upgrade and
  threaded into the DO, so a banned IP is refused (`{phase:'error',
  error:'blocked'}`) on the socket ask, not just at `ask-init`.
- **`Upgrade` is matched case-insensitively** (`Upgrade: WebSocket` upgrades),
  at both WS routes and both DOs.

### 5.5 Thread management (keyed, owner-only)

| Route | Body | Returns |
|---|---|---|
| `POST /api/merecat/chats` | `{key}` | `{ok, chats:[{id,title,msgs,last_at,saved}]}` (≤50, newest first). **Opportunistically prunes** your expired unsaved threads. |
| `POST /api/merecat/chat` | `{key, id}` | `{ok, chat:{id,title,msgs,created_at,last_at}, msgs:[{id,role,body,sources,created_at,done}]}` (≤400). `done` via `COALESCE(done,1)`: `1`=finished, `0`=a growing partial (the resume poll re-paints it). `404 "No such conversation."` (the **only** refusal to treat as thread-gone). |
| `POST /api/merecat/chat/save` | `{key, id, save}` | `{ok, id, saved:0|1}`. `saved=1` exempts from the 30-day expiry (until unsaved/deleted). `READ_LIMIT`. |
| `POST /api/merecat/chat/delete` | `{key, id}` | `{ok, deleted:<id>}`. Hard delete. `POST_LIMIT`. |
| `POST /api/merecat/forward` | `{key, chat, msg:<id|'last'>, topic}` | `{ok, id, topic}`. Posts one private answer into a live unlocked topic under the **bot's** name; back-room target needs admin. `POST_LIMIT`. |
| `POST /api/merecat/usage` | `{key}` | `{ok, you, cap, cap_on, today, gcap, admin, backend}`. `READ_LIMIT`. **Not** blocked-gated (a locked identity still reads usage). |

Retention: 30 days from last message (`MERECAT_CHAT_DAYS`) unless `saved`. The
`chats`/`chat_msgs` tables are the one non-derived part of the merecat DB and
are **deliberately not backed up** — ephemeral by contract.

---

## 6. Client logic you must replicate

Bodies are stored raw; the server never renders. This is the list of
browser-only logic a native client must carry. **Two things now reduce it:**
`GET /api/comments/config` serves the constant tables (cats, faiths, ranks,
pages, bot hash, bible, emoji) as data, and every author row now carries
`assigned` (the resolved pseudonym) and, where a count is known, `rank` — so you
no longer derive names or ranks. The remaining must-replicate item is the
**body renderer** (markdown/emoji/scripture), which is inherently client-side.

| Thing | What it is | Server alternative today |
|---|---|---|
| **Pseudonym** | `displayName(hash)` over two 40-word lists. | **Served now.** Every author row carries `assigned`; the wordlists are also in `/config` for offline use. |
| **Faith labels** | Codes `nicene`/`indo-european`/`seeker` → display words + signup order. | **Served now** in `/config` (`faiths`). Rows still carry the raw code. |
| **Rank ladder** | 9 thresholds (Novice 0 … Treasury of Wisdom 5000). | **Served now.** Rows carry `rank`; thresholds are in `/config` (`ranks`). |
| **Markdown grammar** | Block: `>` quote runs, `-`/`*` lists, `#`×1–5 styled pseudo-headings, else paragraphs. Inline: `**bold**`, `*italic*`, `[text](http/s url)`, bare URLs, `:emoji:`, scripture refs. **No HTML, ever** (build with createElement/textContent). Non-site links are rewritten to `away.html?url=…` with `rel="nofollow ugc noopener"` (a safety policy). Bot bodies render in `plain` mode (markers consumed, not styled; links + scripture stay live). | **No.** Reimplement exactly or bodies read differently across clients. |
| **Emoji whitelist** | `:code:` → a same-origin `<img class="mc-emoji">` **only** when on `CUSTOM_EMOJI` (60 pack entries); else a `NAMED_EMOJI` alias → its char; else literal text. Full set lazily from `emoji/emoji-data.json`. | **No.** Server stores the `:code:` text; images are static Pages assets. |
| **Scripture autolink** | 66-book spelling→slug table; `Book C:V[-V]` → `kjv.html#<slug>-<c>-<v>`. Hover preview from `kjv.json`/`dr.json`. | **No** for rendering. (The worker keeps a parallel `MERECAT_BIBLE` table for retrieval — already a two-copy discipline.) |
| **Pseudonym/reserved/bot** | `MERECAT_BOT` hash `efb94d8d…` (bot posts get `plain` render, no DM/mute affordances, unmutable); reserved-nick rules. | Server enforces the hard parts (no DM to bot, reserved nick); rendering/affordances are yours. |
| **Citation renumber** | `[n]` markers renumbered by first appearance, uncited sources dropped, footer sorted. | **No.** Stored bodies keep raw `[n]`. |
| **Mentions** | `@` picker over `/dm/directory` + a client-side fuzzy scorer; at post time, send the `mentions[]` hashes whose `@token` still stands in the body. **The server does not check the token is present** — it trusts the array (validates 64-hex/dedup/≤10/not-self-or-bot). Replicate the token check or you become a spam vector. | **No** (one-way pseudonyms are never reversed server-side). |
| **Dual-stack IP echo** | Fire-and-forget GET to `ipv4/ipv6.icanhazip.com`, attach as `ipv4`/`ipv6` body fields; server stores the opposite family as `claimed`. Omitting it halves ban coverage for your users. | Server works without it (post proceeds). |
| **Read-budget coordinator** | `READ_CEIL=15` mirrors `READ_LIMIT`; stamp each polled read, stretch to ≥12 s near the ceiling, ease to ≥8 s for 15 s on any throttle. **Mandatory** for any background polling. | **No server help** — 429s come back and you must pace yourself. |
| **Unread-badge cache** | 90 s localStorage cache on the DM and notification unread polls (stamp before fetch; clear on login/logout/blocked/open). | **No.** Exists to protect the shared 15/min bucket. |
| **Page identifiers** | `pagePath()`: `location.pathname`, `+index.html` after a trailing `/`, `+.html` if missing. Board pages are the `board:<cat>` namespace. The 7-page commentable whitelist is **not discoverable via any endpoint** (§7). | The whitelist lives server-side but isn't served. |
| **Drafts / mute / preview** | Per-composer localStorage drafts; a local mute-hash list; a preview toggle. All per-device, never server-visible. | **No.** |
| **Quote convention** | `> [Name wrote:](permalink)` + `> `-prefixed excerpt. Quoted `>` lines never trigger `@merecat`. | **No** — emit identically for quotes to render. |
| **Blocked-logout UX** | On any `{blocked}` 403: clear key + caches, show the message, redirect. | Server gives only the `{blocked}` reason; the UX is yours. |

The constants a client would otherwise triplicate — the ADJ/NOUN wordlists,
cats (keys + labels + order), faith codes + labels, `RANKS`, the `BIBLE`
table, the bot hash, and the `PAGES` whitelist — are now served by **`GET
/api/comments/config`**; read them there rather than hard-coding copies. (The
web client still ships inline copies as a pre-load fallback; that de-duplication
is a later pass.) Still not served, and small: the CGNAT `100.64.0.0/10`
admin-warning check.

---

## 7. Reference data

### 7.1 Commentable pages (`PAGES`, also served in `/config`)

`/book.html`, `/charting-communions.html`, `/free-churches.html`,
`/objections.html`, `/credo.html`, `/lex-orandi.html`, `/about.html`. A page
comment on anything else → `400 "Unknown page."`

### 7.2 Board categories (`BOARD_CATS`, keys only served)

`pub`, `news`, `offtopic`, `theology`, `philosophy`, `history`, `indoeuropean`,
`rc`, `eo`, `lutheran`, `anglican`, `presbyterian`, `prot`, `adminsonly`. The
`board:` prefix forms the page key. `adminsonly` (`ADMIN_CAT =
'board:adminsonly'`) is the **back room**: excluded from every public read with
refusals indistinguishable from nonexistence; admins reach it only through the
keyed `POST /api/comments/board/admin`. Display names/descriptions/order are
client-only.

### 7.3 D1 data model

**Database `merecatholicity-comments`** (binding `DB`): `comments`
(id, page, parent_id, title, author_hash, body, status
`live|pending|deleted`, created_at, edited_at, ai_verdict, ip/ua/os/tz/lang,
locked, sticky, replies, last_at); `profiles` (hash PK, nick, bio, signature,
avatar, faith, created_at, updated_at); `admins` (hash PK, added_by,
created_at); `locks`, `ip_bans` (normalized key), `identity_ips`, `trusted`,
`bans` (legacy); `dm_threads`/`dms`/`dm_blocks`; `notifications`/`watches`;
`thread_reads` (topic_id 0 = read-all floor); `reports`; `comments_fts` (FTS5
external-content over `comments`, `porter unicode61`, kept in lockstep by three
triggers). Indexes on page/status/id, parent/status/id, author/page/status,
and the obvious per-table keys.

**Databases `merecat-library[-deep][2]`** (bindings `LIBDB`/`LIBDB2`/`LIBDB3`,
one shared schema): `works` (id PK, title, url, tier 1–9, kind, hash, chunks),
`chunks` (cid unique, work_id, seq, heading, anchor, text), `chunks_fts`;
config/usage/user_usage/chats/chat_msgs live only in `LIBDB`. `chats`
(id, hash, title, created_at, last_at, msgs, summary, summarized_to, saved);
`chat_msgs` (id, chat_id, role `user|assistant`, body, sources JSON,
created_at, answers, done). Only these two tables are non-derived; everything
else in the library DBs is rebuilt by `librarian/ingest.py`.

---

## 8. Moderation & admin (admin-keyed)

All require the caller's hash in the `admins` table; all refuse non-admins with
`403 "No."`. Most ride `READ_LIMIT` (see §2.4). Summary:

| Route | Body | Purpose |
|---|---|---|
| `POST /api/comments/moderate` | `{key,id,act:lock\|unlock\|delete\|sticky\|unsticky}` | Govern a topic. Delete is soft and does **not** cascade to replies (cron sweeps orphans). |
| `POST /api/comments/move` | `{key,id,cat,catName?}` | Move a topic + all replies to another cat; DMs the OP (skipped into the back room). |
| `POST /api/comments/board/admin` | `{key,p?,q?}` or `{key,id,p?,find?}` | The **only** door to the back room; same payload shapes as the public cat/topic reads, never cached. |
| `POST /api/comments/approve` · `/pending` | `{key,id,kind?}` · `{key}` | Approve one AI-held post (broadcasts it live) · list the pending queue. `/pending` returns `pending` (comments rows, unchanged) **plus `pending_wall`** (2026-08-02): held FEED posts/comments as `[{id, kind:'post'\|'comment', post_id, author_hash, nick, body, created_at, media_key}]` — a separate array, never merged (the id spaces differ). Approve a wall row with `kind:'wall-post'`\|`'wall-comment'` (comment-count bump + live broadcast fire only for a non-shadowbanned author, mirroring the posting path); delete one via the existing `/wall/delete {key,id,kind}`. |
| `POST /api/comments/report/dismiss` | `{key,id}` | Clear all of a post's flags. |
| `POST /api/comments/lock` · `/deleteuser` | `{key,hash,locked}` · `{key,hash}` | Lock/unlock an identity · soft-delete a user + all posts, drop profile/avatar, lock forever. |
| `POST /api/comments/ipban` · `/ipbans` · `/rdns` | `{key,ip\|ips,banned}` · `{key}` · `{key,ips}` | Ban/unban one or many normalized IP keys (v6 folded to /64) · list bans · reverse-DNS (≤8, via DoH). |
| `POST /api/comments/profile/admin` · `/profile/clear` | `{key,hash,nick?,bio?,signature?,clear_avatar?}` · `{key,hash}` | Edit any profile in place (whole-record replace) · clear a profile + avatar (keeps faith). |
| `POST /api/comments/admins` · `/admin` | `{key}` · `{key,hash,admin}` | List the flat roster (with `assigned` names) · grant/revoke any admin (last-admin removal refused). |
| `POST /api/comments/meta` · `/audit` · `/trust` | `{key,hash\|page}` · `{key}` · `{key,hash,trusted}` | Per-identity/per-page fingerprint + known-IP drawer · 14-day activity audit (reports/pages/topics) · grant/revoke AI-screen-skip. |
| `POST /api/comments/backup` | `{key}` | Force a mid-month D1→R2 backup (check `backup.error`). |
| `POST /api/comments/admin/settings` | `{key, set?:{…}}` | Read/write `app_settings` with clamps. Media keys (Domain.Media clamps): `media_image/video/audio_max_bytes` (64 KB–100 MB legacy globals, now the FALLBACK layer), the 9 per-section overrides `media_<dm\|wall\|board>_<image\|video\|audio>_max_bytes` (same clamp; **an empty string DELETES the override** — back to inheriting the global), `media_audio_max_seconds` + `media_audio_max_seconds_<ctx>` (30–600, client-advisory — the server cannot decode audio; bytes are its wall), `media_kinds_dm/wall/board` (CSV of image,video,audio; empty = off), `media_scan_wall`/`media_scan_board` (0/1, the per-section AI image screen; there is NO `media_scan_dm` — E2E ciphertext is unscannable), `media_voice_dm/wall/board` (0/1, the 🎙 feature flag, client-advisory), `media_image_autocompress` (0/1), `media_cap_dm_bytes` + `media_cap_wall_bytes` + `media_cap_board_bytes` (100 MB–9 GB per-section store budgets; usage meters ride back as `dm_media_bytes`/`wall_media_bytes`/`board_media_bytes`), and media age retention `media_wall_retention_days`/`media_board_retention_days` (0–3650; 0 = keep forever) + `media_dm_retention_days` (1–90, the DM hard cap, default 30). `media_max_bytes` stays the absolute per-file ceiling over every per-kind cap. |
| `POST /api/comments/wall/media/purge` · `/board/media/purge` | `{key}` | Purge EVERY media object in that public section (feed+walls · forum) — R2 objects + rows deleted, every media-carrying parent stamped `media_expired` (text kept), that section's usage meter zeroed. `{ok, deleted}`. Safe to re-click; the DM sibling is `/dm/media/purge`. |

**merecat admin/tooling** (all `requireAdmin`): `POST /api/merecat/about`
(model/persona/works roster — url-less rows are the private shelves, render as
bare titles), `/works`, `/config` (live persona + config, ~5 min per-isolate
cache), `/backends` (local GPU health probe, multi-second), `/stats`,
`/admin/threads` + `/admin/thread` (30-day read-only observation), `/mention`
(re-summon the bot on a comment), `/ingest` (the `librarian/ingest.py`
begin/append/end/delete protocol).

---

## 9. The contact form (`contact-worker`)

`POST https://contact-api.merecatholicity.com` (any path). **Form-encoded**
(`multipart/form-data` or `x-www-form-urlencoded`), not JSON. Fields: `name`
(≤200, optional), `email` (≤200, optional, used as reply-to only if valid),
`message` (≤5000, **required**), `cf-turnstile-response` (Turnstile token,
solved on the site hostname), and **never** `website` (honeypot → fake
`{ok:true}`). Gates in order: `SEND_LIMIT` 3/60 s → form parse → honeypot →
field validation → Turnstile → send via Cloudflare Email Routing to the
verified `CONTACT_TO`. Responses: `200 {ok:true}` · `400` (bad request / empty
message) · `403` (bad origin / Turnstile) · `405` (non-POST) · `429` · `502`
(delivery failure). CORS is emitted for the two site origins; a missing Origin
passes.

---

## 10. Notes & drift

- `POST /api/merecat/ask` **no longer exists** — asking is `ask-init` + the
  `/api/merecat/live` WebSocket. `POST /api/merecat/store` is a retired no-op.
- The shared constants (pseudonym wordlists, `FAITHS`, cats, `MERECAT_BOT` hash,
  the `BIBLE` table, `PAGES`, `RANKS`) are now served by `GET
  /api/comments/config` — a native client reads them there instead of copying.
  The worker and `comments.js` still keep inline copies that must stay identical
  until the web client is switched to read `/config`.
- Full behavioral detail (the merecat retrieval legs, disconnect/resume
  contract, back-room doctrine, the cron chain, backups) lives in `CLAUDE.md`;
  this file is the wire contract clients build against. The free-tier budget
  law binds any new endpoint.
