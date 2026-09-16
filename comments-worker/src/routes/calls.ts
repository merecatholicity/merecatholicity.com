/* comments-worker/src/routes/calls.ts — the 1v1 voice calls: the stored offer that rings, the pending read, the answer, the end, the TURN credentials.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import * as CallK from '../../../purescript/output/Domain.Call/index.js';
import * as MaybeM from '../../../purescript/output/Data.Maybe/index.js';
import {
  MERECAT_BOT,
  getAppSettings,
  isEstablished,
  json,
  keyedGated,
  ringCall,
  recordCallEnd,
  publishUser,
} from '../lib.ts';

/* Place a call: validate, refuse the bot and self, and enforce dm_blocks with
   FAKE SUCCESS — a blocked caller gets {ok:true} and rings out to silence,
   byte-identical to calling someone who does not pick up (the standing
   indistinguishability law). Else the offer fans to the callee's live sockets
   and the missed-call bell/push rides waitUntil (a slow bell must never delay
   the ring). */
async function handleCallOffer(request: any, env: any, ctx: any) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const settings = await getAppSettings(env);
  if (settings.calls_enabled !== '1') return json({ ok: false, error: 'Calls are turned off.' }, 403);
  const to = String(data.to || '');
  const call = String(data.call || '');
  const sdp = String(data.sdp || '');
  if (!/^[0-9a-f]{64}$/.test(to) || !/^[0-9a-f]{16,64}$/.test(call)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (me === to) return json({ ok: false, error: 'That would be a soliloquy.' }, 400);
  if (to === MERECAT_BOT.hash) return json({ ok: false, error: 'merecat is a librarian — it has no ears. Mention @merecat in a post instead.' }, 400);
  if (!sdp || sdp.length > 32768 || sdp.slice(0, 2) !== 'v=') return json({ ok: false, error: 'Bad request.' }, 400);
  /* The media-upload fence, same reason: a drive-by throwaway key must not be
     able to ring members (or, via /call/turn, mint relay credentials). */
  if (!(await isEstablished(env, me))) return json({ ok: false, error: 'Calls unlock after your first post or profile save.' }, 403);
  const blockRow = await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2').bind(to, me).first();
  if (blockRow) return json({ ok: true }, 200);
  /* The callee's own Privacy switch (profiles.calls_ok = 0): the SAME fake
     success — "not taking calls" is indistinguishable from "did not pick up". */
  const prefRow = await env.DB.prepare('SELECT calls_ok FROM profiles WHERE hash = ?1').bind(to).first();
  if (prefRow && prefRow.calls_ok === 0) return json({ ok: true }, 200);
  /* The offer, kept for the ring: a callee whose app is closed is rung by a
     push and fetches it from here (/call/pending) when the app opens. */
  await env.DB.prepare(
    'INSERT OR REPLACE INTO calls_pending (call, from_hash, to_hash, sdp, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
  ).bind(call, me, to, sdp, Math.floor(Date.now() / 1000)).run();
  await publishUser(env, [{ v: 1, t: 'call-offer', scopes: ['user:' + to], from: me, call, sdp }]);
  if (ctx) ctx.waitUntil(ringCall(env, to, me, call));
  return json({ ok: true }, 200);
}

/* The stored offer, for the callee the ring's push woke: {key, call} →
   {ok, pending, from, sdp} while the call is fresh (inside the ring plus the
   push's own latency), unanswered and not yet missed; {ok, pending:false,
   answered} once it was taken (on another device, say). Only the callee it
   was placed to may read it; anyone else gets the empty answer a call that
   never existed gives. */
async function handleCallPending(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const call = String(data.call || '');
  if (!/^[0-9a-f]{16,64}$/.test(call)) return json({ ok: false, error: 'Bad request.' }, 400);
  const row = await env.DB.prepare(
    'SELECT from_hash, sdp, created_at, answered_at, missed_at, ended_at FROM calls_pending WHERE call = ?1 AND to_hash = ?2'
  ).bind(call, me).first();
  const now = Math.floor(Date.now() / 1000);
  const fresh = !!row && (now - Number(row.created_at)) <= CallK.ringTimeoutSecs + 15;
  if (!row || row.answered_at || row.missed_at || row.ended_at || !fresh) {
    return json({ ok: true, pending: false, answered: !!(row && row.answered_at) }, 200);
  }
  return json({ ok: true, pending: true, from: row.from_hash, sdp: row.sdp, age: now - Number(row.created_at) }, 200);
}

/* The call's outcome, from the party that saw it end: {key, call, to,
   reason} — reason one of Domain.Call.endReasons. What it records is
   `Domain.Call.callOutcome`'s one rule (who reports, whether the call had
   been answered, the word): the caller's noanswer / canceled / busy is the
   MISS, either side's declined the decline, any end after the answer the
   answered line with its length, an unanswered break-up a stamp and no line;
   a word that records nothing (a callee cannot cancel) is dropped. Recording
   is once per call — `recordCallEnd`'s stamp is the lock, whatever is
   reported after. Idempotent; a row that is not there is nothing to say. */
