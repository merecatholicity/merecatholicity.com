# Recommended path forward — unify the essential user settings under the gear

## Context

The app is growing from a forum into a platform: **Home / Merecat / Global Feed / Community / Inbox / Profile**, with DMs (disappearing, E2E, media), and an in-progress plan adding **presence + read receipts + typing** (Phase B) and **public walls + a global feed with media** (Phase C). As features land, genuine user preferences are scattered or missing, and the gear is the natural single home. The owner's constraint is explicit: **not the overwhelming setting-sprawl of Instagram/Facebook — just the basic essentials, unified under the gear.**

Investigation of the current codebase found:

- **Already in the gear** (`app/appchrome.js:251` `McSettings`, render `:293–331`): Account (My profile link, a **presence toggle "Show when I'm online"** the Phase B agent just added `:257–303`, Show my key, Log out / Create identity), Appearance (Theme + palette, engine in `nav.js:7–52`), Administration (admins only).
- **Real preferences with NO central home today:**
  - **Blocked members** — server `dm_blocks` (`schema.sql:150`), toggled ONLY inside an open DM thread (`comments.js:5371`); there is **no list endpoint and no way to see who you've blocked** except by reopening that conversation. *Biggest gap.*
  - **Muted members** — client-only `mc-muted` (`comments.js:447`), toggled per-post (`:2047`) and per-profile (`:4387`); **no roster, no bulk unmute.**
  - **Notification controls** — **none exist at all.** Delivery (`deliverNotifications` `index.js:637`, `notifyDm` `:706`) is strictly always-on; the only lever is per-thread Watch/Unwatch.
  - Stranded/absent: Merecat reasoning level (`mc-merecat-mode`, only inside the merecat view), the `?app=0` classic-site latch (URL-only, invisible), and no in-app PWA install affordance (SW+manifest wired at `shell.js:276–286`, but no `beforeinstallprompt`).
- The in-progress plan adds **read receipts** (Phase B, no opt-out) and **public posting** (Phase C) — both imply settings a user expects.

**Owner decisions (this session):** read-receipts opt-out = **yes, reciprocal**; notifications = **per-type on/off**; extras = **add "Install app"** (not the classic-site toggle).

## The recommended gear (the whole picture)

Lean and opinionated — six short sections, most 1–3 rows. Everything a DM/feed/presence platform needs, nothing like the big-platform sprawl.

```
⚙  Settings
─ Account
   • My profile              → profile.html   (name, faith, avatar, bio, signature — unchanged)
   • Show my key / Copy
   • Log out                 (logged out → Create an identity)
─ Appearance
   • Theme  (light / dark) + palette (charcoal / slate / warm ink)
─ Privacy & safety                              ← NEW section, the consolidation point
   • Presence:  Automatic / Appear offline       (exists — RELOCATE here from Account)
   • Read receipts:  On / Off                     NEW · reciprocal (off ⇒ you send none AND see none)
   • Blocked members  → managed list (Unblock)    NEW · surfaces dm_blocks
   • Muted members    → managed list (Unmute)     NEW · surfaces mc-muted
─ Notifications                                  ← NEW section (owner chose per-type)
   • Replies            [on/off] ┐
   • Mentions           [on/off] ├ checked server-side at delivery
   • Direct messages    [on/off] ┘
─ Administration  (admins only)
   • Administrative options       (unchanged)
─ App
   • Install app                  NEW · shown only when the browser offers it
```

## Implementation path (workstreams, by effort)

**B — Muted-members list (client-only, cheapest; touches no in-flight files).**
`mc-muted` is readable client-side, so a roster needs zero server work. Add a gear row → a managed-list panel (sheet on mobile, dropdown panel on desktop) that resolves each hash to a name via the cached `/dm/directory` + `displayName`, each with an **Unmute** button calling the existing `toggleMute` (`comments.js:458`). Reuse the `.user-list`/`.user-row` styling from `app/views/member.js`.

**E — Install app (PWA; touches only `shell.js` + the gear).**
In `shell.js`, capture `beforeinstallprompt` (`e.preventDefault()`, stash the event, expose a flag/CustomEvent); add `appinstalled` to clear it. The gear renders the **Install app** row only when a stashed prompt exists; clicking calls `prompt()`. Self-contained, no server.

**A — Blocked-members list (highest value; touches the worker + gear).**
New keyed read `POST /api/comments/dm/blocked {key}` → the owner's blocked rows (`SELECT … FROM dm_blocks WHERE owner_hash=?`) with names via the existing `withNames`/`displayName`. **Unblock reuses the existing `handleDmBlock` (`index.js:2510`, `{blocked:false}`)** — no new write. Gear row → managed-list panel (same pattern as B) with an **Unblock** button per member.

