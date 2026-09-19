/* A member has TWO identities and they are not interchangeable (2026-09-19).
 *
 * Since the P0 chain's layer-three flip:
 *   ACCOUNT hash = sha256hex(key). D1's primary key. What the hub authenticates
 *     and shards on, and the ONLY string it will accept as a `user:` scope.
 *     It never crosses the wire on a served row.
 *   PUBLIC id (pubid) = what the worker mints with its pepper. What every
 *     served row carries — `author_hash`, `members[].hash`, `sender_hash`,
 *     `from`. The client CANNOT compute it; /prefs `me` is its only source.
 *
 * Before the flip these were the same string and one variable did both jobs.
 * After it, using the wrong one throws nothing and logs nothing — it makes a
 * reader a stranger to their own conversation. Live on 2026-09-19: a pair
 * thread titled with the reader's OWN name, every message drawn as the other
 * party's because `sender_hash === myHash` was never true, and a pair's E1
 * words unopenable because the "other" member resolved to the reader (so the
 * decrypt reached for their own public key). The same mistake in the other
 * direction subscribes a socket to `user:<pubid>`, which the worker refuses,
 * and every private frame is dropped in silence.
 *
 * So these tests hold the two rules that keep them apart: the public id is
 * only ever taken from the server, and hub routing is only ever the account
 * hash. Both are textual laws about where a value may come from — there is no
 * behaviour to run, because the bug's whole character is that nothing fails. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sanitizeScopes } from '../../comments-worker/src/pure.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const sources = () => ['client', 'app']
  .flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.ts')).map((f) => d + '/' + f))
  .map((p) => [p, read(p)]);

test('no client module derives its PUBLIC id from the key', () => {
  /* `state.myHash = <a digest of the key>` is the whole bug. The public id has
     one source — the server — reached through resolveMyId()/setMyId(). */
  const bad = [];
  for (const [path, src] of sources()) {
    src.split('\n').forEach((line, i) => {
      if (/sha256hex\s*\([^)]*\)\s*\.then\s*\(\s*(function\s*)?\(?\s*(\w+)/.test(line)) {
        const after = src.split('\n').slice(i, i + 4).join('\n');
        if (/\b(state\.)?my(Hash|Id)\s*=/.test(after) && !/myRoute\s*=/.test(after)) {
          bad.push(path + ':' + (i + 1));
        }
      }
    });
  }
  assert.deepEqual(bad, [], 'these take the ACCOUNT hash as a public identity; use resolveMyId()');
});

test('the public id is read from /prefs `me`, and cached under one key only', () => {
  const src = read('client/comments.ts');
  assert.match(src, /function setMyId/, 'one setter owns the cache');
  assert.match(src, /function resolveMyId/, 'one resolver owns the fetch');
  /* setKey/clearKey must drop it: a public id outliving its key names the
     PREVIOUS identity, and every comparison silently inverts again. */
  const setKey = src.slice(src.indexOf('function setKey'), src.indexOf('function makeKey'));
  assert.match(setKey, /setMyId\(''\)/, 'setKey must clear the cached public id');
  assert.match(setKey.slice(setKey.indexOf('function clearKey')), /setMyId\(''\)/, 'clearKey too');
});

test('hub routing is handed the ACCOUNT hash, never the public id', () => {
  for (const [path, src] of sources()) {
    const m = src.match(/member\.enable\(([^)]*)\)/g) || [];
    for (const call of m) {
      assert.ok(!/myHash|myId\b/.test(call),
        path + ': member.enable got a public id (' + call + ') — the hub shards on the account hash');
    }
  }
});

test('the worker refuses a `user:` scope that is not the caller\'s own account hash', () => {
  const acct = 'a'.repeat(64);      // sha256hex(key), what the hub derives
  const pub = 'b'.repeat(64);       // the pubid the same member wears on the wire
  assert.deepEqual(sanitizeScopes(['user:' + acct], acct, []), ['user:' + acct],
    'the account hash is the subscribable one');
  assert.deepEqual(sanitizeScopes(['user:' + pub], acct, []), [],
    'a socket that offered its PUBLIC id would subscribe to nothing and never be told');
});

test('the DM screen takes the server\'s word for who the reader is, not an id comparison', () => {
  /* The comparison is not banned — it is the fallback for a payload cached
     before the server started marking. What is banned is doing it FIRST. When
     the ids changed shape on 2026-09-19 the comparison matched nothing and the
     reader became a stranger to their own conversation; `is_me` and `mine` come
     from the seat the key was resolved in, so they cannot drift. */
  const src = readFileSync(join(root, 'client', 'dm-thread.ts'), 'utf8');
  for (const [fn, field] of [['isMe', 'is_me'], ['mineMsg', 'mine']]) {
    const at = src.indexOf('function ' + fn + '(');
    assert.ok(at >= 0, fn + '() must exist: one place decides, and the views ask it');
    const body = src.slice(at, src.indexOf('\n', at));
    assert.ok(body.includes(field), fn + ' must read the server\'s ' + field);
    /* and no id comparison hiding in it as a "fallback": that IS the inference
       this removes, and it would quietly come back the next time ids change
       shape. Every row and message carries the flag either way, so there is
       nothing to fall back FROM. */
    assert.ok(!body.includes('state.myHash'),
      fn + ': no id comparison — the server marks every row, so a fallback can only reintroduce the bug');
  }
  /* and no member/message site may go back to comparing by hand */
  const strays = [];
  src.split('\n').forEach((line, i) => {
    if (/function (isMe|mineMsg)\(/.test(line)) return;
    if (/\bmm\.hash (===|!==) state\.myHash/.test(line)) strays.push('member row, line ' + (i + 1));
    if (/sender_hash\) === state\.myHash/.test(line)) strays.push('message side, line ' + (i + 1));
  });
  assert.deepEqual(strays, [], 'these infer the reader instead of asking isMe()/mineMsg()');
});
