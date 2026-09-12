/* Per-message DM reactions (migration 0012, `/dm/react`, the live `dm-react`
 * and `dm-save` events).
 *
 * What would break silently: a reaction stored without the kernel's validator
 * (an inline regex in the worker drifting from the picker's), the old heart
 * lost in the move (a like from August that no longer lights), `/dm/like`
 * answering 404 to a client cached before the picker, a reaction accepted on a
 * message the reactor cannot see (held, expired, redacted, behind their own
 * clear stamp), the other side never hearing a reaction or a save. So: the
 * ledger builds and 0012 backfills against a genuinely pre-0012 database, and
 * drift guards over the shipping handlers (the comments-switches idiom). */
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

function freshDb(upTo) {
  const db = new DatabaseSync(':memory:');
  let files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  if (upTo) files = files.filter((f) => f.slice(0, 4) <= upTo);
  for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return { db, files };
}

/* The body of one top-level handler, by name. */
const body = (name) => {
  const i = idxSrc.indexOf(`async function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = idxSrc.indexOf('\nasync function ', i + 10);
  return idxSrc.slice(i, j > i ? j : i + 6000);
};

test('the ledger builds through 0012 and dms carries one reaction column per side', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0012_dm_reactions')), 'migration 0012 present');
  const cols = db.prepare('PRAGMA table_info(dms)').all().map((c) => c.name);
  assert.ok(cols.includes('react_a') && cols.includes('react_b'), 'dms.react_a / dms.react_b');
  assert.ok(cols.includes('liked_a') && cols.includes('liked_b'), 'the old flags are left in place — the ledger never drops a column');
  db.close();
});

test('0012 carries every old like forward as the ❤️ reaction, and nothing else', () => {
  const { db } = freshDb('0011');
  db.exec("INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES ('a', 'b', 1, 1, 'a', 3)");
  const ins = db.prepare('INSERT INTO dms (thread_id, sender_hash, body, created_at, liked_a, liked_b) VALUES (1, ?, ?, 1, ?, ?)');
  ins.run('a', 'one', 1, null);    // a hearted it
  ins.run('b', 'two', null, 1);    // b hearted it
  ins.run('a', 'three', 1, 1);     // both
  ins.run('b', 'four', 0, null);   // nobody
  db.exec(readFileSync(join(migrationsDir, '0012_dm_reactions.sql'), 'utf8'));
  const rows = db.prepare('SELECT body, react_a, react_b FROM dms ORDER BY id').all().map((r) => ({ ...r }));   // node:sqlite rows have a null prototype
  assert.deepEqual(rows, [
    { body: 'one', react_a: '❤️', react_b: null },
    { body: 'two', react_a: null, react_b: '❤️' },
    { body: 'three', react_a: '❤️', react_b: '❤️' },
    { body: 'four', react_a: null, react_b: null },
  ]);
  /* The backfilled bytes are the quick bar's heart: U+2764 U+FE0F. */
  assert.equal(rows[0].react_a, '❤️');
  db.close();
});

test('the reaction is validated by the kernel, in the one worker membrane', () => {
  /* Since 2026-09-12 the grammar is Domain.Reaction (shared with the board and
     the feed); dmReaction is that one validator under its DM-era name. */
  assert.ok(/export function reactionOf\(raw: any\): string \| null \{\s*return psOrNull\(Reaction\.normalizeReaction\(/.test(libSrc),
    'lib.ts reactionOf must erase Domain.Reaction.normalizeReaction — no inline grammar');
  assert.ok(/export const dmReaction = reactionOf;/.test(libSrc), 'dmReaction is the same validator');
  const h = body('handleDmReact');
  assert.ok(/dmReaction\(raw\)/.test(h), 'handleDmReact must validate through dmReaction');
  assert.ok(!/Extended_Pictographic|\\p\{Emoji/.test(h), 'no emoji regex re-inlined in the handler');
  assert.ok(/emoji === null\)/.test(h) && /400\)/.test(h), 'an invalid reaction is a 400, not stored');
  assert.ok(/raw\.trim\(\) \? dmReaction\(raw\) : ''/.test(h), 'an empty string withdraws (no validation needed for nothing)');
});

test('the old heart rides the new road: /dm/like is the react handler with ❤️ or nothing', () => {
  assert.ok(/p: '\/api\/comments\/dm\/react', fn: \(request, env, ctx, url\) => handleDmReact\(request, env, ctx\)/.test(idxSrc));
  assert.ok(/p: '\/api\/comments\/dm\/like', fn: \(request, env, ctx, url\) => handleDmReact\(request, env, ctx\)/.test(idxSrc),
    'a client cached before the picker still lands its heart');
  assert.ok(!/handleDmLike/.test(idxSrc), 'the old handler is gone, not duplicated');
  const h = body('handleDmReact');
  assert.ok(/data\.like \? '❤️' : ''/.test(h), '{like:1} is the ❤️ reaction, {like:0} withdraws');
});

test('a reaction lands only on a message the reactor can see, never a redacted one', () => {
  const h = body('handleDmReact');
  assert.ok(/COALESCE\(d\.held, 0\) = 0 OR d\.sender_hash = \?1/.test(h), 'held-from-me words are invisible');
  assert.ok(/d\.expires_at IS NULL OR d\.expires_at > \?5/.test(h), 'an expired word is gone');
  assert.ok(/t\.a_cleared_at ELSE t\.b_cleared_at/.test(h), 'my own delete-conversation stamp hides what came before it');
  assert.ok(/if \(row\.redacted\) return json\(\{ ok: false, error: 'That message was deleted\.' \}, 409\)/.test(h));
  assert.ok(/const col = me === a \? 'react_a' : 'react_b'/.test(h), 'one column per side of the canonical pair');
  assert.ok(/bind\(emoji \|\| null, id\)/.test(h), 'a withdrawn reaction is NULL, never an empty string');
});

test('the thread tells each viewer react_me / react_other, and the other side hears reactions and saves live', () => {
  const t = body('handleDmThread');
  assert.ok(/m\.react_a, m\.react_b FROM dms m/.test(t), 'the thread reads the reaction columns');
  assert.ok(/out\.react_me = String\(\(iAmA \? m\.react_a : m\.react_b\) \|\| ''\)/.test(t));
  assert.ok(/out\.react_other = String\(\(iAmA \? m\.react_b : m\.react_a\) \|\| ''\)/.test(t));
  assert.ok(/out\.liked_me = out\.react_me \? 1 : 0/.test(t), 'the heart fields are derived for one deploy of cached clients');
  const r = body('handleDmReact');
  assert.ok(/t: 'dm-react', scopes: \['user:' \+ other\][^}]*message: \{ id, emoji \}/.test(r), 'dm-react to the other party only');
  const s = body('handleDmSave');
  assert.ok(/t: 'dm-save', scopes: \['user:' \+ other\][^}]*message: \{ id, saved \}/.test(s), 'dm-save to the other party only');
  assert.ok(/handleDmSave\(request, env, ctx\)/.test(idxSrc), 'the save route passes ctx so the event can publish');
});
