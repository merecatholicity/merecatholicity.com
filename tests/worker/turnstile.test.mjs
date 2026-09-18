/* The worker's half of the verification rule.
 *
 * The client may believe it is spared, but only the server knows whether an
 * identity is established, and only the server can be trusted to ask. These
 * hold the three properties that make the skip safe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { routesSource } from '../_support/worker_src.mjs';
import { loadWorker, makeEnv, freshDb, identity, establish, seen, call, netSpy, resetCaches } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const index = routesSource();

const verify = lib.slice(lib.indexOf('export async function verifyTurnstile'),
  lib.indexOf('/* ---- Shadow ban'));

test('the skip only applies when no token was offered', () => {
  /* A presented token is still verified against siteverify. Skipping that
     would let a spent or forged token through on a technicality. */
  assert.ok(/if \(!token && key\) \{/.test(verify),
    'the skip must be gated on there being no token at all');
  assert.ok(/siteverify/.test(verify), 'a presented token is still verified');
});

test('it asks the server, never the caller', () => {
  assert.ok(/turnstileSkipEstablished\(s\)/.test(verify), 'the setting is read from app_settings');
  assert.ok(/isEstablished\(env, await sha256hex\(key\)\)/.test(verify),
    'establishment is looked up from the identity hash, not taken on trust');
  /* Nothing in the request may influence this: no header, no body flag, no
     user-agent sniff. The hash and the setting are the only inputs. */
  assert.ok(!/User-Agent|userAgent|standalone|display-mode/i.test(verify),
    'nothing about the client may earn the exemption');
});

