# The platform reviewed whole: where the effort should go next (2026-09-17)

A standing review in the sense of CLAUDE.md's "a review or a hand-over note is a dated file under
`docs/architecture/reviews/`". It was asked for as "a full codebase and feature review with
recommendations and prioritizations". It is written against the tree at `b58fa65` and against
**production as it actually answered on 2026-09-17**, not against the documents' account of it.

Everything below that carries a number was measured, and the command that measured it is named.

---

## 1. What the machine is

Measured over the hand-written tree (`wc -l`, excluding generated output):

| Layer | Files | Lines |
|---|---:|---:|
| PureScript kernel (`purescript/src/Domain/*`) | 40 | 4,083 |
| the shell bundle (`app/`) | 25 | 8,023 |
| the classic client (`client/`) | 16 | 14,479 |
| `comments-worker/src` | 27 | 13,158 |
| `contact-worker` | 2 | 157 |
| build tooling (`scripts/`) | 20 | 2,730 |
| Layer-1 tests (`tests/`) | 148 | 16,885 |
| Layer-2 headless (`webtest/`) | 33 | 5,360 |
| Terraform | 11 | 1,826 |

`make tests` is green (0 failures, run 2026-09-17). `npm audit` reports 0 vulnerabilities. Three
dev dependencies are one patch behind. There is not a single `TODO`, `FIXME`, `XXX` or `HACK` in
the hand-written sources. Every `uses:` is SHA-pinned, the workers hold zero `any`, the env is a
sealed object that throws when copied, and 274 pages, 244 PDFs, four crons, two Durable Objects,
19 D1 migrations and the whole Cloudflare zone ship from a `git push`.

**This is, by a distance, the most disciplined small codebase I have read.** The rest of this
document should be read with that as the premise, not as faint praise: nothing below is a
complaint about how the work is done.

## 2. What the product is

The same afternoon, production answered:

```
GET /api/comments/board   →  4 categories · 6 topics · 78 posts · last post 2026-09-08
GET /api/comments/dm/directory → 15 identities, 11 of them with no nick
```

Nine days without a post. Of the 78 posts, the visible authors are the owner and the merecat bot.

Against that, the platform offers: a forum with categories, ranks, watches, read marks and
full-text search; a feed and per-member walls; end-to-end encrypted direct messages with group
threads, per-message envelopes, forwarding, reactions, disappearing messages and media; 1v1 voice
calls with a stored ring and push wake-up; Web Push; an AI librarian over a five-legged retrieval
stack; reactions; bookmarks; a journal; moderation consoles with shadowbans, IP bans, reverse DNS,
audit trails and a Discord fan-out; a PWA with a service worker, haptics, pull-to-refresh and a
six-tab phone shell.

**The capability curve and the usage curve have come apart, and the gap is the single most
important fact about this project right now.** Every hour spent on the machine compounds; almost
none of it is compounding on anything yet, because there is nobody on the other side of it.

That is not an argument for abandoning the machine. It is an argument about *sequence*. The
sections below are ordered by what I would do, and the ordering is: close the one real hole, then
serve the readers who are already arriving, then give them a way to come back — and only then
resume the interior refactor.

---

## P0 — One security chain, exploitable today, no authentication required

This is the only finding in this document I would call urgent.

**The chain.** An identity's account secret is a key held in `localStorage`. The server stores and
publishes `SHA-256(key)`, unsalted, one round (`comments-worker/src/lib.ts:294`). That same hash
is the member's *public* identifier: it is the profile URL, the avatar URL, and the `author_hash`
on every comment, every feed post and every board read. And `GET /api/comments/dm/directory`
(`comments-worker/src/routes/dm.ts`, mounted keyless in the `ROUTES` table) hands out **every
member's hash to anyone who asks, with no key at all** — verified from the command line on
2026-09-17: 15 hashes, with join times and nicks.

Meanwhile sign-in accepts any key of 16 characters or more (`client/profile.ts:594`), and the
weak-key check is a **client-side toast that never refuses** (`app/appchrome.ts:1606-1609`,
`Domain.Auth.keyStrength`). There is **no server-side key-strength check anywhere** — grepped.

