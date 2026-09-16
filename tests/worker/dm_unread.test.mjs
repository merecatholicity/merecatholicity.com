/* Unread words, counted and named (2026-09-11): every unread number on the site
 * is WORDS, from one fragment — the inbox row's badge, the inbox total, the tab
 * bar's badge — the thread tells what was unread BEFORE the open marked it read,
 * and a member who appears offline is not seen typing.
 *
 * What would break silently: a badge reading "1" for twelve words; the tab badge
 * and the row badges disagreeing because one counts threads and the other counts
 * words; the unread line drawn from the post-open stamp (nothing is ever unread
 * after the open); a held, expired or cleared word counted; the typing frame
 * leaking a hidden member's presence. So: the counting fragment, the thread's
 * query and the tab badge's own query all run against the real ledger, and drift
 * guards stand over the handlers and the hub. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handlerBody, routesSource } from '../_support/worker_src.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const idxSrc = routesSource();
const hubSrc = readFileSync(join(root, 'comments-worker', 'src', 'durable.ts'), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return db;
}
const body = (name) => handlerBody(name, idxSrc);
/* the SQL fragments exactly as the worker builds them, lifted from lib.ts by name */
function fragment(name) {
  const m = libSrc.match(new RegExp('export function ' + name + '\\(now: any\\) \\{([\\s\\S]*?)\\}(?:\\n|$)'));
  assert.ok(m, `lib.ts exports ${name}(now)`);
  return m[1];
}
const dmLive = new Function('now', fragment('dmLive'));
const dmUnreadCount = new Function('dmLive', 'now', fragment('dmUnreadCount'));

const me = 'a'.repeat(64), other = 'b'.repeat(64);
/* The viewer's seat: every counting query joins their own member row (DM_MINE). */
const MINE = 'JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 AND mb.left_at IS NULL';
function seeded() {
  const db = freshDb();
  db.exec(`INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (1, 0, '${me}|${other}', 100, 1600, '${other}', 6)`);
  db.exec(`INSERT INTO dm_members (thread_id, hash, joined_at, read_at) VALUES (1, '${me}', 100, 1000), (1, '${other}', 100, NULL)`);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, held, expires_at) VALUES (?, 1, ?, ?, ?, ?, ?)');
  ins.run(1, other, 'read already', 900, null, null);
  ins.run(2, other, 'unread', 1100, null, null);
  ins.run(3, other, 'held — never counts', 1200, 1, null);
  ins.run(4, other, 'expired by now', 1300, null, 1500);
  ins.run(5, me, 'mine', 1400, null, null);
  ins.run(6, other, 'unread too', 1600, null, null);
  return db;
}

test('the counting fragment counts exactly the unheld, unexpired, uncleared words from the other side newer than my stamp', () => {
  const db = seeded();
  const count = (who, now) => db.prepare('SELECT ' + dmUnreadCount(dmLive, now) + ' AS unread FROM dm_threads t ' + MINE + ' WHERE t.id = 1').get(who).unread;
  assert.equal(count(me, 2000), 2, 'ids 2 and 6: not the read one, not the held, not the expired, not my own');
  assert.equal(count(other, 2000), 1, 'from their seat (no stamp yet): my one word');
  db.exec(`UPDATE dm_members SET cleared_at = 1150 WHERE thread_id = 1 AND hash = '${me}'`);
  assert.equal(count(me, 2000), 1, 'a cleared member sees only what came after their clear stamp');
  db.exec(`UPDATE dm_members SET read_at = 1700 WHERE thread_id = 1 AND hash = '${me}'`);
  assert.equal(count(me, 2000), 0, 'read up to date: nothing');
  db.exec(`UPDATE dm_members SET left_at = 1800 WHERE thread_id = 1 AND hash = '${me}'`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads t ' + MINE + ' WHERE t.id = 1').get(me).n, 0, 'a member who left has no seat: the thread is nowhere for them');
  db.close();
});

test('the inbox rows carry the count, and unread_total sums those same words', () => {
  const t = body('handleDmThreads');
  assert.ok(/dmUnreadCount\(now\) \+ ' AS unread '/.test(t), 'the row\'s unread is the count');
  assert.ok(/COALESCE\(SUM\(unread\), 0\) AS unread/.test(t), 'the total adds the rows up — words, not threads');
  assert.ok(!/SUM\(CASE WHEN unread > 0 THEN 1 ELSE 0 END\)/.test(t), 'the old thread tally is gone');
});

/* The tab bar's badge (2026-09-11): the same words, summed across every thread,
   so "3" on the Inbox tab means three messages waiting — and equals what the
   inbox rows add up to. A thread tally here would silently under-report. */
test('the tab badge counts unread WORDS across all threads, by the inbox\'s own fragment', () => {
  const t = body('handleDmUnread');
  assert.ok(!/dmUnreadExists/.test(t) && !/dmUnreadExists/.test(libSrc), 'the thread-flag fragment is gone entirely');
  const m = t.match(/'([^']*)' \+ dmUnreadCount\(now\) \+ '([^']*)'/);
  assert.ok(m, 'the query is the counting fragment, summed');
  const sql = m[1] + dmUnreadCount(dmLive, 2000) + m[2];
  assert.ok(/JOIN dm_members mb ON mb\.thread_id = t\.id AND mb\.hash = \?1 AND mb\.left_at IS NULL/.test(m[2]), 'summed over MY seats alone (the member model, 0016)');
  const db = seeded();
  /* a second conversation — a group of three — two unread words in it (and one held, which never counts) */
  db.exec(`INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (2, 1, NULL, 100, 1700, '${other}', 3)`);
  db.exec(`INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (2, '${me}', 100), (2, '${other}', 100), (2, '${'c'.repeat(64)}', 100)`);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, held, expires_at) VALUES (?, 2, ?, ?, ?, ?, NULL)');
  ins.run(7, other, 'unread', 1650, null);
  ins.run(8, other, 'unread as well', 1700, null);
  ins.run(9, other, 'held — never counts', 1700, 1);
  assert.equal(db.prepare(sql).get(me).n, 4, 'two words in one thread plus two in the other — not "2 threads"');
  db.exec(`UPDATE dm_members SET read_at = 1700 WHERE thread_id = 1 AND hash = '${me}'`);
  assert.equal(db.prepare(sql).get(me).n, 2, 'reading one conversation leaves the other\'s two');
  db.exec(`UPDATE dm_members SET read_at = 1700 WHERE thread_id = 2 AND hash = '${me}'`);
  assert.equal(db.prepare(sql).get(me).n, 0, 'all read: no badge');
  db.close();
});

