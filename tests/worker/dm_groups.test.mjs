/* Conversations with members (2026-09-13): a group is born with a system
 * line, anyone adds (a pair forks into a new group; a group grows in place,
 * a returning leaver afresh), a member leaves and the last leaver takes the
 * thread with them, any member names it, the roster is read without a mark,
 * and a forward is one gate for up to ten words through the send's own core.
 *
 * What would break silently: a member added without a key (their words
 * unreadable), or one who blocks the adder (told of the block by the
 * refusal's wording); a pair growing in place (its private history inside a
 * group); a re-added member keeping their old stamps (history back); a group
 * outliving its last member; a roster read that marked the thread read; a
 * forward with its own delivery code drifting from the send's. Statements
 * are lifted from the worker and, where they write, run on the real ledger. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return db;
}
const body = (src, name) => {
  const i = src.indexOf('async function ' + name + '(');
  assert.ok(i > 0, name + ' not found');
  return src.slice(i, src.indexOf('\n}\n', i));
};
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), D = 'd'.repeat(64);
const TURNSTILE = /verifyTurnstile\(env, String\(data\.token \|\| ''\), ip, String\(data\.key \|\| ''\)\)/;

test('the six roads are registered, all under /dm/ (never disk-cached by prefix), each a *Dm* handler the privacy sweep covers', () => {
  for (const [p, fn] of [['roster', 'handleDmRoster(request, env)'], ['groups', 'handleDmGroups(request, env, ctx)'], ['members', 'handleDmMembers(request, env, ctx)'],
    ['leave', 'handleDmLeave(request, env, ctx)'], ['name', 'handleDmName(request, env, ctx)'], ['forward', 'handleDmForward(request, env, ctx)']]) {
    assert.ok(idxSrc.includes(`{ m: 'POST', p: '/api/comments/dm/${p}', fn: (request, env, ctx, url) => ${fn} }`), '/dm/' + p);
  }
});

test('who may be added (dmEligible): a published key, and no block on the adder — one generic word for both', () => {
  const e = body(libSrc, 'dmEligible');
  assert.ok(/h !== me && h !== MERECAT_BOT\.hash/.test(e), 'never the adder, never the bot');
  assert.ok(/'SELECT pk\.hash FROM dm_pubkeys pk WHERE pk\.hash IN \(' \+ inList\(want\.length, 2\) \+ '\) ' \+\s*'AND NOT EXISTS \(SELECT 1 FROM dm_blocks b WHERE b\.owner_hash = pk\.hash AND b\.blocked_hash = \?1\)'/.test(e));
  const db = freshDb();
  db.exec(`INSERT INTO dm_pubkeys (hash, pubkey, created_at, updated_at) VALUES ('${B}', 'kb', 1, 1), ('${C}', 'kc', 1, 1)`);
  db.exec(`INSERT INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES ('${C}', '${A}', 1)`);
  const ok = db.prepare('SELECT pk.hash FROM dm_pubkeys pk WHERE pk.hash IN (?2, ?3, ?4) AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.owner_hash = pk.hash AND b.blocked_hash = ?1)').all(A, B, C, D).map((r) => r.hash[0]);
  assert.deepEqual(ok, ['b'], 'B has a key and no block; C blocks A; D has no key');
  for (const h of ['handleDmGroups', 'handleDmMembers']) {
    const g = body(idxSrc, h);
    assert.ok(/if \(missing\.length\) return json\(\{ ok: false, error: 'Some members cannot be added yet\.', missing \}, 400\);/.test(g), h + ': the one generic refusal');
    assert.ok(TURNSTILE.test(g), h + ': Turnstile-gated (a write that reaches other members)');
    assert.ok(/Dm\.maxMembers/.test(g), h + ': the cap is the kernel\'s');
  }
  db.close();
});

test('a group is born with its line, and every newcomer hears of it: createDmGroup is the one road for /dm/groups and the fork', () => {
  const c = body(idxSrc, 'createDmGroup');
  assert.ok(/'INSERT INTO dm_threads \(kind, pair_key, name, created_at, created_by, last_at, last_sender, msgs\) VALUES \(1, NULL, \?1, \?2, \?3, \?2, \?3, 0\) RETURNING id'/.test(c), 'kind 1, no pair key');
  assert.ok(/await sendSystemDmLine\(env, thread\.id, me, Dm\.sysAddLine\(wanted\)\);/.test(c), 'the first word is "X added …" — loud, so each newcomer\'s bell and inbox learn of the group');
  assert.ok(/await announceDmMembers\(env, ctx, thread\.id, me, wanted, \[\]\);/.test(c));
  assert.ok(/const id = await createDmGroup\(env, ctx, me, wanted, name, Math\.floor\(Date\.now\(\) \/ 1000\)\);/.test(body(idxSrc, 'handleDmGroups')));
  const m = body(idxSrc, 'handleDmMembers');
  assert.ok(/if \(kind === 0\) \{[\s\S]*const id = await createDmGroup\(env, ctx, me, \[found\.other\]\.concat\(wanted\), null, now\);\s*return json\(\{ ok: true, thread_id: id, forked: 1, added: wanted \}, 200\);/.test(m), 'a pair forks into a new group of the other and the newcomers');
  assert.ok(/const name = dmGroupName\(data\.name\);/.test(body(idxSrc, 'handleDmGroups')) && /return psOrNull\(Dm\.normalizeGroupName\(/.test(libSrc), 'the name is the kernel\'s normalisation');
});

test('a group grows in place, and a returning leaver starts afresh (the upsert, on the ledger)', () => {
  const m = body(idxSrc, 'handleDmMembers');
  const up = "'INSERT INTO dm_members (thread_id, hash, joined_at, added_by) VALUES (?1, ?2, ?3, ?4) ' +\n    'ON CONFLICT(thread_id, hash) DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL, read_at = NULL, cleared_at = NULL, added_by = excluded.added_by'";
  assert.ok(m.includes(up), 'the upsert as the worker builds it');
  assert.ok(/filter\(\(h: string\) => current\.indexOf\(h\) === -1\)/.test(m), 'a current member asked again is nothing');
  const db = freshDb();
  db.exec(`INSERT INTO dm_threads (id, kind, created_at, last_at, last_sender) VALUES (1, 1, 1, 1, '${A}')`);
  db.exec(`INSERT INTO dm_members (thread_id, hash, joined_at, left_at, read_at, cleared_at) VALUES (1, '${A}', 1, NULL, 50, NULL), (1, '${B}', 1, 40, 30, 20)`);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at, added_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(thread_id, hash) DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL, read_at = NULL, cleared_at = NULL, added_by = excluded.added_by').run(1, B, 100, A);
  assert.deepEqual({ ...db.prepare('SELECT joined_at, left_at, read_at, cleared_at, added_by FROM dm_members WHERE thread_id = 1 AND hash = ?').get(B) }, { joined_at: 100, left_at: null, read_at: null, cleared_at: null, added_by: A }, 'back, from now: no history, no stamps');
  db.close();
});

test('leaving: the line, the stamp, the announcement — and the last one out takes the thread', () => {
  const l = body(idxSrc, 'handleDmLeave');
  assert.ok(/if \(Number\(thread\.kind\) !== 1\) return json\(\{ ok: false, error: 'A conversation with one person is deleted, not left\.' \}, 400\);/.test(l), 'a pair is not left');
  const line = l.indexOf("await sendSystemDmLine(env, thread.id, me, Dm.sysLeaveLine, { quiet: true });");
  const stamp = l.indexOf("'UPDATE dm_members SET left_at = ?1 WHERE thread_id = ?2 AND hash = ?3'");
  assert.ok(line > 0 && stamp > line, 'my last word, then my seat is stamped');
  assert.ok(/await announceDmMembers\(env, ctx, thread\.id, me, \[\], \[me\]\);/.test(l));
  assert.ok(/'SELECT COUNT\(\*\) AS n FROM dm_members WHERE thread_id = \?1 AND left_at IS NULL'/.test(l) && /await releaseMediaRefs\(env, \(media\.results \|\| \[\]\) as any\[\]\);/.test(l) && /'DELETE FROM dm_threads WHERE id = \?1'/.test(l), 'nobody left: the objects let go, everything purged');
});

test('the name is any member\'s, the roster is read without a mark, the forward is one gate for ten words through the send\'s own core', () => {
  const n = body(idxSrc, 'handleDmName');
  assert.ok(/const name = dmGroupName\(data\.name\);\s*if \(!name\) return json\(\{ ok: false, error: 'Bad request\.' \}, 400\);/.test(n) && /Dm\.sysNameLine\(name\)/.test(n) && /t: 'dm-name'/.test(n));
  const r = body(idxSrc, 'handleDmRoster');
  assert.ok(/keyedGated\(request, env, 'READ_LIMIT'\)/.test(r) && !/UPDATE |INSERT /.test(r), 'a read, never a write');
  assert.ok(/await dmCurrentMembers\(env, found\.thread\.id\) : await dmPubkeysOf\(env, \[me, found\.other\]\)/.test(r), 'the current members\' keys, or an unmade pair\'s two');
  const f = body(idxSrc, 'handleDmForward');
  assert.ok(/if \(!key \|\| !items\.length \|\| items\.length > 10\) return json/.test(f) && TURNSTILE.test(f), 'at most ten, one Turnstile');
  assert.ok(/const r = await deliverDmWord\(env, ctx, me, item && typeof item === 'object' \? item : \{\}, now\);/.test(f), 'each word through the delivery core');
  assert.ok(/return deliverDmWord\(env, ctx, me, data, Math\.floor\(Date\.now\(\) \/ 1000\)\);/.test(body(idxSrc, 'handleDmSend')), 'the send is the same core behind its gate');
  const core = body(idxSrc, 'deliverDmWord');
  assert.ok(/if \(refRow && refRow\.n > 0 && !\(await dmMediaReadable\(env, me, rawMediaKey, now\)\)\)/.test(core), 'a forwarded attachment names its object again only by a reader of it');
  assert.ok(/'INSERT OR IGNORE INTO dm_media_refs \(key, msg_id\) VALUES \(\?1, \?2\)'/.test(core), 'and gains a reference');
  assert.ok(/if \(!Dm\.membersEqual\(Object\.keys\(keys\)\)\(roster\.map\(\(m: any\) => m\.hash\)\)\) \{\s*return json\(\{ ok: false, error: 'roster', members: roster \}, 409\);/.test(core), 'a stale roster is answered with the fresh one');
});
