/* comments-worker/src/routes/dm.ts — the direct messages: the send core (deliverDmWord) and the forward, the roster, the groups and their announcements, the inbox and the thread, unread, presence, blocked, ttl, save, react, seen, edit, redact, the media upload and GET, block, delete, the directory and the public key.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. The three read
   payloads (/dm/thread, /dm/threads, /dm/roster) are built as their app/wire.ts
   types — the one home of the DM wire shapes, shared with app/api.ts (2026-09-16). */
import * as Dm from '../../../purescript/output/Domain.Dm/index.js';
import * as Prefs from '../../../purescript/output/Domain.Prefs/index.js';
import * as Media from '../../../purescript/output/Domain.Media/index.js';
import { inList } from '../db.ts';
import {
  CONTROL_RE,
  DM_CLEARED,
  DM_ENC_MAX,
  DM_PER_PAGE,
  DM_TTLS,
  DM_VIS,
  dmThreadFor,
  ensurePairThread,
  dmCurrentMembers,
  dmRecipients,
  dmMembersPayload,
  dmPairRoomRows,
  dmPubkeysOf,
  dmMediaReadable,
  releaseMediaRefs,
  dmPairKey,
  dmGroupName,
  dmEligible,
  sendSystemDmLine,
  MAX_BODY,
  MERECAT_BOT,
  blockedJson,
  blockedReason,
  cacheHeader,
  deliverPush,
  displayName,
  dmBackstopSeconds,
  dmDefaultTtl,
  dmLive,
  dmUnreadCount,
  enc,
  getAppSettings,
  isEstablished,
  mediaKindsFor,
  mediaMaxAcross,
  json,
  keyedGated,
  notifyDm,
  notifyEnabled,
  notifyPrefsFor,
  notifyReact,
  retractReactNotif,
  publishLive,
  publishUser,
  hubViewersOf,
  hubDmViewing,
  hubPresenceOf,
  randomHex,
  dmReaction,
  sha256hex,
  verifyTurnstile,
  notifUnreadCount,
  hiddenHashes,
  gated,
  readLimited,
  throttle,
  listOf,
  bodyOf,
} from '../lib.ts';
import type { DmMessage, DmReaction, DmRosterPayload, DmThreadPayload, DmThreadsPayload, DmThreadsRow } from '../../../app/wire.ts';
import type { Env } from '../env.ts';
import type { Body, HubEvent } from '../lib.ts';

async function handleDmSend(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many messages at once. Wait a minute and try again.', block: true });
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  return deliverDmWord(env, ctx, me, data, Math.floor(Date.now() / 1000));
}

/* The delivery core of a word (2026-09-13: shared by /dm/send and the batched
   /dm/forward, which passes the gate once for up to ten words): the
   conversation, the shadow hold, the envelope's roster, the attachment's
   claim, the row and what hangs off it, the fan-out, the bells. Everything
   before it — the throttle, the ban, Turnstile — is the caller's. */
async function deliverDmWord(env: Env, ctx: ExecutionContext | undefined, me: string, data: Body, now: number) {
  const to = String(data.to || '');
  const threadId = Math.floor(Number(data.thread_id) || 0);
  if (!threadId && !/^[0-9a-f]{64}$/.test(to)) return json({ ok: false, error: 'Bad request.' }, 400);
  /* enc = 3: the sealed envelope (2026-09-13) — a content key per message,
     boxed once per member, `keys` naming every current member (the sender
     included); enc = 1: the pair's box, accepted one deploy for a bundle
     from before; enc = 0: a legacy/plain body. Either way the store is
     verbatim — the server never reads the message content. */
  const enc = (data.enc === 3 || data.enc === '3') ? 3 : ((data.enc === 1 || data.enc === true) ? 1 : 0);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The message is empty.' }, 400);
  if (body.length > (enc ? DM_ENC_MAX : MAX_BODY)) return json({ ok: false, error: 'The message is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!threadId && me === to) return json({ ok: false, error: 'That would be a soliloquy.' }, 400);
  if (!threadId && to === MERECAT_BOT.hash) {
    return json({ ok: false, error: 'merecat is a librarian, not a correspondent. Mention @merecat in a post or comment, or visit the merecat page.' }, 400);
  }
  /* The conversation: an existing one by id (mine, current — a stranger's id
     is "no such conversation"), or a pair's room by its other, made on this
     first word. */
  let thread: { id: number; kind?: number } | null = null, other = '';
  if (threadId) {
    const found = await dmThreadFor(env, me, { thread_id: threadId });
    if (!found || !found.thread) return json({ ok: false, error: 'No such conversation.' }, 404);
    thread = found.thread; other = found.other;
  } else other = to;
  const kind = thread ? (Number(thread.kind) || 0) : 0;
  /* The shadow hold is a PAIR's: a word sent to someone who blocked me is
     stored held — delivered to my eyes, invisible to theirs, never told. In
     a group the block is the blocker's alone (their read path hides my
     words; dmRecipients leaves them out) and the group goes on. */
  let held = 0;
  if (kind === 0 && other) {
    const blockRow = await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2').bind(other, me).first();
    held = blockRow ? 1 : 0;
  }
  /* Envelope v2's roster check: the sealed keys must name EXACTLY the current
     members (Domain.Dm.membersEqual) — a key for a stranger would hand them
     the word, a missing one would blind a member. A stale roster (someone
     was added or left as this was sealed) is answered with the fresh one
     (409 'roster'), and the client seals once more. A group takes nothing
     but the envelope. */
  let keys: Record<string, string> | null = null;
  if (enc === 3) {
    const raw = data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys) ? bodyOf(data.keys) : null;
    if (!raw) return json({ ok: false, error: 'Bad request.' }, 400);
    keys = {};
    for (const h of Object.keys(raw)) {
      const v = raw[h];
      if (!/^[0-9a-f]{64}$/.test(h) || typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(v)) return json({ ok: false, error: 'Bad request.' }, 400);
      keys[h] = v;
    }
    const roster = thread ? await dmCurrentMembers(env, thread.id) : await dmPubkeysOf(env, [me, other]);
    if (!Dm.membersEqual(Object.keys(keys))(roster.map((m) => m.hash))) {
      return json({ ok: false, error: 'roster', members: roster }, 409);
    }
  } else if (kind === 1) {
    return json({ ok: false, error: 'This conversation needs the newer app. Reload and try again.' }, 400);
  }
  /* An optional media attachment: the client uploaded the ciphertext to R2
     first and passes its opaque key. A fresh object is claimed by its first
     message; an object already named by a message (a forward, 2026-09-13)
     may be named again ONLY by a member who can read it — the media GET's
     own rule — and gains one more reference. */
  let mediaKey: string | null = null, mediaSize: number | null = null;
  const rawMediaKey = String(data.media_key || '');
  if (rawMediaKey) {
    if (!/^dm\/[0-9a-f]{64}$/.test(rawMediaKey)) return json({ ok: false, error: 'Bad request.' }, 400);
    const mrow = await env.DB.prepare('SELECT size FROM dm_media WHERE key = ?1').bind(rawMediaKey).first<{ size: number }>();
    if (!mrow) return json({ ok: false, error: 'That attachment is not available.' }, 400);
    const refRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM dm_media_refs WHERE key = ?1').bind(rawMediaKey).first<{ n: number }>();
    if (refRow && refRow.n > 0 && !(await dmMediaReadable(env, me, rawMediaKey, now))) {
      return json({ ok: false, error: 'That attachment is not available.' }, 400);
    }
    mediaKey = rawMediaKey;
    mediaSize = mrow.size;
  }
  /* A pair's room is made on its first word. A held send must leave the
     recipient's world untouched: the thread's last-word fields stay as they
     were, so nothing bumps, nothing rings. */
  if (!thread) thread = await ensurePairThread(env, me, other, now, { bump: !held, sender: me });
  /* A fresh message counts down from the unopened backstop; when a recipient
     opens it, handleDmThread rebases the clock to opened_at + the
     conversation ttl (so "expires N days after opening"). */
  const msgExpires = now + dmBackstopSeconds(await getAppSettings(env));
  const msg = await env.DB.prepare(
    'INSERT INTO dms (thread_id, sender_hash, body, created_at, held, enc, expires_at, media_key, media_size) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id'
  ).bind(thread.id, me, body, now, held, enc, msgExpires, mediaKey, mediaSize).first<{ id: number }>() as { id: number };
  /* What hangs off the word, in one batch: each member's sealed key, the
     object's reference, the thread's last-word fields (never for a held
     send), and the sender's own read stamp — what you just said is read by
     you. msgs is recomputed, never incremented, over the visible words alone. */
  const stmts: D1PreparedStatement[] = [];
  if (keys) for (const h of Object.keys(keys)) stmts.push(env.DB.prepare('INSERT OR REPLACE INTO dm_keys (msg_id, hash, sealed) VALUES (?1, ?2, ?3)').bind(msg.id, h, keys[h]));
  if (mediaKey) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO dm_media_refs (key, msg_id) VALUES (?1, ?2)').bind(mediaKey, msg.id));
  if (!held) {
    stmts.push(env.DB.prepare(
      'UPDATE dm_threads SET msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), last_at = ?2, last_sender = ?3 WHERE id = ?1'
    ).bind(thread.id, now, me));
  }
  stmts.push(env.DB.prepare('UPDATE dm_members SET read_at = ?2 WHERE thread_id = ?1 AND hash = ?3').bind(thread.id, now, me));
  await env.DB.batch(stmts);
  if (!held) {
    /* Instant delivery to every other member's own connections over their
       private user:<hash> scopes — an open thread drops it in, a badge rings
       — plus the native Web Push nudge. The sealed keys ride the frame (a
       member sees the others' blobs: ciphertext to keys they do not hold).
       A HELD message does none of this: the recipient must never learn of a
       shadow-blocked send. */
    const recipients = await dmRecipients(env, thread.id, me);
    if (ctx && recipients.length) {
      publishLive(env, ctx, { v: 1, t: 'dm', scopes: recipients.map((h) => 'user:' + h), from: me, thread_id: thread.id,
        message: { id: msg.id, sender_hash: me, body: body, created_at: now, enc: enc, media_key: mediaKey, keys: keys || undefined } });
    }
    /* The quiet bell: a member who has THIS conversation on screen right now
       (their live socket carries dmview:t<id> — a sub the client holds only
       while the thread is mounted, on a socket that closes the moment the
       tab hides) sees the word land in front of their eyes via the live push
       above, so neither the notification row nor the OS push fires for
       them. A bundle from before 2026-09-13 still claims dmview:<me> on a
       pair, honoured one deploy. Any doubt — hub error, no socket — rings
       the bell as before. */
    let viewing: string[] = [];
    if (ctx && env.HUB && recipients.length) {
      viewing = await hubViewersOf(env, 't' + thread.id, recipients);
      if (kind === 0 && other && viewing.indexOf(other) === -1 && (await hubDmViewing(env, other, me))) viewing.push(other);
    }
    const away = recipients.filter((h) => viewing.indexOf(h) === -1);
    /* A DM also lands in each absent member's notifications list (the inbox
       badge is not the only place it should show) — one coalesced bell per
       conversation. */
    for (const h of away) await notifyDm(env, h, me, thread.id);
    /* Native push nudge, DEFERRED (like the reply/mention/wall paths) so a
       slow push service never delays the sender's response — only to those
       who have not turned DM notifications off ("the bell only — messages
       still arrive"); a push is the loudest bell, so it honors that opt-out
       too. Carries NO message content (DMs are E2E; the server never sees the
       plaintext), and opens the conversation by its id. */
    if (away.length) {
      const pushDm = async () => {
        const prefs = await notifyPrefsFor(env, away);
        const want = away.filter((h) => notifyEnabled(prefs[h], 'dm'));
        if (want.length) await deliverPush(env, want, { kind: 'dm', title: 'New message', body: 'You have a new message', url: '/messages.html?t=' + thread.id });
      };
      if (ctx) ctx.waitUntil(pushDm()); else await pushDm();
    }
  }
  return json({ ok: true, id: msg.id, thread_id: thread.id, created_at: now }, 200);
}

/* Forward up to ten words at once (2026-09-13): the press-and-hold's
   "Forward" picks several conversations, and the client seals the SAME
   plaintext afresh for each target's members (a fresh content key per copy;
   the reply quote dropped; the small "Forwarded" mark inside the envelope —
   the server never learns a word was forwarded, nor from where). An
   attachment is NOT re-uploaded: each copy names the same object, allowed
   because the forwarder can read it, and the object lives until its last
   reference goes. One gate for the batch — throttle, ban, Turnstile — then
   the delivery core per word, each answered on its own. */
async function handleDmForward(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many messages at once. Wait a minute and try again.' });
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const items = listOf(data.items);
  if (!items.length || items.length > 10) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const results: Body[] = [];
  for (const item of items) {
    const r = await deliverDmWord(env, ctx, me, bodyOf(item), now);
    let j: unknown = null;
    try { j = await r.json(); } catch { j = null; }
    results.push(Object.assign({ status: r.status }, j ? bodyOf(j) : { ok: false, error: 'Bad request.' }));
  }
  return json({ ok: true, results }, 200);
}

/* The roster: a conversation's current members and their published keys —
   what a sender seals to — read without a mark (opening a thread marks it
   read and starts clocks; a picker and a re-seal must not). An unmade pair's
   room answers with its two. A stranger's ask is "no such conversation". */
async function handleDmRoster(request: Request, env: Env) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const found = await dmThreadFor(env, me, data);
  if (!found) return json({ ok: false, error: 'No such conversation.' }, 404);
  const members = found.thread ? await dmCurrentMembers(env, found.thread.id) : await dmPubkeysOf(env, [me, found.other]);
  const roster: DmRosterPayload = { ok: true, thread_id: found.thread ? found.thread.id : null, kind: found.thread ? (Number(found.thread.kind) || 0) : 0,
    name: (found.thread && found.thread.name) || null, members };
  return json(roster, 200);
}

