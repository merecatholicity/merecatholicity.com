/* The member model (migration 0016, 2026-09-13), on the real ledger: a
 * conversation is a thread with member rows, and every rule about who sees
 * what runs through the viewer's own row — what they may read (unheld or
 * their own; since they joined; after their clear; in a group, not from a
 * sender they blocked), who a word reaches, who may read an attachment, and
 * that a member who left has no seat at all. The pair's room is made on its
 * first word by one upsert that survives the legacy pair index too.
 *
 * What would break silently: a member added later reading the history the
 * crypto denies them; a leaver still counted, fanned to, or served an object;
 * a blocker in a group seeing the blocked member's words (or a pair's stored
 * hold governed by the block instead); an attachment served to a stranger; a
 * pair's room minted twice. The fragments are lifted from lib.ts by name and
 * run here as the worker joins them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return db;
}
const lift = (re) => { const m = libSrc.match(re); assert.ok(m, 'lib.ts carries ' + re); return m[1]; };
const DM_VIS = lift(/export const DM_VIS = "([^"]+)";/);
const DM_CLEARED = lift(/export const DM_CLEARED = '([^']+)';/);
const DM_MINE = lift(/export const DM_MINE = '([^']+)';/);
const dmLive = new Function('now', lift(/export function dmLive\(now: any\) \{([\s\S]*?)\}(?:\n|$)/));
const libBody = (name) => { const i = libSrc.indexOf('export async function ' + name + '('); assert.ok(i > 0, name); return libSrc.slice(i, libSrc.indexOf('\n}\n', i)); };
const carries = (body, frags) => { for (const f of frags) assert.ok(body.includes(f), 'carries: ' + f); };

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), D = 'd'.repeat(64);
const KEY = 'dm/' + '1'.repeat(64);

/* A group of three (C added late) and a pair, with a block from A on B. */
function seeded() {
  const db = freshDb();
  db.exec(`INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (1, 1, NULL, 100, 400, '${C}', 3), (2, 0, '${A}|${B}', 100, 260, '${B}', 2)`);
  db.exec(`INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (1, '${A}', 100), (1, '${B}', 100), (1, '${C}', 300), (2, '${A}', 100), (2, '${B}', 100)`);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, held, enc, media_key) VALUES (?, ?, ?, ?, ?, ?, 3, ?)');
  ins.run(1, 1, A, 'E3.a', 200, null, null);          // before C joined
  ins.run(2, 1, B, 'E3.b', 350, null, KEY);           // B's, with the object — A blocks B
  ins.run(3, 1, C, 'E3.c', 400, null, null);
  ins.run(4, 2, B, 'E1.x', 250, null, null);          // the pair, before the block: unheld
  ins.run(5, 2, B, 'E1.y', 260, 1, null);             // the pair, during the block: held
  db.exec(`INSERT INTO dm_media (key, size, created_at) VALUES ('${KEY}', 10, 349)`);
  db.exec(`INSERT INTO dm_media_refs (key, msg_id) VALUES ('${KEY}', 2)`);
  db.exec(`INSERT INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES ('${A}', '${B}', 300)`);
  return db;
}
const visible = (db, who, thread, now = 1000) => db.prepare(
  'SELECT m.id FROM dms m JOIN dm_threads t ON t.id = m.thread_id JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 ' +
  'WHERE m.thread_id = ?2 AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ' ORDER BY m.id'
).all(who, thread).map((r) => r.id);

test('what a member may read: since they joined, after their clear, unheld or their own — and in a group never a sender they blocked', () => {
  const db = seeded();
  assert.deepEqual(visible(db, A, 1), [1, 3], 'A: not B\'s word — a blocked sender is silent to the blocker in a group');
  assert.deepEqual(visible(db, B, 1), [1, 2, 3], 'B: everything (the block is A\'s alone)');
  assert.deepEqual(visible(db, C, 1), [2, 3], 'C joined at 300: no history from before');
  assert.deepEqual(visible(db, D, 1), [], 'a stranger has no seat');
  db.exec(`UPDATE dm_members SET cleared_at = 360 WHERE thread_id = 1 AND hash = '${B}'`);
  assert.deepEqual(visible(db, B, 1), [3], 'B cleared at 360: a fresh start');
  /* The pair keeps its stored hold: A still reads B\'s unheld word from before the block, never the held one; B reads both of their own. */
  assert.deepEqual(visible(db, A, 2), [4], 'a pair: the hold governs, not the block at read time');
  assert.deepEqual(visible(db, B, 2), [4, 5], 'a sender always sees their own words, held or not');
  db.close();
});

