/* The one preamble and its options (P2-1, 2026-09-16): `gated`, `adminGated`,
 * `readLimited` in lib.ts, and the pipeline's `pipelineGated` (oidc.ts since
 * 2026-09-17; its tokens are tests/worker/pipeline.test.mjs's). Eighty handlers opened with the same
 * eight lines; they differed only in the 429 sentence, the missing-key
 * refusal and whether the block gate ran — so the options carry exactly that,
 * and every wire text a handler said before it still says. What would break
 * silently: a default text replacing a handler's own; an optional key refused
 * (a keyless edit answering 400 where it answered 403 "Not yours"); the block
 * gate dropped; the admin door answering anything but "No." to a stranger. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, freshDb, identity, weakIdentity, ORIGIN } from '../_support/worker.mjs';
import { gated, adminGated, readLimited, sha256hex } from '../../comments-worker/src/lib.ts';
import { pipelineGated } from '../../comments-worker/src/oidc.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const req = (body, { method = 'POST', ip = '203.0.113.7' } = {}) => new Request(ORIGIN + '/x', {
  method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: ORIGIN },
  body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});
const refusing = { limit: async () => ({ success: false }) };
let me, adm, weak;
before(async () => { [me, adm] = await Promise.all(['me', 'adm'].map(identity)); weak = await weakIdentity('eve'); });
const body = async (r) => ({ status: r.status, ...(await r.json()) });

test('gated: parse, limit, key, hash, block — each refusal with the text the option names', async () => {
  const env = makeEnv({ db: freshDb() });
  assert.deepEqual(await body(await gated(req('not json'), env, { bucket: 'POST_LIMIT' })), { status: 400, ok: false, error: 'Bad request.' });
  let r = await gated(req({ key: me.key, x: 1 }), env, { bucket: 'POST_LIMIT', block: true });
  assert.deepEqual([r.ip, r.key, r.me, r.data.x], ['203.0.113.7', me.key, me.hash, 1]);
  /* the 429 sentence is the option's, default 'Too many requests.' */
  const slow = { ...env, POST_LIMIT: refusing, READ_LIMIT: refusing, READ_IP_LIMIT: refusing };
  assert.deepEqual(await body(await gated(req({ key: me.key }), slow, { bucket: 'POST_LIMIT' })), { status: 429, ok: false, error: 'Too many requests.' });
  assert.deepEqual(await body(await gated(req({ key: me.key }), slow, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' })), { status: 429, ok: false, error: 'Too many requests. Slow down.' });
  assert.ok(!((await gated(req({ key: me.key }), slow, { bucket: null })) instanceof Response), 'bucket null: no limiter consulted');
  /* the missing key: refused with the default or the option's text, or allowed */
  assert.deepEqual(await body(await gated(req({}), env, { bucket: 'POST_LIMIT' })), { status: 400, ok: false, error: 'Bad request.' });
  assert.deepEqual(await body(await gated(req({}), env, { bucket: 'POST_LIMIT', missing: 'Sign in to react.' })), { status: 400, ok: false, error: 'Sign in to react.' });
  r = await gated(req({}), env, { bucket: 'POST_LIMIT', key: 'optional' });
  assert.deepEqual([r.key, r.me], ['', await sha256hex('')], 'an optional empty key hashes to the empty identity, exactly as the hand-rolled preambles did');
  /* the block gate */
  const db = freshDb();
  db.prepare("INSERT INTO bans (hash, kind, created_at) VALUES (?, 'author', 1)").run(me.hash);
  const banned = makeEnv({ db });
  const g = await gated(req({ key: me.key }), banned, { bucket: 'POST_LIMIT', block: true });
  assert.equal(g.status, 403, 'the lock/ban gate refuses');
  const open = await gated(req({ key: me.key }), banned, { bucket: 'POST_LIMIT' });
  assert.equal(open.me, me.hash, 'without block: the identity passes, as a hand-rolled preamble without the gate did');
  db.close();
});

test('adminGated: a stranger gets "No.", an admin gets the data and their own hash; the limit is optional', async () => {
  const env = makeEnv({ db: freshDb(), vars: { ADMIN_HASHES: adm.hash } });
  assert.deepEqual(await body(await adminGated(req({ key: me.key }), env, { bucket: 'READ_LIMIT' })), { status: 403, ok: false, error: 'No.' });
  assert.deepEqual(await body(await adminGated(req({}), env)), { status: 403, ok: false, error: 'No.' });
  const r = await adminGated(req({ key: adm.key, hash: 'abc' }), env, { bucket: 'READ_LIMIT' });
  assert.deepEqual([r.me, r.data.hash], [adm.hash, 'abc']);
  const slow = { ...env, READ_LIMIT: refusing, READ_IP_LIMIT: refusing };
  assert.equal((await adminGated(req({ key: adm.key }), slow, { bucket: 'READ_LIMIT' })).status, 429);
  assert.equal((await adminGated(req({ key: adm.key }), slow)).me, adm.hash, 'no bucket: no limiter');
  assert.deepEqual(await body(await adminGated(req('{'), env)), { status: 400, ok: false, error: 'Bad request.' });
});

test('readLimited: the ip, or the refusal — JSON, or plain text where the endpoint always answered so', async () => {
  const env = makeEnv({ db: freshDb() });
  assert.equal(await readLimited(req(undefined, { method: 'GET', ip: '198.51.100.9' }), env), '198.51.100.9');
  const slow = { ...env, READ_LIMIT: refusing, READ_IP_LIMIT: refusing };
  assert.deepEqual(await body(await readLimited(req(undefined, { method: 'GET' }), slow, { limited: 'Too many requests. Slow down.' })), { status: 429, ok: false, error: 'Too many requests. Slow down.' });
  const plain = await readLimited(req(undefined, { method: 'GET' }), slow, { plain: true });
  assert.deepEqual([plain.status, await plain.text()], [429, 'Too many requests.']);
});

test('pipelineGated: parse, then the caller — an admin key opens; anything else is "No."', async () => {
  const env = makeEnv({ db: freshDb(), vars: { ADMIN_HASHES: adm.hash, OPS_REPORT_KEY: 'report-secret-for-the-test' } });
  assert.deepEqual(await body(await pipelineGated(req('not json'), env, ['ingest'])), { status: 400, ok: false, error: 'Bad request.' });
  assert.deepEqual(await body(await pipelineGated(req('[1]'), env, ['ingest'])), { status: 400, ok: false, error: 'Bad request.' });
  assert.deepEqual(await body(await pipelineGated(req({ key: 'nope' }), env, ['ingest'])), { status: 403, ok: false, error: 'No.' });
  assert.deepEqual(await body(await pipelineGated(req({ key: 'report-secret-for-the-test' }), env, ['probe'])), { status: 403, ok: false, error: 'No.' },
    'the nightly\'s key is the ops door\'s alone');
  const r = await pipelineGated(req({ key: adm.key, probe: true }), env, ['ingest']);
  assert.deepEqual([r.data.probe, r.caller], [true, { road: 'admin' }]);
});

/* The key floor (the 2026-09-17 review's P0, layer two, 2026-09-18). The hash
 * the server publishes is one unsalted round of SHA-256 over the key, so a
 * guessable key is a guessable account — offline, at GPU speed, with nothing to
 * rate-limit. The server cannot judge a key after the fact; it judges it at the
 * moment it is presented. What would break silently here: the floor put on
 * READS (a weak-key member should be able to sign in and be TOLD, not walled);
 * the floor put on the anonymous empty key (every `key: 'optional'` road would
 * answer 400 about key strength instead of its own rule); a D1 read spent on
 * every strong key; or the 2026-10-18 tolerance quietly becoming permanent. */
test('keyFloor: a weak key is refused on a WRITE and never on a read, and the anonymous empty key is not a weak one', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  /* fresh identity, weak key, write → refused, in words that say what to do */
  const r = await body(await gated(req({ key: weak.key }), env, { bucket: 'POST_LIMIT' }));
  assert.equal(r.status, 400);
  assert.equal(r.ok, false);
  assert.equal(r.weak_key, true, 'the answer names the reason, so a client can say more than "400"');
  assert.match(r.error, /Create an identity/, 'a fresh identity is sent to the generated key');
  /* the same key READING is not refused: sign in, look around, be told */
  const read = await gated(req({ key: weak.key }), env, { bucket: 'READ_LIMIT' });
  assert.equal(read.me, weak.hash, 'a weak key still reads');
  /* an optional empty key is anonymity, not a weak identity */
  const anon = await gated(req({ x: 1 }), env, { bucket: 'POST_LIMIT', key: 'optional' });
  assert.equal(anon.key, '', 'the empty identity passes to the handler, as it always did');
  /* a good key never costs a D1 read */
  const before = db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n;
  const good = await gated(req({ key: me.key }), env, { bucket: 'POST_LIMIT' });
  assert.equal(good.me, me.hash);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n, before, 'and leaves no trace');
  db.close();
});