/* A group is born (2026-09-13): the creator and the members they named, each
   with a published key and none who block the creator (dmEligible — one
   generic refusal for both), at most Domain.Dm.maxMembers in all; the first
   word is the system line "X added Y and Z", which is what tells each new
   member of it (their bell, their inbox). Shared by /dm/groups and the fork
   /dm/members makes from a pair. */
async function createDmGroup(env: Env, ctx: ExecutionContext | undefined, me: string, wanted: string[], name: string | null, now: number) {
  const thread = await env.DB.prepare(
    'INSERT INTO dm_threads (kind, pair_key, name, created_at, created_by, last_at, last_sender, msgs) VALUES (1, NULL, ?1, ?2, ?3, ?2, ?3, 0) RETURNING id'
  ).bind(name, now, me).first<{ id: number }>() as { id: number };
  const stmts: D1PreparedStatement[] = [env.DB.prepare('INSERT OR IGNORE INTO dm_members (thread_id, hash, joined_at) VALUES (?1, ?2, ?3)').bind(thread.id, me, now)];
  for (const h of wanted) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO dm_members (thread_id, hash, joined_at, added_by) VALUES (?1, ?2, ?3, ?4)').bind(thread.id, h, now, me));
  await env.DB.batch(stmts);
  await sendSystemDmLine(env, thread.id, me, Dm.sysAddLine(wanted));
  await announceDmMembers(env, ctx, thread.id, me, wanted, []);
  return thread.id;
}

/* The roster changed: every current member's open thread (the newcomers'
   included) learns who came or went, with the newcomers' names and keys so
   the composer seals to them at once. */
async function announceDmMembers(env: Env, ctx: ExecutionContext | undefined, threadId: number, by: string, added: string[], left: string[]) {
  const rows = added.length ? (await dmMembersPayload(env, threadId)).filter((r) => added.indexOf(r.hash) !== -1) : [];
  const ev: HubEvent = { v: 1, t: 'dm-members', scopes: (await dmRecipients(env, threadId, by)).map((h) => 'user:' + h), from: by, thread_id: threadId, by,
    added: rows.map((r) => ({ hash: r.hash, nick: r.nick || null, avatar: r.avatar || null, assigned: displayName(r.hash), pubkey: r.pubkey || null, joined_at: r.joined_at,
      receipts: Prefs.receiptsOn(r.receipts_mode || 'auto') ? 1 : 0 })),
    left };
  if (!ev.scopes.length) return;
  if (ctx) publishLive(env, ctx, ev); else await publishUser(env, [ev]);
}

/* Start a group: `members` the hashes to bring in, an optional name. */
async function handleDmGroups(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many requests. Slow down.', block: true });
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const { ok: wanted, missing } = await dmEligible(env, me, data.members);
  if (!wanted.length && !missing.length) return json({ ok: false, error: 'Bad request.' }, 400);
  if (wanted.length + missing.length > Dm.maxMembers - 1) return json({ ok: false, error: 'A conversation holds at most ' + Dm.maxMembers + ' members.' }, 400);
  if (missing.length) return json({ ok: false, error: 'Some members cannot be added yet.', missing }, 400);
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const name = dmGroupName(data.name);
  const id = await createDmGroup(env, ctx, me, wanted, name, Math.floor(Date.now() / 1000));
  return json({ ok: true, thread_id: id, name }, 200);
}