test('the thread names what was unread BEFORE the open marks it read: the count and the first unread id', () => {
  const t = body('handleDmThread');
  const q = t.indexOf("'SELECT COUNT(*) AS n, MIN(m.id) AS first_id FROM dms m WHERE");
  const upd = t.indexOf("'UPDATE dm_members SET read_at = ?2 WHERE thread_id = ?3 AND hash = ?1 AND EXISTS(");
  assert.ok(q > 0 && upd > q, 'the unread query runs before the read stamp is advanced');
  assert.ok(/const myReadAt = Number\(thread\.read_at \|\| 0\);/.test(t), 'from the stamp my member row arrived with (0016)');
  assert.ok(/\.bind\(me, thread\.id, myReadAt, floor, kind\)\.first\(\);/.test(t), 'bounded by my clear stamp and my joining, and (in a group) a sender I blocked');
  assert.ok(/unread: \(unreadRow && unreadRow\.n\) \|\| 0, unread_from: \(unreadRow && unreadRow\.first_id\) \|\| null,\s*notif_unread: await notifUnreadCount\(env, me\) \}, 200\);/.test(t),
    'both ride the payload — with the fresh bell count beside them (2026-09-12: opening reads the sender\'s bells)');
  assert.ok(/blocked: iBlocked \? 1 : 0, unread: 0, unread_from: null,\s*notif_unread: await notifUnreadCount\(env, me\) \}, 200\);/.test(t), 'the empty room says so too — and its bells');
  /* the query itself, on the real ledger */
  const m = t.match(/'(SELECT COUNT\(\*\) AS n, MIN\(m\.id\) AS first_id[^']*)' \+\s*'([^']*)' \+ dmLive\(now\)/);
  assert.ok(m, 'the query is two literals and the liveness fragment');
  const db = seeded();
  const row = db.prepare(m[1] + m[2] + dmLive(2000)).get(me, 1, 1000, 0, 0);
  assert.deepEqual({ n: row.n, first_id: row.first_id }, { n: 2, first_id: 2 }, 'two unread, the line stands above id 2');
  const none = db.prepare(m[1] + m[2] + dmLive(2000)).get(me, 1, 1700, 0, 0);
  assert.deepEqual({ n: none.n, first_id: none.first_id }, { n: 0, first_id: null });
  const joined = db.prepare(m[1] + m[2] + dmLive(2000)).get(me, 1, 0, 1199, 1);
  assert.deepEqual({ n: joined.n, first_id: joined.first_id }, { n: 1, first_id: 6 }, 'a member who joined at 1200 has one unread word: nothing from before their joining');
  db.exec(`INSERT INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES ('${me}', '${other}', 1)`);
  assert.equal(db.prepare(m[1] + m[2] + dmLive(2000)).get(me, 1, 0, 0, 1).n, 0, 'in a group (kind 1) a sender I blocked has no unread words for me');
  assert.equal(db.prepare(m[1] + m[2] + dmLive(2000)).get(me, 1, 0, 0, 0).n, 3, 'in a pair the stored hold governs, not the block at read time');
  db.close();
});

test('a member who appears offline is not seen typing: the hub drops their signal by the kernel\'s own rule', () => {
  const typing = hubSrc.slice(hubSrc.indexOf("if (m.t === 'typing')"), hubSrc.indexOf("for (const to of Array.from(new Set(list))) this.#fan('user:' + to, frame);"));
  assert.ok(typing.length > 0, 'the typing branch fans to each named member');
  assert.ok(/if \(!Presence\.isVisible\(\(a && a\.presenceMode\) \|\| 'auto'\)\(true\)\) return;/.test(typing),
    'the same rule that hides their socket hides their keystrokes (Domain.Presence.isVisible)');
});