async function handleCallEnd(request: any, env: any, ctx: any) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const call = String(data.call || '');
  const reason = String(data.reason || '');
  if (!/^[0-9a-f]{16,64}$/.test(call) || CallK.endReasons.indexOf(reason) === -1) return json({ ok: false, error: 'Bad request.' }, 400);
  const row = await env.DB.prepare('SELECT call, from_hash, to_hash, answered_at, missed_at, ended_at FROM calls_pending WHERE call = ?1').bind(call).first();
  if (!row || (row.from_hash !== me && row.to_hash !== me)) return json({ ok: true }, 200);
  if (row.ended_at || row.missed_at) return json({ ok: true }, 200);   // recorded already: the lock would refuse anyway
  const outcome = MaybeM.maybe(null)((o: string) => o)(CallK.callOutcome({ caller: row.from_hash === me, answered: !!row.answered_at, reason }));
  if (!outcome) return json({ ok: true }, 200);
  const rec = recordCallEnd(env, row, outcome);
  if (ctx) ctx.waitUntil(rec); else await rec;
  return json({ ok: true }, 200);
}

/* Answer a call: symmetric relay of the SDP answer back to the caller. No
   block/bot gate — the offer was the invitation. The waitUntil marks THIS
   call's missed-call row read, TARGETED (kind+actor), never the nuke-all
   /notifications/read. */
async function handleCallAnswer(request: any, env: any, ctx: any) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const settings = await getAppSettings(env);
  if (settings.calls_enabled !== '1') return json({ ok: false, error: 'Calls are turned off.' }, 403);
  const to = String(data.to || '');
  const call = String(data.call || '');
  const sdp = String(data.sdp || '');
  if (!/^[0-9a-f]{64}$/.test(to) || !/^[0-9a-f]{16,64}$/.test(call)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!sdp || sdp.length > 32768 || sdp.slice(0, 2) !== 'v=') return json({ ok: false, error: 'Bad request.' }, 400);
  /* `late`: the callee answered from the stored offer (the push woke them):
     the caller re-sends every ICE candidate it gathered, which went out to no
     socket the first time. */
  await publishUser(env, [{ v: 1, t: 'call-answer', scopes: ['user:' + to], from: me, call, sdp, late: data.late ? 1 : 0 }]);
  const now = Math.floor(Date.now() / 1000);
  const stamp = env.DB.prepare('UPDATE calls_pending SET answered_at = ?2 WHERE call = ?1 AND to_hash = ?3 AND answered_at IS NULL').bind(call, now, me).run().catch(() => {});
  if (ctx) {
    ctx.waitUntil(stamp);
    ctx.waitUntil(env.DB.prepare(
      "UPDATE notifications SET read_at = ?3 WHERE recipient_hash = ?1 AND kind = 'call' AND actor_hash = ?2 AND read_at IS NULL"
    ).bind(me, to, now).run().catch(() => {}));
  } else await stamp;
  return json({ ok: true }, 200);
}

/* Mint short-lived per-call ICE servers. TURN (the ~15-20% strict-network
   relay leg) needs the TURN key pair AND the calls_turn admin toggle; any
   absence or failure degrades to the free STUN-only list — calls still mostly
   connect, and the degradation IS the no-billing-exposure kill switch. */
async function handleCallTurn(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const settings = await getAppSettings(env);
  if (settings.calls_enabled !== '1') return json({ ok: false, error: 'Calls are turned off.' }, 403);
  /* TURN credentials relay real bandwidth from the free pool — established
     identities only (the drive-by fence; STUN-only needs no fence but there
     is no reason to answer a throwaway key at all). */
  if (!(await isEstablished(env, pre.me))) return json({ ok: false, error: 'Calls unlock after your first post or profile save.' }, 403);
  const fallback = () => json({ ok: true, iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['stun:stun.l.google.com:19302'] },
  ], relay: false }, 200);
  if (settings.calls_turn !== '1' || !env.TURN_KEY_ID || !env.TURN_KEY_SECRET) return fallback();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + env.TURN_KEY_ID + '/credentials/generate-ice-servers', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.TURN_KEY_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 7200 }),
      signal: ctl.signal,
    });
    if (!r.ok) return fallback();
    const d: any = await r.json();
    const servers = d && d.iceServers ? (Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers]) : null;
    if (!servers || !servers.length) return fallback();
    return json({ ok: true, iceServers: servers, relay: true }, 200);
  } catch (e) {
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

export {
  handleCallAnswer,
  handleCallEnd,
  handleCallOffer,
  handleCallPending,
  handleCallTurn,
};