/* Add members: to a group, in place (a member who left and is brought back
   starts afresh — no history, as the crypto has it); to a PAIR, by making a
   new group of the three or more (Snapchat's and WhatsApp's way — the pair
   and its private history stay as they were). Any current member may add;
   nobody owns the thread. */
async function handleDmMembers(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const threadId = Math.floor(Number(data.thread_id) || 0);
  if (threadId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const found = await dmThreadFor(env, me, { thread_id: threadId });
  if (!found || !found.thread) return json({ ok: false, error: 'No such conversation.' }, 404);
  const thread = found.thread;
  const kind = Number(thread.kind) || 0;
  const current = (await dmCurrentMembers(env, thread.id)).map((m) => m.hash);
  const asked = listOf(data.add).map((h) => String(h || '')).filter((h) => current.indexOf(h) === -1);
  const { ok: wanted, missing } = await dmEligible(env, me, asked);
  if (!wanted.length && !missing.length) return json({ ok: false, error: 'Bad request.' }, 400);
  if (current.length + wanted.length + missing.length > Dm.maxMembers) return json({ ok: false, error: 'A conversation holds at most ' + Dm.maxMembers + ' members.' }, 400);
  if (missing.length) return json({ ok: false, error: 'Some members cannot be added yet.', missing }, 400);
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  if (kind === 0) {
    /* A pair forks: the other and the newcomers, in a group of their own. */
    const id = await createDmGroup(env, ctx, me, [found.other].concat(wanted), null, now);
    return json({ ok: true, thread_id: id, forked: 1, added: wanted }, 200);
  }
  const stmts = wanted.map((h) => env.DB.prepare(
    'INSERT INTO dm_members (thread_id, hash, joined_at, added_by) VALUES (?1, ?2, ?3, ?4) ' +
    'ON CONFLICT(thread_id, hash) DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL, read_at = NULL, cleared_at = NULL, added_by = excluded.added_by'
  ).bind(thread.id, h, now, me));
  await env.DB.batch(stmts);
  await sendSystemDmLine(env, thread.id, me, Dm.sysAddLine(wanted));
  await announceDmMembers(env, ctx, thread.id, me, wanted, []);
  return json({ ok: true, thread_id: thread.id, forked: 0, added: wanted }, 200);
}

/* Leave a group: my seat is stamped and I see nothing further; the line "X
   left" is my last word in it. When nobody remains, the thread and all its
   words go — nobody owns it, nobody is left to. A pair cannot be left (delete
   it instead). */
async function handleDmLeave(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const found = await dmThreadFor(env, me, { thread_id: data.thread_id });
  if (!found || !found.thread) return json({ ok: false, error: 'No such conversation.' }, 404);
  const thread = found.thread;
  if (Number(thread.kind) !== 1) return json({ ok: false, error: 'A conversation with one person is deleted, not left.' }, 400);
  const now = Math.floor(Date.now() / 1000);
  await sendSystemDmLine(env, thread.id, me, Dm.sysLeaveLine, { quiet: true });
  await env.DB.prepare('UPDATE dm_members SET left_at = ?1 WHERE thread_id = ?2 AND hash = ?3').bind(now, thread.id, me).run();
  await announceDmMembers(env, ctx, thread.id, me, [], [me]);
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM dm_members WHERE thread_id = ?1 AND left_at IS NULL').bind(thread.id).first<{ n: number }>();
  let purged = false;
  if (!(left && left.n > 0)) {
    const media = await env.DB.prepare('SELECT id, media_key FROM dms WHERE thread_id = ?1 AND media_key IS NOT NULL').bind(thread.id).all<{ id: number; media_key: string }>();
    await releaseMediaRefs(env, media.results || []);
    for (const tbl of ['dm_keys', 'dm_reactions', 'dm_media_refs']) {
      await env.DB.prepare('DELETE FROM ' + tbl + ' WHERE msg_id IN (SELECT id FROM dms WHERE thread_id = ?1)').bind(thread.id).run();
    }
    await env.DB.prepare('DELETE FROM dms WHERE thread_id = ?1').bind(thread.id).run();
    await env.DB.prepare('DELETE FROM dm_members WHERE thread_id = ?1').bind(thread.id).run();
    await env.DB.prepare('DELETE FROM dm_threads WHERE id = ?1').bind(thread.id).run();
    purged = true;
  }
  return json({ ok: true, thread_id: thread.id, purged }, 200);
}

/* Name a group (any member; ≤ Domain.Dm.groupNameMax code points, the
   kernel's normalisation). Server-visible metadata by design: the inbox row,
   the bell's sentence and the ⓘ sheet all need it, and there is no per-thread
   key to seal it under. */
async function handleDmName(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const found = await dmThreadFor(env, me, { thread_id: data.thread_id });
  if (!found || !found.thread) return json({ ok: false, error: 'No such conversation.' }, 404);
  const thread = found.thread;
  if (Number(thread.kind) !== 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const name = dmGroupName(data.name);
  if (!name) return json({ ok: false, error: 'Bad request.' }, 400);
  await env.DB.prepare('UPDATE dm_threads SET name = ?1 WHERE id = ?2').bind(name, thread.id).run();
  await sendSystemDmLine(env, thread.id, me, Dm.sysNameLine(name), { quiet: true });
  const to = await dmRecipients(env, thread.id, me);
  if (ctx && to.length) publishLive(env, ctx, { v: 1, t: 'dm-name', scopes: to.map((h) => 'user:' + h), from: me, thread_id: thread.id, name, by: me });
  return json({ ok: true, thread_id: thread.id, name }, 200);
}

/* Inbox: my conversations by newest activity — a pair's other resolved with
   their nick and avatar, a group's name and up to four members for its
   collage (2026-09-13) — and the total unread count riding along so one call
   feeds both the list and the badge. */
async function handleDmThreads(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const now = Math.floor(Date.now() / 1000);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  /* Everything per viewer, from my own seat (a member who left has none):
     counts and last-activity over the words this reader may see (unheld or
     their own, uncleared, since they joined, UNEXPIRED, and in a group not
     from a sender they blocked); a thread whose every visible word has
     expired or is held reads as absent. */
  const otherOf = "replace(replace(t.pair_key, ?1 || '|', ''), '|' || ?1, '')";
  const inner =
    'SELECT t.id, t.id AS thread_id, t.kind, t.name, ' +
    'CASE WHEN t.kind = 0 THEN ' + otherOf + ' END AS other_hash, ' +
    'pr.nick, pr.avatar, ' +
    "(SELECT json_group_array(json_object('hash', x.hash, 'nick', x.nick, 'avatar', x.avatar)) FROM (" +
    'SELECT m2.hash, p2.nick, p2.avatar FROM dm_members m2 LEFT JOIN profiles p2 ON p2.hash = m2.hash ' +
    'WHERE m2.thread_id = t.id AND m2.left_at IS NULL AND m2.hash != ?1 ORDER BY m2.joined_at, m2.hash LIMIT ' + Dm.inboxAvatars + ') x) AS members_json, ' +
    '(SELECT COUNT(*) FROM dm_members m3 WHERE m3.thread_id = t.id AND m3.left_at IS NULL) AS member_count, ' +
    '(SELECT COUNT(*) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ') AS msgs, ' +
    '(SELECT MAX(m.created_at) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ') AS last_at, ' +
    dmUnreadCount(now) + ' AS unread ' +   // the count (2026-09-11); truthy exactly when the old flag was
    'FROM dm_threads t JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 AND mb.left_at IS NULL ' +
    'LEFT JOIN profiles pr ON t.kind = 0 AND pr.hash = ' + otherOf;
  const rows = await env.DB.prepare(
    'SELECT * FROM (' + inner + ') WHERE msgs > 0 ORDER BY last_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, DM_PER_PAGE, (p - 1) * DM_PER_PAGE).all<Omit<DmThreadsRow, 'members' | 'assigned'> & { members_json: string | null }>();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(unread), 0) AS unread FROM (' + inner + ') WHERE msgs > 0'   // unread_total counts WORDS now (2026-09-11), the same number /dm/unread returns
  ).bind(me).first<{ n: number; unread: number }>();
  const threads: DmThreadsRow[] = (rows.results || []).map(({ members_json, ...r }) => {
    let members: Body[] = [];
    try { members = listOf(JSON.parse(members_json || '[]')).map(bodyOf); } catch { members = []; }
    return Object.assign({}, r, {
      members: members.map((m) => ({ hash: String(m.hash || ''), nick: m.nick ? String(m.nick) : null,
        avatar: m.avatar ? String(m.avatar) : null, assigned: m.hash ? displayName(String(m.hash)) : null })),
      assigned: r.other_hash ? displayName(r.other_hash) : null,
    });
  });
  const inbox: DmThreadsPayload = { ok: true, threads, total: (totals && totals.n) || 0,
    unread_total: (totals && totals.unread) || 0, page: p, per: DM_PER_PAGE };
  return json(inbox, 200);
}