test('a member who left has no seat: the thread is nowhere for them (DM_MINE), and dmThreadFor answers by id or by pair from that seat alone', () => {
  const db = seeded();
  const seat = (who, id) => db.prepare('SELECT COUNT(*) AS n FROM dm_threads t ' + DM_MINE + ' WHERE t.id = ?2').get(who, id).n;
  assert.equal(seat(B, 1), 1);
  db.exec(`UPDATE dm_members SET left_at = 500 WHERE thread_id = 1 AND hash = '${B}'`);
  assert.equal(seat(B, 1), 0, 'left: gone');
  assert.equal(seat(D, 1), 0, 'a stranger: gone');
  const f = libBody('dmThreadFor');
  carries(f, ["FROM dm_threads t ' + DM_MINE + ' WHERE t.id = ?2", "FROM dm_threads t ' + DM_MINE + ' WHERE t.pair_key = ?2", 'if (!t) return null;', 'return { thread: t || null, other };']);
  assert.ok(/if \(!\/\^\[0-9a-f\]\{64\}\$\/\.test\(other\) \|\| other === me\) return null;/.test(f), 'a malformed or self `with` is null, never a room');
  db.close();
});

test('who a word reaches (dmRecipients): every current member but the sender, minus any who block them', () => {
  const db = seeded();
  const body = libBody('dmRecipients');
  const SQL = 'SELECT mb.hash FROM dm_members mb WHERE mb.thread_id = ?1 AND mb.left_at IS NULL AND mb.hash != ?2 ' +
    'AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.owner_hash = mb.hash AND b.blocked_hash = ?2)';
  carries(body, ["'SELECT mb.hash FROM dm_members mb WHERE mb.thread_id = ?1 AND mb.left_at IS NULL AND mb.hash != ?2 '", "'AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.owner_hash = mb.hash AND b.blocked_hash = ?2)'"]);
  const to = (who) => db.prepare(SQL).all(1, who).map((r) => r.hash[0]);
  assert.deepEqual(to(B), ['c'], 'B\'s word: C alone — A blocks B, A\'s world stays untouched');
  assert.deepEqual(to(A), ['b', 'c']);
  db.exec(`UPDATE dm_members SET left_at = 500 WHERE thread_id = 1 AND hash = '${C}'`);
  assert.deepEqual(to(A), ['b'], 'a leaver is reached no more');
  db.close();
});

test('who may read an attachment (dmMediaReadable): a member who can see a live, unredacted word naming it — not a stranger, a leaver, a blocker, or after a redact or an expiry', () => {
  const db = seeded();
  const body = libBody('dmMediaReadable');
  carries(body, ["'SELECT 1 AS ok FROM dm_media_refs r JOIN dms m ON m.id = r.msg_id JOIN dm_threads t ON t.id = m.thread_id ' + DM_MINE + ' '", "'WHERE r.key = ?2 AND COALESCE(m.redacted, 0) = 0 AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ' LIMIT 1'"]);
  const may = (who, now = 1000) => !!db.prepare(
    'SELECT 1 AS ok FROM dm_media_refs r JOIN dms m ON m.id = r.msg_id JOIN dm_threads t ON t.id = m.thread_id ' + DM_MINE + ' ' +
    'WHERE r.key = ?2 AND COALESCE(m.redacted, 0) = 0 AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ' LIMIT 1'
  ).get(who, KEY);
  assert.equal(may(B), true, 'the sender');
  assert.equal(may(C), true, 'a member who can see the word');
  assert.equal(may(A), false, 'a member for whom the sender is silent');
  assert.equal(may(D), false, 'a stranger');
  db.exec(`UPDATE dm_members SET left_at = 500 WHERE thread_id = 1 AND hash = '${C}'`);
  assert.equal(may(C), false, 'a leaver');
  db.exec(`UPDATE dm_media_refs SET msg_id = 2 WHERE key = '${KEY}'`);
  db.exec("UPDATE dms SET expires_at = 900 WHERE id = 2");
  assert.equal(may(B, 1000), false, 'an expired word names nothing');
  db.exec("UPDATE dms SET expires_at = NULL, redacted = 1 WHERE id = 2");
  assert.equal(may(B), false, 'a redacted word names nothing');
  /* The media GET and the shared-object send both run the one rule. */
  assert.ok(/if \(!\(await dmMediaReadable\(env, me, mediaKey, now\)\)\) return json\(\{ ok: false, error: 'Not found\.' \}, 404\);/.test(idxSrc), 'the GET');
  assert.ok(/if \(refRow && refRow\.n > 0 && !\(await dmMediaReadable\(env, me, rawMediaKey, now\)\)\) \{/.test(idxSrc), 'a forward names an object again only by a reader of it');
  db.close();
});

test('the pair\'s room is made once (ensurePairThread): the upsert survives the pair index and the legacy one, and heals a room made without its pair_key', () => {
  const db = freshDb();
  const body = libBody('ensurePairThread');
  carries(body, ["'INSERT INTO dm_threads (kind, pair_key, created_at, last_at, last_sender, msgs, a_hash, b_hash) VALUES (0, ?1, ?2, ?2, ?3, 0, ?4, ?5) '",
    "'ON CONFLICT DO UPDATE SET pair_key = COALESCE(pair_key, excluded.pair_key), last_at = ?2, last_sender = ?3 RETURNING id'",
    "'INSERT OR IGNORE INTO dm_members (thread_id, hash, joined_at) VALUES (?1, ?2, ?3)'"]);
  const up = db.prepare('INSERT INTO dm_threads (kind, pair_key, created_at, last_at, last_sender, msgs, a_hash, b_hash) VALUES (0, ?1, ?2, ?2, ?3, 0, ?4, ?5) ' +
    'ON CONFLICT DO UPDATE SET pair_key = COALESCE(pair_key, excluded.pair_key), last_at = ?2, last_sender = ?3 RETURNING id');
  const first = up.get(A + '|' + B, 100, A, A, B).id;
  assert.equal(up.get(A + '|' + B, 200, B, A, B).id, first, 'the same room on the second word');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads').get().n, 1);
  /* A room the pre-0016 worker made in the deploy window: a_hash/b_hash, no pair_key. */
  db.exec(`INSERT INTO dm_threads (kind, created_at, last_at, last_sender, msgs, a_hash, b_hash) VALUES (0, 50, 50, '${C}', 0, '${A}', '${C}')`);
  const healed = up.get(A + '|' + C, 300, A, A, C);
  assert.equal(db.prepare('SELECT pair_key FROM dm_threads WHERE id = ?').get(healed.id).pair_key, A + '|' + C, 'healed: the legacy index found it, pair_key filled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads').get().n, 2, 'no second room');
  db.close();
});

