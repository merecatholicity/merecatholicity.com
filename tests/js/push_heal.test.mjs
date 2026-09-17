/* app/push.ts — a member's push subscription follows a VAPID key rotation on
 * the next app OPEN, with no toggle and no Settings visit (2026-09-17).
 *
 * The rotation that day left every subscription on the dead key; the repair
 * lived only in the Settings element, which most members never open, so they
 * would have stopped being notified without a word. These tests drive the
 * shared repair with fake browser objects: what it leaves alone, that a
 * current subscription costs no write, the move itself in its order, the
 * WebKit case where subscribe() needs a gesture (and gets one from the next
 * tap anywhere, started inside the handler), the half-done move surviving to
 * the next open, and the laws around where it runs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { healPushSubscription, urlBase64ToUint8Array, sameBytes } from '../../app/push.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

/* two distinct 65-byte P-256 points, as the worker serves them */
const point = (fill) => { const b = new Uint8Array(65); b[0] = 4; b.fill(fill, 1); return b; };
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const OLD = point(1), NEW = point(2);

function world({ key = 'K', owner = 'K', perm = 'granted', pending = '', served = b64u(NEW),
  sub = 'old', pm = true, refuseUntilGesture = false } = {}) {
  const log = [];
  const state = { pending, gesture: null, inGesture: false, healed: 0, sub: null };
  const makeSub = (bytes, name) => ({
    name,
    options: { applicationServerKey: bytes.buffer.slice(0) },
    toJSON: () => ({ endpoint: 'https://push.example/' + name }),
    unsubscribe: async () => { log.push('unsubscribe:' + name); state.sub = null; return true; },
  });
  state.sub = sub === 'old' ? makeSub(OLD, 'old') : sub === 'new' ? makeSub(NEW, 'new') : null;
  const manager = {
    getSubscription: async () => { log.push('getSubscription'); return state.sub; },
    subscribe: (o) => {
      log.push('subscribe' + (state.inGesture ? '@gesture' : ''));
      if (refuseUntilGesture && !state.inGesture) return Promise.reject(new Error('NotAllowedError'));
      assert.ok(sameBytes(o.applicationServerKey, NEW), 'subscribes on the SERVED key');
      state.sub = makeSub(NEW, 'fresh');
      return Promise.resolve(state.sub);
    },
  };
  const env = {
    key: () => key,
    owner: () => owner,
    pending: () => state.pending,
    setPending: (v) => { state.pending = v; },
    permission: () => perm,
    pushManager: async () => (pm ? manager : null),
    getJson: async (url) => { log.push('GET ' + url); return { ok: true, key: served }; },
    postJson: async (url, body) => { log.push('POST ' + url + ' ' + JSON.parse(body.token).endpoint); return { ok: true }; },
    onNextGesture: (run) => { log.push('gesture armed'); state.gesture = run; },
    healed: () => { state.healed++; },
  };
  const tap = async () => {
    state.inGesture = true; state.gesture(); state.inGesture = false;
    await new Promise((r) => setTimeout(r, 0));
  };
  return { env, log, state, tap };
}

test('the key decoder and the byte compare are the ones the worker key needs', () => {
  assert.ok(sameBytes(urlBase64ToUint8Array(b64u(NEW)), NEW));
  assert.equal(sameBytes(OLD, NEW), false);
  assert.equal(sameBytes(null, NEW), false);
});

test('it leaves alone every device that is not this member\'s own, with push on — and asks the network nothing', async () => {
  for (const [label, opts] of [
    ['no identity', { key: '' }],
    ['permission not granted', { perm: 'default' }],
    ['push turned on by someone else', { owner: 'SOMEONE' }],
    ['no service worker', { pm: false }],
    ['no subscription and no unfinished move', { sub: null }],
  ]) {
    const w = world(opts);
    assert.equal(await healPushSubscription(w.env), 'skipped', label);
    assert.ok(!w.log.some((l) => l.startsWith('GET') || l.startsWith('POST') || l.startsWith('subscribe')), label + ': no read, no write');
  }
});