**D — Notification per-type prefs (new, self-contained on the worker).**
Store three booleans per user (default on) — cleanest as additive `profiles` columns `notify_reply` / `notify_mention` / `notify_dm` (mirrors how `faith` lives on `profiles`), or a single JSON `prefs` column. Gate delivery on them: `deliverNotifications` (`index.js:637`) checks the recipient's reply/mention pref before inserting; `notifyDm` (`:706`) checks the dm pref. **Nuance to honor:** "Direct messages off" suppresses the *bell notification/ping* only — the message still arrives and the **inbox unread badge still updates** (they are separate paths). Load current values in `loadMyProfile` (already fetches the profile) and write via `handleProfileSave` (the same door presence/faith use) or a small `/notifications/prefs` endpoint. Add a `Domain.Notify` (or extend `Domain.Profile`) with the pref shape + `normalize`, with `tests/purescript/*.test.mjs` — per the repo's single-source rule.

**C — Read-receipts opt-out (COORDINATE with the in-flight Phase B).**
This overlaps the agent currently building receipts. Recommend **folding it into Phase B** rather than as a separate slice: add `profiles.receipts_mode` ('auto'/'off'), gate the server-emitted `dm-read` (Phase B emits it in `handleDmThread` after the open-rebase UPDATE) on the **reader's** pref, and **reciprocally** hide others' "Seen" from a user who has it off. The gear toggle writes it exactly like the presence toggle already does (`handleProfileSave` + a live re-auth). It's a ~1-column + 1-check addition to work already underway.

**F — Gear restructure (do LAST; the merge-risk hotspot).**
Reorganize `McSettings` into the six sections above and **relocate the presence row into "Privacy & safety."** Because the Phase B agent is actively editing `mc-settings` (presence) and `index.js` (DMs/notifications), do this restructure **after Phase B/C land**, so the gear isn't a merge battlefield.

## Coordination & sequencing with the in-flight A→B→C→D plan

The other agent is editing the **same** files this touches (`appchrome.js` mc-settings, `index.js` DM/notification handlers, `live.js`). Recommended order:

1. **Now, in parallel (no collisions):** ship **B (Muted list)** and **E (Install app)** — they touch client-only files the other agent isn't in.
2. **Fold C (read-receipts opt-out) into Phase B** — hand it to the other agent (it's a small add to receipts they're already building), or take it immediately after Phase B lands.
3. **After Phase C (feed/walls) lands:** ship **A (Blocked list)** + **D (Notification prefs)** as their own slices, then **F (gear restructure)** as the closing step that assembles the final six-section gear.

## Deliberately excluded (to keep it un-overwhelming)

- **Per-user default DM TTL** — the per-conversation chooser (`dmExpiryNode` `comments.js:820`) + the 30-day default already cover it.
- **Wall/feed privacy toggles** (who can post/comment) — Phase C's defaults are sensible (your wall is yours; members comment). Revisit only if asked.
- **Media autoplay / data-saver, quiet hours, saved-messages aggregate view** — big-platform scope creep; future at most.
- **Merecat reasoning level in the gear** — it's contextual to the merecat view (per-device memory already); leave it there.
- **Classic-site `?app=0` toggle** — stays a hidden URL latch (owner chose not to surface it).
- **Faith as a gear row** — stays in the profile editor, reached via "My profile"; no duplication.

## Verification (per the repo's standing gates)

- **`make tests`** green — new/updated `Domain` module(s) for notification prefs (+ read-receipts mode if taken here) with `tests/purescript/*.test.mjs`; `tests/js/core.test.mjs` for any new membrane fn.
- **`make jscheck`** after any worker/client JS edit; **`make bundle`** twice → `git diff --exit-code docs/app.js` (determinism) and **bump `app.js?v=` / `comments.js?v=`** on change.
- **Worker/data:** apply the additive D1 migrations (new `profiles` columns; `receipts_mode` if here) to prod D1; the new `/dm/blocked` and any prefs route.
- **Layer 2 headless** (`make serve` + `MC_BASE=http://127.0.0.1:8000`): the Blocked/Muted managed panels (list + unblock/unmute), the Notification switches actually suppress the right kinds, the Install-app row appears on a `beforeinstallprompt`, and (two browser sessions) read-receipts reciprocity + presence.
- Ship per the standing deploy authorization (commit, push, `make worker-deploy` for the endpoints, purge edge), then re-verify against prod.