test('the inbox query runs on the ledger: a pair\'s other, a group\'s members and count, the words from my seat alone', () => {
  const db = seeded();
  const t = idxSrc.slice(idxSrc.indexOf('async function handleDmThreads('), idxSrc.indexOf('\nasync function ', idxSrc.indexOf('async function handleDmThreads(') + 10));
  const build = t.slice(t.indexOf('const otherOf = '), t.indexOf('const rows = await'));
  const fragment = (name) => libSrc.match(new RegExp('export function ' + name + '\\(now: any\\) \\{([\\s\\S]*?)\\}(?:\\n|$)'))[1];
  const dmUnreadCount = new Function('dmLive', 'now', fragment('dmUnreadCount'));
  const inner = new Function('DM_VIS', 'DM_CLEARED', 'dmLive', 'dmUnreadCount', 'Dm', 'now', build + '; return inner;')(DM_VIS, DM_CLEARED, dmLive, (n) => dmUnreadCount(dmLive, n), { inboxAvatars: 4 }, 1000);
  const rows = (who) => db.prepare('SELECT * FROM (' + inner + ') WHERE msgs > 0 ORDER BY last_at DESC').all(who).map((r) => ({ id: r.id, kind: r.kind, other: r.other_hash && r.other_hash[0], members: JSON.parse(r.members_json).map((m) => m.hash[0]), n: r.member_count, msgs: r.msgs, unread: r.unread }));
  assert.deepEqual(rows(A), [
    { id: 1, kind: 1, other: null, members: ['b', 'c'], n: 3, msgs: 2, unread: 1 },    // A reads 1 and 3; unread: C's (B is silent to A)
    { id: 2, kind: 0, other: 'b', members: ['b'], n: 2, msgs: 1, unread: 1 },          // the pair: B's unheld word
  ]);
  assert.deepEqual(rows(C), [{ id: 1, kind: 1, other: null, members: ['a', 'b'], n: 3, msgs: 2, unread: 1 }], 'C: nothing from before joining; B\'s word unread');
  db.exec(`UPDATE dm_members SET left_at = 500 WHERE thread_id = 1 AND hash = '${C}'`);
  assert.deepEqual(rows(C), [], 'a leaver\'s inbox has no such conversation');
  db.close();
});

test('the thread tells whether each member reports reads (2026-09-15): a group\'s ✓✓ waits only for those who do, and Message info says "Receipts off"', () => {
  const t = idxSrc.slice(idxSrc.indexOf('async function handleDmThread('), idxSrc.indexOf('\nasync function ', idxSrc.indexOf('async function handleDmThread(') + 10));
  assert.ok(/receipts: Prefs\.receiptsOn\(r\.receipts_mode \|\| 'auto'\) \? 1 : 0,/.test(t), 'each member row carries receipts');
  assert.ok(/read_at: \(r\.hash === me \|\| Prefs\.receiptsOn\(r\.receipts_mode \|\| 'auto'\)\) && r\.read_at != null \? Number\(r\.read_at\) : null,/.test(t), 'and a hidden stamp stays withheld');
  const ann = idxSrc.slice(idxSrc.indexOf('async function announceDmMembers('), idxSrc.indexOf('\n}\n', idxSrc.indexOf('async function announceDmMembers(')));
  assert.ok(/receipts: Prefs\.receiptsOn\(r\.receipts_mode \|\| 'auto'\) \? 1 : 0 \}\)\)/.test(ann), 'a newcomer announced with it too');
});