test('keyFloor: a weak key with history behind it still writes until 2026-10-18, and the ledger carries the date', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  db.prepare('INSERT INTO profiles (hash, created_at) VALUES (?, 1)').run(weak.hash);
  const r = await gated(req({ key: weak.key }), env, { bucket: 'POST_LIMIT' });
  assert.equal(r.me, weak.hash, 'an existing member is not locked out of their own account overnight');
  /* the tolerance is dated, not permanent: tests/worker/retire.test.mjs goes red
     on the due date, which is the whole point of putting it in the ledger */
  const ledger = JSON.parse(readFileSync(join(root, 'tests', '_support', 'retirements.json'), 'utf8'));
  const entry = ledger.find((e) => /weakKeyTolerated/.test(e.pattern));
  assert.ok(entry, 'the tolerance is named in the retirement ledger');
  assert.equal(entry.due, '2026-10-18');
  db.close();
});

test('keyFloor: the admin console is under the same floor — a cracked admin key that cannot write is the point', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  db.prepare('INSERT INTO admins (hash, added_by, created_at) VALUES (?, ?, 1)').run(weak.hash, 'seed');
  const r = await body(await adminGated(req({ key: weak.key }), env, { bucket: 'POST_LIMIT' }));
  assert.equal(r.status, 400);
  assert.equal(r.weak_key, true, 'admin authority does not exempt the key that carries it');
  db.close();
});