So the complete attack is:

1. `curl https://merecatholicity.com/api/comments/dm/directory` — no key, no Turnstile, no origin
   check (it is a GET), one read-limit token.
2. Run a wordlist against the returned hashes offline. Unsalted single-round SHA-256 runs at
   billions of guesses per second on one consumer GPU; the site's own rate limits are irrelevant
   because no request is made.
3. Any member who typed a memorable key rather than accepting the generated one is now
   impersonable — their posts, their profile, their DMs, their calls.

**The admin is the highest-value target and the most exposed.** `ADMIN_HASHES` is a literal in
`client/admin-core.ts:27`, shipped in the bundle to every visitor, and the admin's hash is also on
every board response. If the owner's key is a generated 43-character one this costs the attacker
nothing but electricity and fails; if it is a passphrase, the whole platform falls to a wordlist.

**The remedy, in three layers.** They are independent; ship them in this order.

1. **Today, one hour.** Key the directory — `gated(request, env, { bucket: 'READ_LIMIT', key: 'required' })`
   like every other DM route — so bulk harvesting requires an identity and counts against a member
   bucket. This does not close the hole (hashes are still on every board read) but it removes the
   one endpoint that serves the whole roster in a single anonymous request. Carry the test in the
   same commit: the route's own case in `tests/worker/routes.test.mjs`, plus a line in
   `env_leak.test.mjs`'s reachability floor so the keyed form is proven to still answer.

2. **This week, half a day.** Make the weak-key path a *refusal* for new identities and a
   *blocking* confirmation for an existing one, and raise the floor from 16 characters to the
   kernel's `Strong` (20 characters, three classes). The law belongs in `Domain.Auth` where
   `keyStrength` already lives, and it belongs on **both** sides — the server cannot check a key's
   strength after the fact, but it can check it at the moment the key is presented, which is every
   request. Then take the fifteen live hashes and run your own wordlist against them; any that
   falls is a member you contact and rotate, and the exercise tells you whether layer 3 is urgent
   or merely correct.

3. **The structural fix, two to three days.** *Stop publishing the hash of the secret.* The
   account hash stays the primary key everywhere in D1; what crosses the wire becomes a derived
   public id — `SHA-256(PUBLIC_ID_PEPPER || hash)`, a stored `profiles.pubid` column so it is one
   lookup, never a per-row digest. Every public read serves `pubid`; the client never sees
   `author_hash` again; `ADMIN_HASHES` becomes `ADMIN_IDS`; `/@handle` and `?u=` already address
   members by handle and are unaffected. Old `profile.html?u=<hash>` links can be honoured one
   deploy by accepting either form. After this, a leaked public id is worth nothing: inverting it
   requires the pepper, which lives in `wrangler secret`.

   This is the change that makes the design safe rather than safe-if-everyone-chose-well, and it
   is the one I would actually schedule. It is a migration, a mapper change in `db.ts`, and a
   sweep of the client — all of it inside seams this codebase already has.

**Two smaller notes in the same area.** The AI budget guard "stands OPEN when the meter cannot be
read" (`comments-worker/src/quota.ts`) — a deliberate, documented availability choice, but it
means a day-long Cloudflare analytics outage plus a determined asker is an unbounded neuron bill.
A hard per-day question counter in D1, checked when the meter is unread, costs one row and closes
it. And `mediaUpload` throttles by address only (the key is not parsed until after `formData()`),
so a parish behind one address shares one upload allowance; correct as written, worth knowing.

---

## P1 — The reading experience, which is where the readers already are

The forum is dormant; the **library is not**. 274 pages and 244 PDFs of patristic, conciliar and
classical text are the only part of this site with organic reach, and they are the worst-performing
part of it.

**Ninety-one pages are over one megabyte.** Measured with `stat` over `docs/*.html`:

```
anf03.html    5.3 MB      npnf204.html  4.7 MB      anf05.html    4.5 MB
npnf108.html  4.8 MB      npnf201.html  4.5 MB      summa-ss.html 4.4 MB   … 85 more
```

