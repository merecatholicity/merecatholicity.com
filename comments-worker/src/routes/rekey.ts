/* Key rotation (the P0 chain's last piece, 2026-09-18). A member changes the
 * secret behind their identity — because it leaked, or was weak — while keeping
 * their content. The account hash H = sha256(key) is D1's key for everything, so
 * a rotation MOVES every row from the old hash to the new one in a single atomic
 * batch, and the member's public id (and displayed pseudonym) changes with it
 * (pubid = SHA-256(pepper‖hash) is derived from the hash) — which is right for a
 * deliberate security rotation: the compromised identity is retired, the writings
 * follow.
 *
 * The one thing a hash-move cannot carry is the E2E DM key material. Each DM
 * content key K is sealed to the member's X25519 public key, which derives from
 * the account key — so after a rotation the member cannot open a single old
 * envelope. The CLIENT re-seals first: it fetches its sealed keys (/dm/mykeys),
 * opens each with the OLD key, and re-wraps K to ITSELF as a symmetric secretbox
 * under a key derived from the NEW account key (an `S3.` self-seal that needs no
 * sender — client/dm-crypto.ts). The rekey request carries those re-seals, and
 * this handler REFUSES if they do not cover every one of the member's dm_keys
 * rows, so a rotation can never silently drop a conversation. */
import * as Auth from '../../../purescript/output/Domain.Auth/index.js';
import {
  gated,
  keyedGated,
  json,
  cloakIds,
  bodyOf,
  sha256hex,
  dmPairKey,
  dmPairOther,
  registerMember,
} from '../lib.ts';
import type { Body } from '../lib.ts';
import type { Env } from '../env.ts';

/* Every (table, column) that holds this member's ACCOUNT hash — moved from the
   old hash to the new. The specials (dm_pubkeys.pubkey, dm_keys.sealed,
   dm_threads.pair_key) are handled after this list, not in it. Kept in step with
   the schema; a new identity column joins here and its move is proven by
   rekey.test.mjs's "nothing is left behind" sweep over PRAGMA table_info. */
export const REKEY_COLS: ReadonlyArray<readonly [string, string]> = [
  ['profiles', 'hash'],
  ['comments', 'author_hash'],
  ['wall_posts', 'author_hash'], ['wall_comments', 'author_hash'],
  /* the two frozen like tables (the reactions ledger replaced them; 0018 drops
     them) are read by nothing and hold no live rows, so nothing to move. */
  ['reactions', 'author_hash'],
  ['bans', 'hash'], ['trusted', 'hash'], ['locks', 'hash'], ['shadowbans', 'hash'], ['shadowbans', 'added_by'],
  ['admins', 'hash'], ['admins', 'added_by'], ['discord_hooks', 'created_by'],
  ['identity_ips', 'hash'], ['push_tokens', 'hash'], ['bookmarks', 'hash'], ['watches', 'hash'],
  ['thread_reads', 'hash'], ['reports', 'reporter_hash'],
  ['notifications', 'recipient_hash'], ['notifications', 'actor_hash'],
  ['calls_pending', 'from_hash'], ['calls_pending', 'to_hash'],
  ['dms', 'sender_hash'], ['dms', 'saved_by'],
  ['dm_blocks', 'owner_hash'], ['dm_blocks', 'blocked_hash'],
  ['dm_members', 'hash'], ['dm_members', 'added_by'], ['dm_reactions', 'hash'],
  ['dm_threads', 'created_by'], ['dm_threads', 'last_sender'], ['dm_threads', 'a_hash'], ['dm_threads', 'b_hash'],
];

/* The member's own sealed keys, each with the SENDER's published pubkey, so the
   client can open every K (a box from the sender, or a prior S3 self-seal) and
   re-wrap it under the new key. The member's OWN envelopes only — no leak, and
   no account hash rides (the sender is named by pubkey, not hash). */
export async function handleDmMyKeys(request: Request, env: Env): Promise<Response> {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { me } = pre;
  const rows = await env.DB.prepare(
    'SELECT k.msg_id AS msg_id, k.sealed AS sealed, pk.pubkey AS sender_pubkey '
    + 'FROM dm_keys k JOIN dms m ON m.id = k.msg_id LEFT JOIN dm_pubkeys pk ON pk.hash = m.sender_hash '
    + 'WHERE k.hash = ?1'
  ).bind(me).all<{ msg_id: number; sealed: string; sender_pubkey: string | null }>();
  return json({ ok: true, keys: rows.results || [] }, 200);
}