/* One conversation — by its id, or a pair's by its other (the door every
   "Message" button and older bell still uses; an unmade pair is an empty
   room) — paged by twenty like everything else, defaulting to the LAST page
   so it opens at its newest words. The members ride along with their keys.
   Opening marks it read with at most one write, none when nothing was unread. */
async function handleDmThread(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { data, key, me } = pre;
  const threadId = Math.floor(Number(data.thread_id) || 0);
  const withHash = String(data.with || '');
  if ((!threadId && !/^[0-9a-f]{64}$/.test(withHash))) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!threadId && me === withHash) return json({ ok: false, error: 'Bad request.' }, 400);
  const found = await dmThreadFor(env, me, { thread_id: threadId, with: withHash });
  if (!found) return json({ ok: false, error: 'No such conversation.' }, 404);
  const thread = found.thread, other = found.other;
  const now = Math.floor(Date.now() / 1000);
  const settings = await getAppSettings(env);
  const ttl = (thread && thread.ttl) || dmDefaultTtl(settings);
  const kind = thread ? (Number(thread.kind) || 0) : 0;
  const iBlocked = other ? await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2').bind(me, other).first() : null;
  /* The members, the departed included (their names and keys still open the
     words they sent), each with their published X25519 key so the client can
     seal to them and open what they sent (null until they have signed in once
     under the encrypted-inbox client; the client then blocks the send with a
     notice rather than falling back to plaintext). A read stamp is served
     only under the member's own receipts mode (reciprocal, as the dm-read
     frame); last_seen_at is the hub's stamp, absent for a member who chose
     appear-offline (the hub clears it) — serving it as-is IS the privacy
     rule. An unmade pair's room lists its two. */
  const memberRows = thread ? await dmMembersPayload(env, thread.id) : await dmPairRoomRows(env, me, other);
  const members = memberRows.map((r) => ({
    hash: r.hash, nick: r.nick || null, avatar: r.avatar || null, assigned: displayName(r.hash), pubkey: r.pubkey || null,
    joined_at: r.joined_at == null ? null : Number(r.joined_at), left_at: r.left_at == null ? null : Number(r.left_at),
    read_at: (r.hash === me || Prefs.receiptsOn(r.receipts_mode || 'auto')) && r.read_at != null ? Number(r.read_at) : null,
    receipts: Prefs.receiptsOn(r.receipts_mode || 'auto') ? 1 : 0,   // whether this member reports reads at all (their stamp is withheld when not), so a group's ✓✓ waits only for those who do
    last_seen: r.last_seen_at || null,
  }));
  /* A pair's `other`, kept one deploy for bundles from before the member model. */
  const otherRow = kind === 0 && other
    ? (members.find((m) => m.hash === other) || { hash: other, nick: null, avatar: null, assigned: displayName(other), pubkey: null, last_seen: null })
    : null;
  const threadOut = { id: thread ? thread.id : null, kind, name: (thread && thread.name) || null, ttl, members };
  if (!thread) {
    /* No words yet: an empty room, ready for the first message. */
    const room: DmThreadPayload = { ok: true, thread_id: null, ttl, thread: threadOut, other: otherRow,
      messages: [], total: 0, page: 1, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0, unread: 0, unread_from: null,
      notif_unread: await notifUnreadCount(env, me) };
    return json(room, 200);
  }
  /* The total and the pages are the viewer's own: held words count for their
     sender and for nobody else, a member sees only what arrived after their
     own clear stamp (a fresh start) and since they joined, and in a group a
     sender they blocked is silent to them. */
  const myCleared = Number(thread.cleared_at || 0);
  const floor = Math.max(myCleared, Number(thread.joined_at || 0) - 1);   // "> cleared AND >= joined" as one bound
  const from = ' FROM dms m JOIN dm_threads t ON t.id = m.thread_id JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 ' +
    'WHERE m.thread_id = ?2 AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now);
  const totRow = await env.DB.prepare('SELECT COUNT(*) AS n' + from).bind(me, thread.id).first<{ n: number }>();
  const total = (totRow && totRow.n) || 0;
  const lastPage = Math.max(1, Math.ceil(total / DM_PER_PAGE));
  /* A permalink into the conversation (a reaction's bell lands on the very
     message, 2026-09-12) arrives as find=<message id> and one indexed count
     places it on the right page — the topic view's own idiom. */
  const find = Math.floor(Number(data.find) || 0);
  let p = data.p == null ? lastPage : Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  if (find > 0 && data.p == null) {
    const pos = await env.DB.prepare('SELECT COUNT(*) AS n' + from + ' AND m.id < ?3').bind(me, thread.id, find).first<{ n: number }>();
    p = Math.floor(((pos && pos.n) || 0) / DM_PER_PAGE) + 1;
  }
  /* One query per page: the words, MY sealed key beside each (k.sealed —
     served to its member alone; the others' stay in the ledger), who saved
     it, and every reaction on it. */
  const msgs = await env.DB.prepare(
    'SELECT m.id, m.sender_hash, m.body, m.created_at, COALESCE(m.enc, 0) AS enc, COALESCE(m.saved, 0) AS saved, m.saved_by, m.media_key, m.media_size, ' +
    'COALESCE(m.media_expired, 0) AS media_expired, COALESCE(m.redacted, 0) AS redacted, m.edited_at, m.opened_at, m.expires_at, k.sealed, ' +
    "(SELECT json_group_array(json_object('hash', r.hash, 'emoji', r.emoji)) FROM dm_reactions r WHERE r.msg_id = m.id) AS reactions_json" +
    from.replace(' FROM dms m ', ' FROM dms m LEFT JOIN dm_keys k ON k.msg_id = m.id AND k.hash = ?1 ') + ' ORDER BY m.id LIMIT ?3 OFFSET ?4'
  ).bind(me, thread.id, DM_PER_PAGE, (p - 1) * DM_PER_PAGE).all<Omit<DmMessage, 'reactions'> & { reactions_json: string | null }>();
  /* Per-message reactions, one per member (dm_reactions since 0016), told as
     the ledger holds them; for a pair, react_me / react_other and the
     2026-08-03 heart's liked_* fields are derived — kept one deploy for
     clients cached before the member model. */
  const messages: DmMessage[] = (msgs.results || []).map(({ reactions_json, ...m }) => {
    let reactions: DmReaction[] = [];
    try {
      reactions = listOf(JSON.parse(reactions_json || '[]')).map(bodyOf)
        .filter((r) => r.emoji).map((r) => ({ hash: String(r.hash), emoji: String(r.emoji) }));
    } catch { reactions = []; }
    const out: DmMessage = Object.assign({}, m, { reactions });
    if (kind === 0) {
      out.react_me = String((reactions.find((r) => r.hash === me) || { emoji: '' }).emoji || '');
      out.react_other = String((reactions.find((r) => r.hash !== me) || { emoji: '' }).emoji || '');
      out.liked_me = out.react_me ? 1 : 0;
      out.liked_other = out.react_other ? 1 : 0;
    }
    return out;
  });
  /* What this reader has not read yet, told BEFORE this open marks it read
     (2026-09-11): the count for the jump button's badge, and the first unread
     word's id, above which the client stands its "N unread messages" line.
     Held, cleared, pre-joining and expired words never count, nor — in a
     group — a blocked sender's. */
  const myReadAt = Number(thread.read_at || 0);
  const unreadRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n, MIN(m.id) AS first_id FROM dms m WHERE m.thread_id = ?2 AND COALESCE(m.held, 0) = 0 AND m.sender_hash != ?1 ' +
    'AND m.created_at > ?3 AND m.created_at > ?4 AND (?5 = 0 OR NOT EXISTS (SELECT 1 FROM dm_blocks bk WHERE bk.owner_hash = ?1 AND bk.blocked_hash = m.sender_hash)) AND ' + dmLive(now)
  ).bind(me, thread.id, myReadAt, floor, kind).first<{ n: number; first_id: number | null }>();
  /* One conditional write: only when a visible word from someone else is
     newer than my stamp. Held, cleared and pre-joining words never trigger it. */
  await env.DB.prepare(
    'UPDATE dm_members SET read_at = ?2 WHERE thread_id = ?3 AND hash = ?1 AND EXISTS(' +
    'SELECT 1 FROM dms m WHERE m.thread_id = ?3 AND COALESCE(m.held, 0) = 0 AND m.sender_hash != ?1 ' +
    'AND m.created_at > COALESCE(dm_members.read_at, 0) AND m.created_at > ?4)'
  ).bind(me, now, thread.id, floor).run();
  /* Opening the conversation READS its bells (2026-09-12): every unread
     notification this conversation rang me — a message, a reaction to my
     word, a missed call — however I got here, from the bell or on my own; a
     row from before 0016 (no thread on it) is matched by the pair's other.
     The fresh count rides the payload so the client's badge tells the truth
     at once. */
  await env.DB.prepare(
    "UPDATE notifications SET read_at = ?3 WHERE recipient_hash = ?1 AND kind IN ('dm','dm-react','call') AND (topic_id = ?2 OR (topic_id = 0 AND actor_hash = ?4)) AND read_at IS NULL"
  ).bind(me, thread.id, now, other || '').run();
  /* Start the disappearing-message clock. The messages this viewer is a
     recipient of, and is opening for the first time, get opened_at = now and a
     fresh expires_at = now + the conversation ttl, overriding the unopened
     backstop — the FIRST open by any recipient starts everyone's clock.
     Idempotent (opened_at IS NULL); saved messages are left alone so a save
     survives an open. This is why a message "expires N days after opening". */
  const openRes = await env.DB.prepare(
    'UPDATE dms SET opened_at = ?2, expires_at = ?2 + ?5 WHERE thread_id = ?3 AND sender_hash != ?1 ' +
    'AND COALESCE(held, 0) = 0 AND opened_at IS NULL AND COALESCE(saved, 0) = 0 AND created_at > ?4'
  ).bind(me, now, thread.id, floor, ttl).run();
  /* Read receipt: if I just opened words others sent, tell every other member
     (their user:<hash> sockets) that everything up to `now` has been seen, so
     the senders' open threads flip those bubbles — ✓✓ once every other member
     has — live. One event per open. */
  if (openRes && openRes.meta && openRes.meta.changes > 0) {
    /* Reciprocal read receipts: a reader who set receipts to "off" sends none
       (and, client-side, sees none), so we only emit when their mode allows it. */
    const myPref = await env.DB.prepare('SELECT receipts_mode FROM profiles WHERE hash = ?1').bind(me).first<{ receipts_mode: string | null }>();
    if (Prefs.receiptsOn((myPref && myPref.receipts_mode) || 'auto')) {
      const to = await dmRecipients(env, thread.id, me);
      if (to.length) {
        const ev: HubEvent = { v: 1, t: 'dm-read', scopes: to.map((h) => 'user:' + h), thread_id: thread.id, reader: me, at: now };
        if (ctx) publishLive(env, ctx, ev); else await publishUser(env, [ev]);
      }
    }
  }
  const payload: DmThreadPayload = { ok: true, thread_id: thread.id, ttl, thread: threadOut, other: otherRow,
    messages: messages, total: total, page: p, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0,
    unread: (unreadRow && unreadRow.n) || 0, unread_from: (unreadRow && unreadRow.first_id) || null,
    notif_unread: await notifUnreadCount(env, me) };
  return json(payload, 200);
}