`anf03.html` transfers **1.56 MB compressed** and parses into **56,425 elements** (`curl -w
%{size_download}` with `Accept-Encoding: br,gzip`; tag count by grep). On a mid-range phone on
mobile data that is several seconds to first paint and a DOM large enough to make scrolling
janky — and every one of those pages also pulls `nav.js` → `chrome.js` + `app.js`, another ~101 KB
gzipped of application shell that a reader of Ante-Nicene Fathers volume III will never use.

These are the pages Google sends people to. Their field vitals are the site's field vitals.

1. **Split the volumes into chapter pages.** The Summa is already split three ways
   (`summa-fp` / `summa-fs` / `summa-ss`) and `summa.html` is a 5 KB index — the pattern exists,
   it is just not applied finely enough. The pandoc invocations in `resources/Makefile` already
   emit a `--toc` at a configurable depth; splitting at that same depth gives a volume index plus
   one page per treatise or book. This is the highest-return single change available: it fixes
   mobile reading, it multiplies the indexable URL surface by an order of magnitude, and it gives
   merecat's citations far sharper deep-link targets than "somewhere in a 5 MB page".
2. **Do not load the app shell on corpus pages.** A reader on `anf03.html` needs the theme
   cookie, the nav and nothing else. `nav.js` already decides what to inject; let a page opt out
   of `app.js` the way `?app=0` does, by class of page rather than by query string.

**Three metadata defects, all one-line fixes, all sitewide.** Measured by grep over `docs/*.html`:

- **`lang=""` on 237 of 274 pages.** An empty language attribute is a WCAG 3.1.1 (Level A) failure
  on 86% of the site: a screen reader cannot choose a voice, and search engines cannot determine
  language. Every pandoc call needs `--metadata lang=en`.
- **230 pages carry more than one `<h1>`.** Flat, duplicated heading structure hurts both screen
  readers and search engines. The `\section*` → `<h1>` mapping in the LaTeX sed chain is the cause.
- **One page in 274 has `rel="canonical"`.** The site answers on both `merecatholicity.com` and
  `www.`, so every page has at least two addresses. A canonical tag is the standard remedy and the
  build already writes `og:url` — the same value, one more tag.

Also missing on the corpus pages: a skip link, on documents with a 34-entry table of contents.

**And there is no analytics at all.** `static.cloudflareinsights.com` and `cloudflareinsights.com`
are already allowlisted in the zone's CSP (`terraform/rulesets.tf:333`) but nothing is served — I
checked the live HTML. Cloudflare Web Analytics is free, needs no cookie banner, and is a Terraform
resource. **Turn it on before doing any content work**, because without it every judgement about
which of the 274 pages is worth splitting first is a guess.

---

## P2 — Give a reader somewhere to go, and something to come back to

1. **Server-render the forum.** The worker already serves HTML at a real URL: `/@handle` fetches
   `profile.html` and rewrites its metadata through `HTMLRewriter`
   (`comments-worker/src/routes/profile.ts`, the `handleHandleCard` pattern), with a Terraform
   route pattern per hostname. Extend exactly that to `/t/<id>-<slug>`, and inject the topic's
   **body and replies** into `<main>`, not just the `og:` tags. Today a topic lives at
   `community.html?topic=7`, renders entirely from JavaScript, appears in no sitemap, and is
   invisible to search in practice. Afterwards every discussion is a page with a title, a
   description, a share card and a URL worth linking. On an apologetics site, threads answering
   "was Peter the first pope" are precisely the long-tail surface currently being thrown away.
   One to two days, inside a proven pattern.
2. **Publish an RSS/Atom feed.** `feed.xml`, `rss.xml`, `atom.xml`, `journal.xml` and `index.xml`
   all return 404. The owner's own journal topic says the journal is "intended to also be
   replicated to its own page via RSS". This audience reads RSS. The build already writes
   `sitemap.xml` from `scripts/gen_sitemap.py`; a feed is the same walk with a different template.
3. **Capture an email address.** There is no newsletter field, no list, no way for a reader who
   liked the book to hear about the next paper. `contact-worker` already proves the pattern
   (Turnstile-gated POST to a worker); Cloudflare Email Routing is already in the stack. This is
   the one distribution channel that does not belong to a platform.