/* Rotate this identity's key. Body: {key} (the OLD key, proving the caller owns
   the identity — the gate reads it), {newkey} (the new secret, which must clear
   the key floor and be unused), {pubkey} (the new X25519 public key), {resealed}
   ({msg_id: S3-sealed} for every one of the member's dm_keys). Everything moves
   in ONE atomic batch, so a rotation is all-or-nothing. */
export async function handleRekey(request: Request, env: Env): Promise<Response> {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', key: 'required', block: true });
  if (pre instanceof Response) return pre;
  const { data, me: hOld } = pre;

  const newKey = String((data as Body).newkey || '');
  if (!newKey) return json({ ok: false, error: 'A new key is required.' }, 400);
  /* the whole point is to leave a weak key behind, so the new one must be strong */
  if (!Auth.keyAcceptable(newKey)) return json({ ok: false, error: Auth.keyRefusal(true)(newKey), weak_key: true }, 400);
  const hNew = await sha256hex(newKey);
  if (hNew === hOld) return json({ ok: false, error: 'That is the same key.' }, 400);

  const newPub = String((data as Body).pubkey || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(newPub)) return json({ ok: false, error: 'Bad request.' }, 400);

  /* the new hash must wear nothing yet — a rotation MUST NOT collide with, or
     silently merge into, another identity (astronomically unlikely for a fresh
     key, but a hard refusal is the only safe answer) */
  const clash = await env.DB.prepare(
    'SELECT 1 AS v FROM profiles WHERE hash = ?1 '
    + 'UNION SELECT 1 FROM dm_pubkeys WHERE hash = ?1 '
    + 'UNION SELECT 1 FROM comments WHERE author_hash = ?1 '
    + 'UNION SELECT 1 FROM dm_members WHERE hash = ?1 LIMIT 1'
  ).bind(hNew).first();
  if (clash) return json({ ok: false, error: 'That key is already in use — generate another.' }, 409);

  /* the re-seals must cover EVERY sealed key the member holds, or a conversation
     would go dark after the swap; refuse rather than lose one */
  const resealed = bodyOf((data as Body).resealed);
  const keyRows = await env.DB.prepare('SELECT msg_id FROM dm_keys WHERE hash = ?1').bind(hOld).all<{ msg_id: number }>();
  const need = (keyRows.results || []).map((r: { msg_id: number }) => r.msg_id);
  const missing = need.filter((mid: number) => typeof resealed[String(mid)] !== 'string' || !resealed[String(mid)]);
  if (missing.length) return json({ ok: false, error: 'reseal-incomplete', need: need.length, missing: missing.length }, 409);

  /* a pair thread's pair_key is min(a,b)|max(a,b); the member's move re-sorts it */
  const pairs = await env.DB.prepare(
    "SELECT id, pair_key FROM dm_threads WHERE pair_key LIKE ?1 OR pair_key LIKE ?2"
  ).bind(hOld + '|%', '%|' + hOld).all<{ id: number; pair_key: string }>();

  await registerMember(env, hOld);   // ensure the profiles row exists to move
  const now = Math.floor(Date.now() / 1000);
  const stmts = [];
  for (const [tbl, col] of REKEY_COLS) {
    stmts.push(env.DB.prepare('UPDATE ' + tbl + ' SET ' + col + ' = ?1 WHERE ' + col + ' = ?2').bind(hNew, hOld));
  }
  stmts.push(env.DB.prepare('UPDATE dm_pubkeys SET hash = ?1, pubkey = ?2, updated_at = ?3 WHERE hash = ?4').bind(hNew, newPub, now, hOld));
  for (const mid of need) {
    stmts.push(env.DB.prepare('UPDATE dm_keys SET hash = ?1, sealed = ?2 WHERE msg_id = ?3 AND hash = ?4').bind(hNew, String(resealed[String(mid)]), mid, hOld));
  }
  for (const p of (pairs.results || [])) {
    const other = dmPairOther(p.pair_key, hOld);
    if (other) stmts.push(env.DB.prepare('UPDATE dm_threads SET pair_key = ?1 WHERE id = ?2').bind(dmPairKey(hNew, other), p.id));
  }
  await env.DB.batch(stmts);

  /* the caller adopts the new key and reads its own new public id back */
  return json(await cloakIds(env, { ok: true, hash: hNew }), 200);
}