test('it fails closed, like the rest of the function', () => {
  /* A settings read or an establishment probe that throws must demand a token,
     never wave the write through. */
  const guard = verify.slice(verify.indexOf('if (!token && key)'), verify.indexOf('try {\n    const res'));
  assert.ok(/catch \(err\) \{/.test(guard), 'the skip must be wrapped');
  assert.ok(!/return true/.test(guard.slice(guard.indexOf('catch'))),
    'the catch must fall through to demanding a token, not return true');
});

test('the setting is reachable, coerced, and served', () => {
  /* The standing gap this file also closes: nothing had ever guarded the
     /admin/settings allowlist, so a mistyped key was a silent no-op. */
  assert.ok(/turnstile_skip_established: 1/.test(index), 'not in the /admin/settings allowlist');
  /* Assert the RULE, not the line (the social test's lesson): the key sits in
     the shared 1/0 coercion chain, whatever siblings join it later. */
  const coercion = index.slice(index.indexOf("if (k === 'media_enabled'"));
  const chain = coercion.slice(0, coercion.indexOf(';') + 1);
  assert.ok(/k === 'turnstile_skip_established'/.test(chain) && /v = \(v === '1' \|\| v === 'true'\) \? '1' : '0';/.test(chain),
    'not coerced to 1/0 like its sibling switches');
  assert.ok(/turnstile: \{ skip_established: turnstileSkipEstablished\(s\) \}/.test(index),
    '/config must tell the client whether a challenge is worth mounting');
  assert.ok(/turnstile_skip_established: Turnstile\.skipEstablishedDefault/.test(lib),
    'the default must come from the kernel, not a literal');
});

/* The Turnstile test bypass is gone (2026-09-17). It let a `TEST:<secret>`
   token through for the kit's identities; the disclosure published the
   secret, and the established-identity skip already spares those identities
   when they send no token at all — so the branch, its two secrets and the
   kit's token went, and a `TEST:` token is a token like any other. */
test('a TEST: token is verified like any token, and an established identity with none needs no bypass', async () => {
  assert.ok(!/MC_TEST_BYPASS|TEST_HASHES|'TEST:'/.test(verify), 'no bypass branch in verifyTurnstile');
  const { worker } = await loadWorker();
  const kit = await identity('turnstile-kit');
  const asked = [];
  const net = netSpy((url, init) => {
    asked.push(String(init && init.body));
    return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  });
  try {
    resetCaches();
    const db = freshDb();
    establish(db, kit.hash);
    db.prepare("INSERT INTO comments (id, page, title, author_hash, body, status, created_at, last_at) VALUES (1, 'board:pub', 'A topic', ?, 'x', 'live', 5, 5)").run(kit.hash);
    /* the old secret, as if it were still set (TEST_HASHES is gone too: a
       secret holding identity hashes would now refuse every answer naming one) */
    const env = makeEnv({ db, vars: { MC_TEST_BYPASS: 'the-old-bypass-secret-value' } });
    const forged = await call(worker, env, 'POST', '/api/comments', { key: kit.key, topic: 1, body: 'a reply', token: 'TEST:the-old-bypass-secret-value' });
    assert.equal(forged.status, 403, 'the old token is refused even with the old secret in the env');
    assert.equal(asked.length, 1, 'and it was asked of siteverify, like any token');
    resetCaches();
    const spared = await call(worker, env, 'POST', '/api/comments', { key: kit.key, topic: 1, body: 'a reply' });
    assert.equal(spared.status, 200, 'an established identity sending no token is spared by the rule, not by a bypass');
    assert.equal(asked.length, 1, 'without asking siteverify');
  } finally { net.restore(); }
});

/* The hole this file exists to keep shut (2026-09-17). `isEstablished` read
   "has a profiles row", and since 2026-09-16 a keyed READ leaves one behind
   (registerMember), so a key one minute old was established by opening the
   board — and with the client mounting nothing for a spared identity, the
   challenge asked nobody anything. The record is now `profiles.verified_at`,
   written only where a challenge was actually passed. */
test('reading does not establish an identity: only a passed challenge does', async () => {
  const { worker } = await loadWorker();
  const fresh = await identity('turnstile-fresh');
  const asked = [];
  const net = netSpy((url, init) => {
    asked.push(String(init && init.body));
    return Response.json({ success: false, 'error-codes': ['missing-input-response'] });
  });
  try {
    resetCaches();
    const db = freshDb();
    db.prepare("INSERT INTO comments (id, page, title, author_hash, body, status, created_at, last_at) VALUES (1, 'board:pub', 'A topic', 'a'||substr(hex(randomblob(32)),1,63), 'x', 'live', 5, 5)").run();
    seen(db, fresh.hash);            // what a keyed read leaves: a row, nothing more
    const env = makeEnv({ db });
    const bare = await call(worker, env, 'POST', '/api/comments', { key: fresh.key, topic: 1, body: 'a reply' });
    assert.equal(bare.status, 403, 'a row from a read is not a passed challenge');
    assert.equal(asked.length, 1, 'and the tokenless write was asked of siteverify, which refused it');
    assert.equal(db.prepare('SELECT verified_at FROM profiles WHERE hash = ?').get(fresh.hash).verified_at, null,
      'a refused challenge records nothing');

    /* the same identity, once it has passed one */
    establish(db, fresh.hash);
    resetCaches();
    const spared = await call(worker, env, 'POST', '/api/comments', { key: fresh.key, topic: 1, body: 'a reply' });
    assert.equal(spared.status, 200, 'an identity that has passed a challenge is spared the next one');
    assert.equal(asked.length, 1, 'without asking siteverify again');
  } finally { net.restore(); }
});

test('passing a challenge is what writes the record, and it is written once', async () => {
  const { worker } = await loadWorker();
  const newcomer = await identity('turnstile-newcomer');
  const net = netSpy(() => Response.json({ success: true, hostname: 'merecatholicity.com' }));
  try {
    resetCaches();
    const db = freshDb();
    db.prepare("INSERT INTO comments (id, page, title, author_hash, body, status, created_at, last_at) VALUES (1, 'board:pub', 'A topic', 'a'||substr(hex(randomblob(32)),1,63), 'x', 'live', 5, 5)").run();
    const env = makeEnv({ db });
    /* no profiles row at all: the first act of a key that has read nothing */
    const first = await call(worker, env, 'POST', '/api/comments', { key: newcomer.key, topic: 1, body: 'hello', token: 'a-solved-challenge' });
    assert.equal(first.status, 200);
    const stamped = db.prepare('SELECT verified_at FROM profiles WHERE hash = ?').get(newcomer.hash);
    assert.ok(stamped && stamped.verified_at > 0, 'siteverify said yes, so the identity is recorded as verified');

    /* a later challenge never moves the first date (the record is of the first
       time a person answered for this identity) */
    db.prepare('UPDATE profiles SET verified_at = 1000 WHERE hash = ?').run(newcomer.hash);
    resetCaches();
    const again = await call(worker, env, 'POST', '/api/comments', { key: newcomer.key, topic: 1, body: 'hello again', token: 'another-solved-challenge' });
    assert.equal(again.status, 200);
    assert.equal(db.prepare('SELECT verified_at FROM profiles WHERE hash = ?').get(newcomer.hash).verified_at, 1000,
      'the first verification stands');
  } finally { net.restore(); }
});

test('/prefs tells an identity whether IT is spared — the only honest thing to mount on', async () => {
  const { worker } = await loadWorker();
  const reader = await identity('turnstile-reader');
  const member = await identity('turnstile-member');
  resetCaches();
  const db = freshDb();
  seen(db, reader.hash);
  establish(db, member.hash);
  const env = makeEnv({ db });
  const asReader = await call(worker, env, 'POST', '/api/comments/prefs', { key: reader.key });
  assert.equal(asReader.status, 200);
  assert.equal(asReader.json.turnstile.spared, false, 'a row from a read is spared nothing');
  const asMember = await call(worker, env, 'POST', '/api/comments/prefs', { key: member.key });
  assert.equal(asMember.json.turnstile.spared, true, 'an identity that has passed one is');

  /* and when the admin switches the sparing off, nobody is spared — the one
     answer carries the whole rule, so the client never has to combine two */
  db.prepare("INSERT OR REPLACE INTO app_settings (k, v, updated_at, updated_by) VALUES ('turnstile_skip_established', '0', 1, 'admin')").run();
  resetCaches();
  const withSkipOff = await call(worker, env, 'POST', '/api/comments/prefs', { key: member.key });
  assert.equal(withSkipOff.json.turnstile.spared, false, 'the global switch is part of the answer');
});
