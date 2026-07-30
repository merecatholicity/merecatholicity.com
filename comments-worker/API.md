# The Mere Catholicity headless API

The dynamic side of the site is a real headless API: one Cloudflare Worker
(`comments-worker/src/index.js`) over D1 (comments/board/DMs/notifications/
profiles/admin), R2 (avatars, backups), and — for the librarian — D1 +
Vectorize (`/api/merecat/*`). Every route is same-origin under
`merecatholicity.com` (no CORS). The Lit frontend consumes it through the
client SDK `app/api.js` (reads via the `app/store.js` cache; writes direct).
This file is the contract; keep it current when a route changes.

**Conventions.** JSON in / JSON out. A response is `{ok:true, …}` or
`{ok:false, error}`. Identity is a browser-generated key; the server stores
only `sha256(key)` and every keyed call sends `key`. Gates: **Turnstile**
(`token`) on member writes; **blockedReason** (lock/ban) on keyed writes +
the DM/notif unread polls; **admin** (the `admins` D1 table) on moderation.
Rate limits: `READ_LIMIT` 15/60s/IP on reads, `POST_LIMIT` 5/60s/IP on
writes. Public reads carry `Cache-Control` and are edge-cacheable; keyed and
`?fresh=1` reads are `no-store`. **Free-tier only** — every feature stays in
Cloudflare's free plan.

## Comments & board — reads (public, cacheable)
| Route | Method | Purpose / key params |
|---|---|---|
| `/api/comments?page=<path>` | GET | a page's comment thread |
| `/api/comments/board` | GET | board index: per-category topic/post counts + latest |
| `/api/comments/board/cat?cat=&p=&q=` | GET | one category's topics (paged; `q` = title filter) |
| `/api/comments/board/topic?id=&p=&find=` | GET | one topic + replies (paged; `find`=comment id → its page) |
| `/api/comments/board/author?hash=&p=` | GET | a member's live forum posts (profile "recent posts") |
| `/api/comments/search?q=&cat=&author=&sort=&p=` | GET | FTS5 forum search; `<mark>` via control chars |
| `/api/comments/feed?page=|cat=|topic=` | GET | RSS |
| `/api/comments/profile?hash=` | GET | one profile |
| `/api/comments/avatar?hash=&v=` | GET | avatar image (R2) |
| `/api/comments/dm/directory` | GET | member roster (DM autocomplete; omits the bot) |

## Comments & board — writes (keyed; Turnstile on member posts)
| Route | Method | Purpose |
|---|---|---|
| `/api/comments` | POST | post a page comment / board topic (`cat`+`title`) / reply (`topic`) |
| `/api/comments/edit` | POST | edit own comment |
| `/api/comments/delete` | POST | soft-delete own comment (admins: any) |
| `/api/comments/report` | POST | flag a post for moderators (never hides it) |
| `/api/comments/watch` | POST | `act` status/watch/unwatch a topic |
| `/api/comments/board/read` · `/read-all` · `/reads` · `/unread` | POST | thread-read state + unread counts |

## Direct messages & notifications (keyed, blockedReason-gated)
| Route | Method | Purpose |
|---|---|---|
| `/api/comments/dm/send` | POST | send a DM (Turnstile) |
| `/api/comments/dm/threads` · `/thread` · `/unread` | POST | inbox list · one thread · badge count |
| `/api/comments/dm/block` · `/delete` | POST | shadow-block · per-side clear |
| `/api/comments/notifications` · `/unread` · `/read` | POST | list · badge · mark-all-read |

## Profiles & avatars (keyed; AI-screened)
| Route | Method | Purpose |
|---|---|---|
| `/api/comments/profile` | POST | save own profile (nick/bio/signature) |
| `/api/comments/profile/clear` | POST | clear own profile |
| `/api/comments/avatar` | POST | upload avatar (400×400 JPEG, magic-sniffed, LLaVA-screened) |
| `/api/comments/avatar/delete` | POST | remove own avatar |

## Moderation & admin (admin-keyed)
| Route | Method | Purpose |
|---|---|---|
| `/api/comments/moderate` | POST | `act` lock/unlock/sticky/unsticky/delete a topic |
| `/api/comments/move` | POST | move a topic to another category (DMs the OP) |
| `/api/comments/board/admin` | POST | read the back room (cat listing / topic view) |
| `/api/comments/approve` · `/pending` | POST | AI-held queue: approve / list |
| `/api/comments/report/dismiss` | POST | clear a post's flags |
| `/api/comments/lock` · `/deleteuser` · `/ipban` · `/ipbans` · `/rdns` | POST | identity lock · delete user+posts · IP ban(s) · reverse-DNS |
| `/api/comments/profile/admin` | POST | edit/clean any member's profile in place |
| `/api/comments/admins` · `/admin` | POST | list roster · grant/revoke admin |
| `/api/comments/audit` · `/meta` · `/trust` | POST | activity audit · per-page meta · (legacy) |
| `/api/comments/backup` | POST | force a mid-month D1→R2 backup |

## merecat, the librarian (`/api/merecat/*`)
| Route | Method | Purpose |
|---|---|---|
| `/api/merecat/ask` | POST | keyed, capped: streams an answer (JSON preamble + tokens); mints/continues a thread |
| `/api/merecat/store` | POST | LOCAL-KEY: the local GPU backend's answer callback (disconnect contract) |
| `/api/merecat/chats` · `/chat` · `/chat/save` · `/chat/delete` | POST | own threads: list · read · save · delete |
| `/api/merecat/forward` | POST | forward one answer to a board topic (owner-keyed) |
| `/api/merecat/mention` | POST | admin lever: re-summon @merecat on a comment |
| `/api/merecat/usage` · `/about` · `/works` | POST | quota line · model+persona+roster · works roster |
| `/api/merecat/admin/threads` · `/admin/thread` | POST | admin READ-ONLY observation (30-day window) |
| `/api/merecat/backends` · `/config` · `/stats` | POST | admin: backend status · live config · usage |
| `/api/merecat/ingest` | POST | admin (ingest key): corpus push from `librarian/ingest.py` |
| `/api/contact` (separate `contact-worker`) | POST | contact form → Email Routing |

**Notes.** Full behavior for each lives in CLAUDE.md (the merecat section is
exhaustive on the ask/stream/disconnect/failover contracts). The duplicated
wordlists discipline (pseudonym/reserved/faith/`BIBLE` lists shared between
worker and client) and the free-tier budget law both bind any new endpoint.