test('a subscription already on the served key costs one read and no write', async () => {
  const w = world({ sub: 'new' });
  assert.equal(await healPushSubscription(w.env), 'current');
  assert.deepEqual(w.log.filter((l) => l.startsWith('POST') || l.startsWith('subscribe')), []);
});

test('a rotated key moves the subscription, in order, and registers the new token', async () => {
  const w = world();
  assert.equal(await healPushSubscription(w.env), 'rotated');
  assert.deepEqual(w.log.filter((l) => l !== 'getSubscription'), [
    'GET /api/comments/push/vapid-key',
    'unsubscribe:old',                                                    // a new key beside a live one is refused
    'POST /api/comments/push/unregister https://push.example/old',        // the dead token leaves the server
    'subscribe',
    'POST /api/comments/push/register https://push.example/fresh',
  ]);
  assert.equal(w.state.pending, '', 'the move is finished');
});

test('WebKit: refused without a gesture, it finishes on the next tap anywhere — subscribe() started inside the handler', async () => {
  const w = world({ refuseUntilGesture: true });
  assert.equal(await healPushSubscription(w.env), 'deferred');
  assert.equal(w.state.pending, 'K', 'the unfinished move is remembered for the next open');
  assert.ok(w.log.includes('gesture armed'), 'no toggle: the next tap is enough');
  await w.tap();
  assert.ok(w.log.includes('subscribe@gesture'), 'subscribe() ran while the gesture was live');
  assert.ok(w.log.includes('POST /api/comments/push/register https://push.example/fresh'));
  assert.equal(w.state.pending, '', 'and the move is marked done');
  assert.equal(w.state.healed, 1, 'an open Settings sheet is told, so its toggle catches up');
});

test('a move left unfinished (the app closed before the tap) is completed on the next open', async () => {
  const w = world({ sub: null, pending: 'K' });
  assert.equal(await healPushSubscription(w.env), 'rotated');
  assert.ok(w.log.includes('subscribe'));
  assert.ok(w.log.includes('POST /api/comments/push/register https://push.example/fresh'));
  assert.equal(w.state.pending, '');
});

test('subscribed but never registered (the register call failed): the next open registers it', async () => {
  const w = world({ sub: 'new', pending: 'K' });
  assert.equal(await healPushSubscription(w.env), 'current');
  assert.ok(w.log.includes('POST /api/comments/push/register https://push.example/new'));
  assert.equal(w.state.pending, '');
});

test('single-flight: the shell and an opening Settings sheet asking at once run it once', async () => {
  const w = world({ sub: 'new' });
  const [a, b] = await Promise.all([healPushSubscription(w.env), healPushSubscription(w.env)]);
  assert.equal(a, 'current'); assert.equal(b, 'current');
  assert.equal(w.log.filter((l) => l === 'getSubscription').length, 1);
});

test('where it runs: once per document from the shell, and Settings shares it rather than keeping its own', () => {
  const shell = read('app', 'shell.ts');
  assert.equal((shell.match(/\binstallPushHeal\(\)/g) || []).length, 1, 'the shell starts it exactly once');
  const boots = shell.slice(shell.indexOf('function boots()'), shell.indexOf('function boots()') + 2000);
  assert.ok(!/installPushHeal|healPushSubscription/.test(boots), 'never per soft hop');
  const push = read('app', 'push.ts');
  assert.ok(!/setInterval/.test(push), 'a one-shot per open, never a poller');
  const chrome = read('app', 'appchrome.ts');
  const reflect = chrome.slice(chrome.indexOf('async _reflectPush()'), chrome.indexOf('async _togglePush()'));
  assert.ok(/await healPushSubscription\(browserPushEnv\(\)\)/.test(reflect), 'Settings runs the shared repair');
  assert.ok(!/\.unsubscribe\(\)/.test(reflect), 'and no longer carries a second copy of the move');
  assert.ok(!/function urlBase64ToUint8Array|function sameBytes/.test(chrome), 'one copy of the key helpers');
  assert.ok(/removeEventListener\('mc-push-healed', this\._onPushHealed\)/.test(chrome), 'the element lets go of its listener');
});