/* The badge count: unread WORDS across every thread (2026-09-11), one summed
   pass of the same fragment the inbox rows carry — the tab's badge and the row
   badges now add up, and "3" means three messages waiting, not three threads.
   The client asks at most once per ninety seconds, so this stays cheap. */
async function handleDmUnread(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'READ_LIMIT' });
  if (pre instanceof Response) return pre;
  const { ip, me } = pre;
  /* The reliable catch for a logged-in reader: this poll fires on every keyed
     page load, so a lock or IP ban logs them out on their next page turn. */
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(' + dmUnreadCount(now) + '), 0) AS n FROM dm_threads t JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 AND mb.left_at IS NULL'
  ).bind(me).first<{ n: number }>();
  return json({ ok: true, unread: (row && row.n) || 0 }, 200);
}

/* The batched inbox presence check: given a list of correspondent hashes, which
   are online right now (honouring appear-offline)? One keyed request per inbox
   load, answered by the BoardHub DO's live socket set — no polling. */
async function handleDmPresence(request: Request, env: Env) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const hashes = listOf(data.hashes)
    .filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)).slice(0, 50);
  if (!hashes.length || !env.HUB) return json({ ok: true, online: [], seen: {} }, 200);
  const on = await hubPresenceOf(env, hashes);
  /* "Last seen" for those not online now: the hub's stamp, absent for a member
     who chose appear-offline (the hub clears it), so serving it as-is IS the
     privacy rule; an online member's stamp is not served (they are Online). */
  const seen: Record<string, number> = {};
  const rows = await env.DB.prepare(
    'SELECT hash, last_seen_at FROM profiles WHERE last_seen_at IS NOT NULL AND hash IN (' + inList(hashes.length, 1) + ')'
  ).bind(...hashes).all<{ hash: string; last_seen_at: number }>();
  for (const r of (rows.results || [])) if (on.indexOf(r.hash) === -1) seen[r.hash] = Number(r.last_seen_at);
  return json({ ok: true, online: on, seen }, 200);
}

/* The blocked-members roster for the settings gear: the members this reader has
   blocked, so they can be seen and unblocked from one place (unblocking reuses
   the existing /dm/block with blocked:false). Keyed + private. */
async function handleDmBlocked(request: Request, env: Env) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const rows = await env.DB.prepare(
    'SELECT b.blocked_hash AS hash, pr.nick AS nick, pr.avatar AS avatar FROM dm_blocks b ' +
    'LEFT JOIN profiles pr ON pr.hash = b.blocked_hash WHERE b.owner_hash = ?1 ORDER BY b.created_at DESC LIMIT 200'
  ).bind(me).all<{ hash: string; nick: string | null; avatar: string | null }>();
  const blocked = (rows.results || []).map((r) => ({ hash: r.hash, nick: r.nick || null, avatar: r.avatar || null, assigned: displayName(r.hash) }));
  return json({ ok: true, blocked }, 200);
}

/* Set the per-conversation disappearing-message lifetime. Any member may
   change it and the LAST write wins for everyone — it is a single column.
   Changing it rebases every opened, unsaved message to the new lifetime, and
   the other members are told live so their headers update. A pair's room is
   made if it does not exist yet (a still-empty room, invisible in the inbox),
   so the choice sticks before the first message is even sent. */
async function handleDmTtl(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { ip, data, me } = pre;
  const threadId = Math.floor(Number(data.thread_id) || 0);
  const other = String(data.with || '');
  const ttl = Math.floor(Number(data.ttl) || 0);
  if (DM_TTLS.indexOf(ttl) === -1 || (!threadId && !/^[0-9a-f]{64}$/.test(other))) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!threadId && me === other) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const found = await dmThreadFor(env, me, { thread_id: threadId, with: other });
  if (!found) return json({ ok: false, error: 'No such conversation.' }, 404);
  const now = Math.floor(Date.now() / 1000);
  const thread = found.thread || await ensurePairThread(env, me, found.other, now, { bump: false, sender: me });
  await env.DB.prepare('UPDATE dm_threads SET ttl = ?1 WHERE id = ?2').bind(ttl, thread.id).run();
  await env.DB.prepare(
    'UPDATE dms SET expires_at = opened_at + ?1 WHERE thread_id = ?2 AND opened_at IS NOT NULL AND COALESCE(saved, 0) = 0'
  ).bind(ttl, thread.id).run();
  const to = await dmRecipients(env, thread.id, me);
  if (ctx && to.length) publishLive(env, ctx, { v: 1, t: 'dm-ttl', scopes: to.map((h) => 'user:' + h), from: me, thread_id: thread.id, ttl });
  return json({ ok: true, ttl }, 200);
}

/* Save or unsave one message (any member). A saved message is exempt from
   auto-expiry for EVERYONE (expires_at NULL), so a save keeps it for all —
   which is how expiry stays identical for all — and the saver is named
   (saved_by, Snapchat's "saved by"). Unsaving resumes the clock. The message
   id alone names it: membership is checked through its thread. */