4. **Then, and only then, seed the forum.** Six topics with a nine-day-old last post is not a
   community; it is a room. Fifteen or twenty seeded topics drawn from the book's arguments, each
   one a real question with a real first answer, gives an arriving reader something to read and a
   reason to reply. This costs writing time, not engineering time — which is the point.

---

## P3 — The engineering debt, re-sequenced

The write-path port (`docs/architecture/reviews/2026-09-17-port-plan.md`, P0–P7, ~23 agent-days) is
correct in direction and the invariants it sets are exactly right. My only quarrel is with its
order, given everything above.

- **Pull P1 forward** (services out of the boot: transport, identity, Turnstile, the surface, the
  DM crypto). It is the cheapest phase, it shrinks the kit from 66 members to about 30, and it is
  the phase the others depend on.
- **Push P5 and P6 back** (merecat, 3 days; the DM thread, 5 days — a third of the whole
  programme). They are the largest phases and they serve the fewest people: the DM system has
  fifteen possible participants. They are also the two whose laws are hardest to move safely.
- **P2, the admin consoles**, needs an admin key on the dev box before it can be verified
  headlessly. That is an owner decision the plan already flags; make it or accept the manual pass,
  but decide it before the phase starts rather than inside it.

Net: P0-router + P1 + P3 is roughly nine days and delivers the payload win (the eight app pages
stop shipping 75 KB gzipped of a second client) without touching the two hardest subsystems.

**Two product decisions worth revisiting, both currently deliberate:**

- **"Loss is unrecoverable by design"** (`client/profile.ts:1278`). Defensible for a
  privacy-first identity, and QR device-linking is a real mitigation. But ordinary people clear
  browser storage, and when they do they lose their account, their history and every DM — the DMs
  irrecoverably, since the envelope is sealed to their key. As the member count grows past the
  owner's friends this becomes the commonest support request there is. An *optional* encrypted-key
  escrow (the key sealed under a passphrase, stored server-side, opened by email round-trip) keeps
  the default honest while giving people who want a safety net one.
- **Two identities are two accounts.** Nothing links a phone and a laptop except the QR. That is
  the same decision seen from the other side, and the same escrow answers it.

---

## 4. What I would not do

- **Do not chase the duplication number.** CODEBASE.md's 8% is from 2026-08-01 and predates both
  the worker split and the retirement of the thirteen classic twins. Re-measuring it is a morning's
  work that changes no decision.
- **Do not add features to the social layer.** Not one. The layer is more capable than its
  population by two orders of magnitude, and every addition widens the surface that P0's fix has
  to sweep.
- **Do not hand-optimise the worker's SQL.** 329 `.prepare()` calls sound alarming and are not: the
  hot paths are covered by composite primary keys (`reactions(target,target_id,author_hash)`,
  `dm_members(thread_id,hash)`, `dm_keys(msg_id,hash)`, `thread_reads(hash,topic_id)`), the
  unbounded selects are all admin-only over tables with tens of rows, and the D1 session/replica
  split is already in place. The 2026-09-16 decision to stop pursuing the full repository layer
  was the right one and should stay made.

## 5. The shape of the next ninety days

| When | What | Days |
|---|---|---:|
| This week | P0 layer 1 + 2 (key the directory, refuse weak keys, audit the fifteen hashes) | 1 |
| This week | Cloudflare Web Analytics on; `lang`, canonical, single `h1`, skip link | 1 |
| Weeks 2–3 | P0 layer 3 (the public id decoupled from the secret) | 3 |
| Weeks 2–4 | Split the 91 oversized corpus pages; drop `app.js` from reading pages | 4 |
| Weeks 4–5 | Server-rendered `/t/<id>-<slug>`; RSS; email capture | 4 |
| Weeks 5–12 | Port P0-router, P1, P3; seed and tend the forum in the same weeks | 9 + writing |

Nineteen engineering days. The rest of the quarter is writing, which is the constraint that
actually binds.

---

*Measured 2026-09-17 against `b58fa65` and against production. The commands are named inline so
every figure can be re-run.*
