/* Unread words, counted and named (2026-09-11): the inbox row's badge is a
 * count, `unread_total` still counts THREADS, the thread tells what was
 * unread BEFORE the open marked it read, and a member who appears offline is
 * not seen typing.
 *
 * What would break silently: a badge reading "1" for twelve words; the tab's
 * count quietly becoming a message count; the unread line drawn from the
 * post-open stamp (nothing is ever unread after the open); a held, expired or
 * cleared word counted; the typing frame leaking a hidden member's presence.
 * So: the counting fragment and the thread's query run against the real
 * ledger, and drift guards over the handlers and the hub. */
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
const hubSrc = readFileSync(join(root, 'comments-worker', 'src', 'durable.ts'), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return db;
}
const body = (name) => {
  const i = idxSrc.indexOf(`async function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = idxSrc.indexOf('\nasync function ', i + 10);
  return idxSrc.slice(i, j > i ? j : i + 6000);
};
/* the SQL fragments exactly as the worker builds them, lifted from lib.ts by name */
function fragment(name) {
  const m = libSrc.match(new RegExp('export function ' + name + '\\(now: any\\) \\{([\\s\\S]*?)\\}(?:\\n|$)'));
  assert.ok(m, `lib.ts exports ${name}(now)`);
  return m[1];
}
const dmLive = new Function('now', fragment('dmLive'));
const dmUnreadCount = new Function('dmLive', 'now', fragment('dmUnreadCount'));

const me = 'a'.repeat(64), other = 'b'.repeat(64);
function seeded() {
  const db = freshDb();
  db.exec(`INSERT INTO dm_threads (id, a_hash, b_hash, created_at, last_at, last_sender, msgs, a_read_at) VALUES (1, '${me}', '${other}', 100, 1600, '${other}', 6, 1000)`);
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
  const count = (who, now) => db.prepare('SELECT ' + dmUnreadCount(dmLive, now) + ' AS unread FROM dm_threads t WHERE t.id = 1').get(who).unread;
  assert.equal(count(me, 2000), 2, 'ids 2 and 6: not the read one, not the held, not the expired, not my own');
  assert.equal(count(other, 2000), 1, 'from their seat (no stamp yet): my one word');
  db.exec('UPDATE dm_threads SET a_cleared_at = 1150 WHERE id = 1');
  assert.equal(count(me, 2000), 1, 'a cleared side sees only what came after its clear stamp');
  db.exec('UPDATE dm_threads SET a_read_at = 1700 WHERE id = 1');
  assert.equal(count(me, 2000), 0, 'read up to date: nothing');
  db.close();
});

test('the inbox rows carry the count, and unread_total still counts THREADS', () => {
  const t = body('handleDmThreads');
  assert.ok(/dmUnreadCount\(now\) \+ ' AS unread '/.test(t), 'the row\'s unread is the count');
  assert.ok(/SUM\(CASE WHEN unread > 0 THEN 1 ELSE 0 END\)/.test(t), 'the total counts threads with something unread, as the tab badge always did');
  assert.ok(!/CASE WHEN ' \+ dmUnreadExists\(now\)/.test(t), 'the old flag is gone from the rows');
});

test('the thread names what was unread BEFORE the open marks it read: the count and the first unread id', () => {
  const t = body('handleDmThread');
  const q = t.indexOf("'SELECT COUNT(*) AS n, MIN(m.id) AS first_id FROM dms m WHERE");
  const upd = t.indexOf("'UPDATE dm_threads SET ' + myReadCol");
  assert.ok(q > 0 && upd > q, 'the unread query runs before the read stamp is advanced');
  assert.ok(/const myReadAt = Number\(\(me === a \? thread\.a_read_at : thread\.b_read_at\) \|\| 0\);/.test(t), 'from the stamp the thread row arrived with');
  assert.ok(/\.bind\(me, thread\.id, myReadAt, myCleared\)\.first\(\);/.test(t));
  assert.ok(/unread: \(unreadRow && unreadRow\.n\) \|\| 0, unread_from: \(unreadRow && unreadRow\.first_id\) \|\| null \}, 200\);/.test(t), 'both ride the payload');
  assert.ok(/blocked: iBlocked \? 1 : 0, unread: 0, unread_from: null \}, 200\);/.test(t), 'the empty room says so too');
  /* the query itself, on the real ledger */
  const m = t.match(/'(SELECT COUNT\(\*\) AS n, MIN\(m\.id\) AS first_id[^']*)' \+\s*'([^']*)' \+ dmLive\(now\)/);
  assert.ok(m, 'the query is two literals and the liveness fragment');
  const db = seeded();
  const row = db.prepare(m[1] + m[2] + dmLive(2000)).get(me, 1, 1000, 0);
  assert.deepEqual({ n: row.n, first_id: row.first_id }, { n: 2, first_id: 2 }, 'two unread, the line stands above id 2');
  const none = db.prepare(m[1] + m[2] + dmLive(2000)).get(me, 1, 1700, 0);
  assert.deepEqual({ n: none.n, first_id: none.first_id }, { n: 0, first_id: null });
  db.close();
});

test('a member who appears offline is not seen typing: the hub drops their signal by the kernel\'s own rule', () => {
  const typing = hubSrc.slice(hubSrc.indexOf("if (m.t === 'typing')"), hubSrc.indexOf("this.#fan('user:' + to, JSON.stringify({ v: 1, t: 'typing'"));
  assert.ok(/if \(!Presence\.isVisible\(\(a && a\.presenceMode\) \|\| 'auto'\)\(true\)\) return;/.test(typing),
    'the same rule that hides their socket hides their keystrokes (Domain.Presence.isVisible)');
});