async function handleDmSave(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { ip, data, me } = pre;
  const id = Math.floor(Number(data.id) || 0);
  const saved = data.saved ? 1 : 0;
  if (id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  /* The message must stand in a thread I am a current member of; then any member may act. */
  const row = await env.DB.prepare(
    'SELECT m.id, m.thread_id, m.created_at, m.opened_at, t.ttl FROM dms m JOIN dm_threads t ON t.id = m.thread_id ' +
    'JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?2 AND mb.left_at IS NULL WHERE m.id = ?1'
  ).bind(id, me).first<{ id: number; thread_id: number; created_at: number; opened_at: number | null; ttl: number | null }>();
  if (!row) return json({ ok: false, error: 'No such message.' }, 404);
  const settings = await getAppSettings(env);
  const ttl = Number(row.ttl) || dmDefaultTtl(settings);
  const expires = saved ? null : (row.opened_at ? (Number(row.opened_at) + ttl) : (Number(row.created_at) + dmBackstopSeconds(settings)));
  await env.DB.prepare('UPDATE dms SET saved = ?1, saved_by = ?4, expires_at = ?2 WHERE id = ?3').bind(saved, expires, id, saved ? me : null).run();
  /* A save is for all: every other member's open thread lights the bubble
     live (the Snapchat convention — a kept message looks kept to everyone). */
  const to = await dmRecipients(env, row.thread_id, me);
  if (ctx && to.length) publishLive(env, ctx, { v: 1, t: 'dm-save', scopes: to.map((h) => 'user:' + h), from: me, thread_id: row.thread_id, message: { id, saved, by: me } });
  return json({ ok: true, saved, saved_by: saved ? me : null, expires_at: expires }, 200);
}

/* React to ONE message with a single emoji — the press-and-hold picker's
   quick six, any one standard emoji, or one of our own custom-pack :tokens:
   — or withdraw your reaction with an empty string. Any member may react to
   any message they can SEE — a thread they are in, not held from them, not
   expired, not redacted, not behind their own delete-conversation stamp,
   since they joined. One reaction per MEMBER per message (dm_reactions since
   0016), metadata beside opened_at, validated by the kernel through
   dmReaction (never an inline regex here); the plaintext stays sealed. Every
   other member's open thread hears it live. The 2026-08-03 heart rides the
   same road: `/dm/like {like}` is this handler with ❤️ or nothing, kept one
   deploy for cached clients. */
async function handleDmReact(request: Request, env: Env, ctx: ExecutionContext) {
  let data: Body;
  try { data = await request.json<Body>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'POST_LIMIT', ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const id = Math.floor(Number(data.id) || 0);
  const raw = data.emoji != null ? String(data.emoji) : (data.like ? '❤️' : '');
  const emoji: string | null = raw.trim() ? dmReaction(raw) : '';
  if (!key || id < 1 || emoji === null) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT m.id, m.thread_id, m.sender_hash, COALESCE(m.redacted, 0) AS redacted, t.kind FROM dms m JOIN dm_threads t ON t.id = m.thread_id ' +
    'JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 AND mb.left_at IS NULL ' +
    'WHERE m.id = ?2 AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now)
  ).bind(me, id).first<{ id: number; thread_id: number; sender_hash: string; redacted: number; kind: number }>();
  if (!row) return json({ ok: false, error: 'No such message.' }, 404);
  if (row.redacted) return json({ ok: false, error: 'That message was deleted.' }, 409);
  if (emoji) {
    await env.DB.prepare(
      'INSERT INTO dm_reactions (msg_id, hash, emoji, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(msg_id, hash) DO UPDATE SET emoji = ?3, created_at = ?4'
    ).bind(id, me, emoji, now).run();
  } else {
    await env.DB.prepare('DELETE FROM dm_reactions WHERE msg_id = ?1 AND hash = ?2').bind(id, me).run();
  }
  const to = await dmRecipients(env, row.thread_id, me);
  if (ctx && to.length) publishLive(env, ctx, { v: 1, t: 'dm-react', scopes: to.map((h) => 'user:' + h), from: me, thread_id: row.thread_id, message: { id, emoji, by: me } });
  /* A reaction to ANOTHER's word rings their bell (2026-09-12): "X reacted to
     your message", landing on the message. Reacting to my own word rings
     nothing; a withdraw takes an unheard bell back. Coalesced like every bell
     here, keyed on the conversation. */
  if (row.sender_hash !== me) {
    const bell = { to: row.sender_hash, from: me, kind: 'dm-react', topicId: Number(row.thread_id), commentId: id };
    if (emoji) {
      /* The quiet bell (the send's rule): a reaction to a word its author has
         on screen lands on the pill in front of their eyes — no bell. */
      let onScreen = false;
      if (env.HUB) {
        onScreen = (await hubViewersOf(env, 't' + row.thread_id, [String(row.sender_hash)])).length > 0;
        if (!onScreen && Number(row.kind) === 0) onScreen = await hubDmViewing(env, String(row.sender_hash), me);
      }
      if (!onScreen) { const ring = notifyReact(env, bell); if (ctx) ctx.waitUntil(ring); else await ring; }
    } else await retractReactNotif(env, bell);
  }
  return json({ ok: true, id, emoji }, 200);
}

/* "I watched it arrive": the open thread acknowledges a live-delivered message
   so the read stamp, the disappearing clock, the sender's Seen receipt, and any
   already-rung dm notification settle exactly as a thread (re)load would set
   them — without refetching the thread. The same three writes handleDmThread
   makes on open, kept in step with it. */
async function handleDmSeen(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const found = await dmThreadFor(env, me, data);
  if (!found || !found.thread) return json({ ok: true }, 200);
  const thread = found.thread, other = found.other;
  const now = Math.floor(Date.now() / 1000);
  const settings = await getAppSettings(env);
  const ttl = thread.ttl || dmDefaultTtl(settings);
  const floor = Math.max(Number(thread.cleared_at || 0), Number(thread.joined_at || 0) - 1);
  await env.DB.prepare(
    'UPDATE dm_members SET read_at = ?2 WHERE thread_id = ?3 AND hash = ?1 AND EXISTS(' +
    'SELECT 1 FROM dms m WHERE m.thread_id = ?3 AND COALESCE(m.held, 0) = 0 AND m.sender_hash != ?1 ' +
    'AND m.created_at > COALESCE(dm_members.read_at, 0) AND m.created_at > ?4)'
  ).bind(me, now, thread.id, floor).run();
  const openRes = await env.DB.prepare(
    'UPDATE dms SET opened_at = ?2, expires_at = ?2 + ?5 WHERE thread_id = ?3 AND sender_hash != ?1 ' +
    'AND COALESCE(held, 0) = 0 AND opened_at IS NULL AND COALESCE(saved, 0) = 0 AND created_at > ?4'
  ).bind(me, now, thread.id, floor, ttl).run();
  if (openRes && openRes.meta && openRes.meta.changes > 0) {
    const myPref = await env.DB.prepare('SELECT receipts_mode FROM profiles WHERE hash = ?1').bind(me).first<{ receipts_mode: string | null }>();
    if (Prefs.receiptsOn((myPref && myPref.receipts_mode) || 'auto')) {
      const to = await dmRecipients(env, thread.id, me);
      if (to.length) {
        const ev: HubEvent = { v: 1, t: 'dm-read', scopes: to.map((h) => 'user:' + h), thread_id: thread.id, reader: me, at: now };
        if (ctx) publishLive(env, ctx, ev); else await publishUser(env, [ev]);
      }
    }
  }
  /* Belt for the race where the bell rang in the instant before the on-screen
     sub registered: reading the words on screen reads the notification too —
     every bell this conversation rang (a message, a reaction, a missed call),
     and the fresh count goes back so the badge follows at once. */
  await env.DB.prepare(
    "UPDATE notifications SET read_at = ?3 WHERE recipient_hash = ?1 AND kind IN ('dm','dm-react','call') AND (topic_id = ?2 OR (topic_id = 0 AND actor_hash = ?4)) AND read_at IS NULL"
  ).bind(me, thread.id, now, other || '').run();
  return json({ ok: true, notif_unread: await notifUnreadCount(env, me) }, 200);
}

/* Edit one of your OWN messages. DMs are end-to-end encrypted, so the server is
   blind: the client re-seals the new plaintext — under the SAME content key
   for a sealed envelope, so every member's key still opens it; to the pair
   secret for an E1 word — and sends the fresh ciphertext, which simply
   replaces the stored body; edited_at is stamped so everyone shows an
   "(edited)" marker. Everything else — the expiry clock, opened_at, saved, the
   sealed keys, any media pointer — is untouched. Only the sender may edit,
   only a live (unexpired), un-redacted, non-system message. */
async function handleDmEdit(request: Request, env: Env, ctx: ExecutionContext) {
  let data: Body;
  try { data = await request.json<Body>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'POST_LIMIT', ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many edits at once. Wait a minute and try again.' }, 429);
  const key = String(data.key || '');
  const id = Math.floor(Number(data.id) || 0);
  if (!key || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const enc = (data.enc === 3 || data.enc === '3') ? 3 : ((data.enc === 1 || data.enc === true) ? 1 : 0);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The message is empty.' }, 400);
  if (body.length > (enc ? DM_ENC_MAX : MAX_BODY)) return json({ ok: false, error: 'The message is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const now = Math.floor(Date.now() / 1000);
  /* Mine, in a thread I am still in, still live, not redacted, not a system notice. */
  const row = await env.DB.prepare(
    'SELECT m.id, m.thread_id, COALESCE(m.enc, 0) AS enc, COALESCE(m.redacted, 0) AS redacted, m.expires_at ' +
    'FROM dms m JOIN dm_threads t ON t.id = m.thread_id JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?2 AND mb.left_at IS NULL ' +
    'WHERE m.id = ?1 AND m.sender_hash = ?2'
  ).bind(id, me).first<{ id: number; thread_id: number; enc: number; redacted: number; expires_at: number | null }>();
  if (!row) return json({ ok: false, error: 'No such message.' }, 404);
  if (row.redacted) return json({ ok: false, error: 'That message was deleted.' }, 409);
  if (Number(row.enc) === 2) return json({ ok: false, error: 'That message cannot be edited.' }, 403);
  if (row.expires_at != null && Number(row.expires_at) <= now) return json({ ok: false, error: 'That message has expired.' }, 410);
  await env.DB.prepare('UPDATE dms SET body = ?1, enc = ?2, edited_at = ?3 WHERE id = ?4').bind(body, enc, now, id).run();
  /* Push the new ciphertext to every other member's open thread so their
     bubble re-renders (decrypts) live and shows "(edited)". */
  const to = await dmRecipients(env, row.thread_id, me);
  if (ctx && to.length) publishLive(env, ctx, { v: 1, t: 'dm-edit', scopes: to.map((h) => 'user:' + h), from: me, thread_id: row.thread_id,
    message: { id, body, enc, edited_at: now } });
  return json({ ok: true, id, edited_at: now }, 200);
}

/* Delete (redact) one of your OWN messages. Not a hard delete: the ciphertext
   body and any media are cleared and a redacted flag is set, but the row is KEPT
   with its ORIGINAL expires_at, so a "<redacted>" placeholder stands where the
   message was until the moment it would have disappeared anyway — then the
   ordinary sweep removes it. Only the sender may redact, and only once. */
async function handleDmRedact(request: Request, env: Env, ctx: ExecutionContext) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many requests. Wait a minute and try again.' });
  if (pre instanceof Response) return pre;
  const { ip, data, me } = pre;
  const id = Math.floor(Number(data.id) || 0);
  if (id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const row = await env.DB.prepare(
    'SELECT m.id, m.thread_id, m.media_key, COALESCE(m.redacted, 0) AS redacted ' +
    'FROM dms m JOIN dm_threads t ON t.id = m.thread_id JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?2 AND mb.left_at IS NULL ' +
    'WHERE m.id = ?1 AND m.sender_hash = ?2'
  ).bind(id, me).first<{ id: number; thread_id: number; media_key: string | null; redacted: number }>();
  if (!row) return json({ ok: false, error: 'No such message.' }, 404);
  if (row.redacted) return json({ ok: true, id, redacted: true }, 200);   // already gone; idempotent
  /* Let go of the object at once (D1 can't cascade to R2): this word's
     reference goes, and the object with it unless a forward elsewhere still
     names it; the byte counter self-heals on the next hourly sweep, exactly
     as conversation-delete does. The sealed keys go too — nothing is left
     to open. */
  if (row.media_key) await releaseMediaRefs(env, [{ id: row.id, media_key: row.media_key }]);
  await env.DB.prepare(
    "UPDATE dms SET redacted = 1, body = '', enc = 0, media_key = NULL, media_size = NULL WHERE id = ?1"
  ).bind(id).run();
  await env.DB.prepare('DELETE FROM dm_keys WHERE msg_id = ?1').bind(id).run();
  const to = await dmRecipients(env, row.thread_id, me);
  if (ctx && to.length) publishLive(env, ctx, { v: 1, t: 'dm-redact', scopes: to.map((h) => 'user:' + h), from: me, thread_id: row.thread_id,
    message: { id } });
  return json({ ok: true, id, redacted: true }, 200);
}

/* Delete a set of media objects from R2 and their dm_media rows. R2 delete takes
   up to 1000 keys per call; the D1 delete is chunked to stay well inside the
   invocation's 1,000 binding calls (the 50 cap is for external fetches). Keys
   are opaque server-minted ids. */
async function handleDmMediaUpload(request: Request, env: Env) {
  if (!env.MEDIA) return json({ ok: false, error: 'Media storage is not available.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'POST_LIMIT', ip))) return json({ ok: false, error: 'Too many uploads at once. Wait a minute.' }, 429);
  const settings = await getAppSettings(env);
  if (settings.media_enabled !== '1') return json({ ok: false, error: 'Media sharing is turned off.' }, 403);
  /* The bytes are E2E ciphertext, so the server can never know the KIND — the
     enforceable wall is the largest per-kind cap the DM context allows (plus a
     small ciphertext allowance); per-kind DM limits are client-side advisory,
     served via /config. An empty DM kinds mask turns attachments off. */
  const dmKinds = mediaKindsFor(settings, 'dm');
  if (!dmKinds.length) return json({ ok: false, error: 'Media sharing is turned off.' }, 403);
  const maxBytes = mediaMaxAcross(settings, dmKinds, 'dm') + 4096;
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared && declared > maxBytes + 8192) return json({ ok: false, error: 'That file is too large.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  if (!(await isEstablished(env, me))) {
    return json({ ok: false, error: 'Attachments unlock after your first post or profile save.' }, 403);
  }
  const file = form.get('file');
  /* a FormData value is a string or a File; only a File carries the bytes */
  if (!file || typeof file === 'string') return json({ ok: false, error: 'No file.' }, 400);
  if (file.size > maxBytes) return json({ ok: false, error: 'That file is too large.' }, 413);
  /* LIVE byte accounting at upload time — the sweep-maintained counter is up to
     an hour stale, which a flood laughs at. One cheap indexed SUM. */
  const usedRow = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM dm_media').first<{ total: number }>();
  const capDm = Number(settings.media_cap_dm_bytes) || Number(Media.defaults.capDmBytes);
  if (((usedRow && usedRow.total) || 0) + file.size > Math.floor(capDm * 0.90)) {
    return json({ ok: false, error: 'Media storage is full right now — older files clear soon, try again later.' }, 507);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > maxBytes) return json({ ok: false, error: 'That file is too large.' }, 413);
  const mediaKey = 'dm/' + randomHex(32);
  await env.MEDIA.put(mediaKey, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
  await env.DB.prepare('INSERT INTO dm_media (key, size, created_at, msg_id) VALUES (?1, ?2, ?3, NULL)')
    .bind(mediaKey, bytes.length, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true, media_key: mediaKey, size: bytes.length }, 200);
}

/* Stream one media object's ciphertext to a member who may read it: a live,
   unexpired, unredacted message naming it (a forward counts, 2026-09-13)
   stands in a thread they are a current member of, in their view. A stranger,
   a leaver, or an expired reference gets an indistinguishable 404. The bytes
   are opaque ciphertext, useless without the key the reader holds from the
   E2E message body. */
async function handleDmMediaGet(request: Request, env: Env) {
  if (!env.MEDIA) return json({ ok: false, error: 'Media storage is not available.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  /* the small JSON body first, so the limit is the member's (2026-09-17) */
  let data: Body;
  try { data = await request.json<Body>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await throttle(env, 'READ_LIMIT', ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const mediaKey = String(data.media_key || '');
  if (!key || !/^dm\/[0-9a-f]{64}$/.test(mediaKey)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const now = Math.floor(Date.now() / 1000);
  if (!(await dmMediaReadable(env, me, mediaKey, now))) return json({ ok: false, error: 'Not found.' }, 404);
  const obj = await env.MEDIA.get(mediaKey);
  if (!obj) return json({ ok: false, error: 'Not found.' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

/* Block and unblock, owner-side only. */
async function handleDmBlock(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT' });
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (data.blocked) {
    await env.DB.prepare('INSERT OR IGNORE INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(me, hash, Math.floor(Date.now() / 1000)).run();
  } else {
    /* Unblocking delivers the flood: every word held during the block is
       released with its original timestamp, and the thread's last-word
       fields catch up so the inbox and the badge finally ring. */
    const t = await env.DB.prepare('SELECT id FROM dm_threads WHERE pair_key = ?1').bind(dmPairKey(me, hash)).first();
    if (t) {
      const mn = await env.DB.prepare(
        'SELECT MIN(created_at) AS mn FROM dms WHERE thread_id = ?1 AND sender_hash = ?2 AND COALESCE(held, 0) = 1'
      ).bind(t.id, hash).first<{ mn: number | null }>();
      await env.DB.prepare(
        'UPDATE dms SET held = 0 WHERE thread_id = ?1 AND sender_hash = ?2 AND COALESCE(held, 0) = 1'
      ).bind(t.id, hash).run();
      /* The released words keep their original times, which may sit behind
         my read stamp; wind the stamp back so the delivery still rings. */
      if (mn && mn.mn != null) {
        await env.DB.prepare(
          'UPDATE dm_members SET read_at = ?2 WHERE thread_id = ?1 AND hash = ?3 AND read_at IS NOT NULL AND read_at >= ?2'
        ).bind(t.id, Number(mn.mn) - 1, me).run();
      }
      await env.DB.prepare(
        'UPDATE dm_threads SET ' +
        'msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
        'last_at = COALESCE((SELECT MAX(created_at) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), last_at), ' +
        'last_sender = COALESCE((SELECT sender_hash FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0 ORDER BY id DESC LIMIT 1), last_sender) ' +
        'WHERE id = ?1'
      ).bind(t.id).run();
    }
    await env.DB.prepare('DELETE FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2').bind(me, hash).run();
  }
  return json({ ok: true, blocked: !!data.blocked }, 200);
}

/* Delete a conversation from my side: a fresh start. My clear stamp hides every
   earlier word from me while the others keep their copies; when every current
   member has cleared (or nobody remains) and no word outlives the earliest
   clear, the thread and all its words — the keys, the reactions, the
   references — are purged so nothing persists. Keyed, not admin — you delete
   your own. */
async function handleDmDelete(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', block: true });
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const found = await dmThreadFor(env, me, data);
  if (!found) return json({ ok: false, error: 'Bad request.' }, 400);
  const thread = found.thread;
  if (!thread) return json({ ok: true, purged: false }, 200);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE dm_members SET cleared_at = ?1 WHERE thread_id = ?2 AND hash = ?3').bind(now, thread.id, me).run();
  /* Purge when every current member has cleared (or none remains) and no
     word outlives the earliest clear, so nobody can still see anything. Held
     words count too, erring toward never destroying a word its sender might
     still see. */
  const cur = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN cleared_at IS NULL THEN 1 ELSE 0 END), 0) AS open, COALESCE(MIN(cleared_at), 0) AS floor ' +
    'FROM dm_members WHERE thread_id = ?1 AND left_at IS NULL'
  ).bind(thread.id).first<{ n: number; open: number; floor: number }>();
  let purged = false;
  if (cur && Number(cur.open) === 0) {
    const surv = await env.DB.prepare('SELECT COUNT(*) AS n FROM dms WHERE thread_id = ?1 AND created_at > ?2')
      .bind(thread.id, Number(cur.n) > 0 ? Number(cur.floor) : now).first<{ n: number }>();
    if (!(surv && surv.n)) {
      /* The objects go by their references (a forward elsewhere keeps its copy);
         D1 can't cascade to R2. */
      const media = await env.DB.prepare('SELECT id, media_key FROM dms WHERE thread_id = ?1 AND media_key IS NOT NULL').bind(thread.id).all<{ id: number; media_key: string }>();
      await releaseMediaRefs(env, media.results || []);
      for (const tbl of ['dm_keys', 'dm_reactions', 'dm_media_refs']) {
        await env.DB.prepare('DELETE FROM ' + tbl + ' WHERE msg_id IN (SELECT id FROM dms WHERE thread_id = ?1)').bind(thread.id).run();
      }
      await env.DB.prepare('DELETE FROM dms WHERE thread_id = ?1').bind(thread.id).run();
      await env.DB.prepare('DELETE FROM dm_members WHERE thread_id = ?1').bind(thread.id).run();
      await env.DB.prepare('DELETE FROM dm_threads WHERE id = ?1').bind(thread.id).run();
      purged = true;
    }
  }
  return json({ ok: true, purged }, 200);
}

/* The autocomplete corpus: every hash that has ever appeared publicly, with
   its nick when one is set and its server-resolved `assigned` pseudonym (the web
   client derives the same value from the hash; native clients read it here).
   Public-by-construction data, cacheable. */
async function handleDmDirectory(request: Request, env: Env, url: URL) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
  /* Each member with the moment they first appeared (earliest live comment or
     profile creation), newest first, so the member list leads with the latest
     to join. The DM autocomplete ignores the order and the extra column. */
  const hidden = hiddenHashes(env);
  const rows = await env.DB.prepare(
    'SELECT u.hash, u.joined, pr.nick FROM (' +
    '  SELECT hash, MIN(joined) AS joined FROM (' +
    "    SELECT author_hash AS hash, MIN(created_at) AS joined FROM comments WHERE author_hash IS NOT NULL AND status != 'deleted' GROUP BY author_hash " +
    '    UNION ALL SELECT hash, created_at AS joined FROM profiles' +
    '  ) GROUP BY hash' +
    ') u LEFT JOIN profiles pr ON pr.hash = u.hash ' +
    /* The librarian and its machinery identities (merecat-named, which the
       nick guard denies to members) belong in no roster or picker — nor do the
       test and probe identities (hiddenHashes: the HIDDEN_HASHES var). */
    "WHERE u.hash != ?1 AND (pr.nick IS NULL OR pr.nick NOT LIKE 'merecat%') " +
    (hidden.length ? 'AND u.hash NOT IN (' + hidden.map((_h: string, i: number) => '?' + (i + 2)).join(', ') + ') ' : '') +
    /* A member is someone who has said or shown something: a nick, a live post
       (forum or feed), or a published DM key. A profiles row alone — what any
       keyed read leaves behind (registerMember) — is an identity that has
       acted, not a member to list; it once made the directory read 53 for six
       humans (P2-2, 2026-09-16). */
    "AND (COALESCE(pr.nick, '') != '' " +
    "  OR EXISTS (SELECT 1 FROM comments c2 WHERE c2.author_hash = u.hash AND c2.status != 'deleted') " +
    "  OR EXISTS (SELECT 1 FROM wall_posts w WHERE w.author_hash = u.hash AND w.status = 'live') " +
    '  OR EXISTS (SELECT 1 FROM dm_pubkeys k WHERE k.hash = u.hash)) ' +
    'ORDER BY u.joined DESC LIMIT 2000'
  ).bind(MERECAT_BOT.hash, ...hidden).all<{ hash: string; joined: number; nick: string | null }>();
  const users = (rows.results || []).map((r) => Object.assign({}, r,
    { assigned: r.hash ? displayName(r.hash) : null }));
  return json({ ok: true, users }, 200, cacheHeader(url));
}

/* Publish this member's X25519 public key for the end-to-end-encrypted inbox.
   The client derives its keypair deterministically from the secret behind its
   identity hash and sends only the PUBLIC half; the server stores it so a
   correspondent can encrypt to it. Keyed (proves ownership of the hash), and
   idempotent — keygen is deterministic, so re-publishing the same key is a
   no-op, and only the key's owner can ever change the row. The server never sees
   or can derive the private key from the hash it holds. */
async function handleDmPubkey(request: Request, env: Env) {
  let data: Body;
  try {
    data = await request.json<Body>();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'POST_LIMIT', ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const pubkey = String(data.pubkey || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  /* 32 raw bytes as unpadded base64url is exactly 43 chars over [A-Za-z0-9_-]. */
  if (!/^[A-Za-z0-9_-]{43}$/.test(pubkey)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO dm_pubkeys (hash, pubkey, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ' +
    'ON CONFLICT(hash) DO UPDATE SET pubkey = ?2, updated_at = ?3'
  ).bind(me, pubkey, now).run();
  return json({ ok: true }, 200);
}

export {
  announceDmMembers,
  createDmGroup,
  deliverDmWord,
  handleDmBlock,
  handleDmBlocked,
  handleDmDelete,
  handleDmDirectory,
  handleDmEdit,
  handleDmForward,
  handleDmGroups,
  handleDmLeave,
  handleDmMediaGet,
  handleDmMediaUpload,
  handleDmMembers,
  handleDmName,
  handleDmPresence,
  handleDmPubkey,
  handleDmReact,
  handleDmRedact,
  handleDmRoster,
  handleDmSave,
  handleDmSeen,
  handleDmSend,
  handleDmThread,
  handleDmThreads,
  handleDmTtl,
  handleDmUnread,
};
