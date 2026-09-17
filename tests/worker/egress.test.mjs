/* The egress guard (comments-worker/src/egress.ts, 2026-09-17) — RUN, not read.
 *
 * What would break silently: for six weeks `GET /api/comments/recent` answered
 * with the worker's whole env, because a handler handed `env` to a row mapper
 * whose first act was `Object.assign({}, row)`. Two walls stand now, and this
 * file proves each one bites:
 *  - the SEAL: the env a handler sees reads like the env, but copying,
 *    listing, serializing or writing it throws — and a throw a handler
 *    swallows is still reported;
 *  - the SCAN: an answer or a hub frame carrying the value of any non-public
 *    env string never leaves; the usual 500 goes instead, the owner is told
 *    once (then at most hourly), and only the secret's NAME is ever written.
 * Plus the lists the scan trusts (the public vars) held to wrangler.jsonc, and
 * the entries that must seal, held to the source. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EnvLeak, MIN_SECRET_LENGTH, REFUSAL_TEXT, deriveEnv, guardResponse, leakedNames, sealEnv,
  secretValues, shortSecrets, takeTrips,
} from '../../comments-worker/src/egress.ts';
import { PUBLIC_VARS, UNSCANNED } from '../../comments-worker/src/env.ts';
import { PUBLIC_VARS as CONTACT_PUBLIC } from '../../contact-worker/src/vars.ts';
import { withNames } from '../../comments-worker/src/db.ts';
import { readOps, runSelfCheck } from '../../comments-worker/src/ops.ts';
import { serve } from '../../comments-worker/src/serve.ts';
import { loadWorker, makeEnv, freshDb, call, ctx, netSpy, resetCaches, identity } from '../_support/worker.mjs';
import { fakeCtx } from '../_support/hub_runtime.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(join(root, rel), 'utf8');
/* wrangler.jsonc without its comments (strings kept whole) */
const jsonc = (rel) => JSON.parse(src(rel).replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : '')));

const SECRET = 'mc-egress-sentinel-7c1e9b2d44';   // long enough to be scanned for
const tally = (db) => {
  const row = db.prepare("SELECT v FROM app_settings WHERE k = 'ops_egress'").get();
  return row ? JSON.parse(row.v).rows : [];
};
function alertingDb() {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?, ?, 1, 'test')");
  ins.run('alert_email', 'owner@example.org');
  ins.run('alert_email_on', '1');
  ins.run('alert_discord_on', '0');
  return db;
}

let worker, BoardHub, net;
before(async () => { ({ worker, BoardHub } = await loadWorker()); });
beforeEach(() => { resetCaches(); });

/* ---- the seal ------------------------------------------------------------ */

test('the sealed env reads like the env, and refuses to be copied, listed, serialized or written', () => {
  const raw = { DB: { tag: 'db' }, SITE: 'https://merecatholicity.com', TURN_KEY_SECRET: SECRET };
  const env = sealEnv(raw);
  assert.equal(env.SITE, raw.SITE);
  assert.equal(env.DB, raw.DB);
  assert.equal(env.TURN_KEY_SECRET, SECRET, 'a handler that needs a secret still reads it by name');
  assert.ok('DB' in env && !('NOPE' in env));
  const { DB, SITE } = env;
  assert.equal(DB, raw.DB);
  assert.equal(SITE, raw.SITE);
  assert.equal(String(env), '[object Object]');
  const refused = {
    'Object.assign': () => Object.assign({}, env),
    'a spread': () => ({ ...env }),
    'JSON.stringify': () => JSON.stringify(env),
    'JSON.stringify of a holder': () => JSON.stringify({ ok: true, items: env }),
    'Object.keys': () => Object.keys(env),
    'Object.entries': () => Object.entries(env),
    'for…in': () => { for (const k in env) void k; },
    'Reflect.ownKeys': () => Reflect.ownKeys(env),
    'Object.getOwnPropertyDescriptors': () => Object.getOwnPropertyDescriptors(env),
    'a rest pattern': () => { const { SITE: _s, ...rest } = env; return rest; },
    'a write': () => { env.SITE = 'x'; },
    'a new property': () => Object.defineProperty(env, 'X', { value: 1 }),
    'a delete': () => { delete env.SITE; },
  };
  for (const [what, f] of Object.entries(refused)) assert.throws(f, EnvLeak, what);
  assert.throws(() => structuredClone(env), 'a proxy never clones');
  assert.equal(raw.SITE, 'https://merecatholicity.com', 'the raw env is untouched');
  const trips = takeTrips(env);
  assert.ok(trips.length >= Object.keys(refused).length, 'every refusal is remembered for the entry to report');
  assert.deepEqual(takeTrips(env), [], 'and reported once');
});

test('the very bug: handing the env to the row mapper now throws instead of copying every secret', () => {
  const env = sealEnv({ DB: {}, TURN_KEY_SECRET: SECRET });
  assert.throws(() => withNames(env, []), EnvLeak);
  assert.deepEqual(takeTrips(env), ['enumerated']);
});

test('each request gets its own seal; a derived env (the D1 session) keeps the seal and shares the trips', () => {
  const raw = { DB: 'binding', SITE: 'https://merecatholicity.com', TURN_KEY_SECRET: SECRET };
  const a = sealEnv(raw);
  const b = sealEnv(raw);
  assert.notEqual(a, b, 'a trip in one request is not reported by another');
  const derived = deriveEnv(a, { DB: 'session' });
  assert.equal(derived.DB, 'session');
  assert.equal(derived.SITE, raw.SITE);
  assert.equal(a.DB, 'binding', 'the base keeps its own binding');
  assert.throws(() => Object.assign({}, derived), EnvLeak);
  assert.deepEqual(takeTrips(a), ['enumerated'], 'the request hears of a trip made through the derived env');
  assert.deepEqual(takeTrips(b), []);
  assert.deepEqual(secretValues(derived, UNSCANNED), [['TURN_KEY_SECRET', SECRET]]);
  /* an unsealed base (a unit test calling the helper directly) keeps the prototype road */
  const plain = deriveEnv(raw, { DB: 'session' });
  assert.equal(plain.DB, 'session');
  assert.equal(plain.SITE, raw.SITE);
});

/* ---- the scan ------------------------------------------------------------ */

test('the scan looks for every non-public env string long enough to find, and for nothing else', () => {
  const raw = {
    DB: { binding: true }, READ_LIMIT: { limit() {} }, HUB_SHARDS: '2',
    SITE: 'https://merecatholicity.com/a/long/public/value',
    VAPID_PUBLIC_KEY: 'B'.repeat(87),
    TURNSTILE_SECRET: '0x4AAAAAAAsecret-for-the-test',
    A_SECRET_NOBODY_LISTED: 'n'.repeat(MIN_SECRET_LENGTH),
    TEST_HASHES: 'a'.repeat(64) + ',' + 'b'.repeat(64),
    SHORT: 'abc',
    EMPTY: '',
    NUMBER: 5,
  };
  const want = [['TURNSTILE_SECRET', raw.TURNSTILE_SECRET], ['A_SECRET_NOBODY_LISTED', raw.A_SECRET_NOBODY_LISTED]];
  assert.deepEqual(secretValues(raw, UNSCANNED), want, 'default-deny: a secret nobody listed is scanned for');
  assert.deepEqual(secretValues(sealEnv(raw), UNSCANNED), want, 'the same census from the sealed env');
  assert.deepEqual(shortSecrets(sealEnv(raw), UNSCANNED), ['SHORT'], 'a short secret is named for the self-check');
  assert.deepEqual(leakedNames('{"q":"0x4AAAAAAAsecret-for-the-test"}', want), ['TURNSTILE_SECRET']);
  assert.deepEqual(leakedNames('{"q":"0x4AAAAAAAsecret"}', want), [], 'a fragment is not the secret');
});

test('guardResponse refuses a textual answer that carries a secret, and leaves everything else as it was', async () => {
  const secrets = [['S', SECRET]];
  const run = async (res) => {
    const names = [];
    const out = await guardResponse(res, secrets, (n) => names.push(...n));
    return { out, names };
  };
  for (const type of ['application/json', 'text/html; charset=utf-8', 'text/plain', 'application/rss+xml', 'application/problem+json']) {
    const { out, names } = await run(new Response('{"leak":"' + SECRET + '"}', { status: 200, headers: { 'Content-Type': type } }));
    assert.equal(out.status, 500, type);
    assert.deepEqual(await out.json(), { ok: false, error: REFUSAL_TEXT }, type);
    assert.deepEqual(names, ['S'], type);
  }
  /* an SVG is XML a browser renders: read like the rest */
  const svg = await run(new Response('<svg><text>' + SECRET + '</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } }));
  assert.equal(svg.out.status, 500);
  /* a secret in a HEADER is refused on any answer, a bodiless redirect included, URL-encoded or not */
  for (const location of ['https://merecatholicity.com/?t=' + SECRET, 'https://merecatholicity.com/?t=' + encodeURIComponent(SECRET + ' /&')]) {
    const odd = [['S', SECRET], ['T', SECRET + ' /&']];
    const names = [];
    const out = await guardResponse(new Response(null, { status: 302, headers: { Location: location } }), odd, (n) => names.push(...n));
    assert.equal(out.status, 500, location);
    assert.ok(names.length >= 1, location);
  }
  /* a secret the answer escaped is still the secret: inside a JSON string, inside HTML */
  const quirky = 'mc-"quoted"\\secret<&>\'value-0042';
  const q = [['Q', quirky]];
  for (const [type, body] of [['application/json', JSON.stringify({ v: quirky })],
    ['text/html', '<p>' + quirky.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</p>']]) {
    const names = [];
    const out = await guardResponse(new Response(body, { headers: { 'Content-Type': type } }), q, (n) => names.push(...n));
    assert.equal(out.status, 500, type + ' ' + body);
    assert.deepEqual(names, ['Q']);
  }
  /* binary, typeless, bodiless and upgraded answers are not read */
  const image = new Response(SECRET, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  assert.equal((await run(image)).out, image);
  const stream = new Response(new Blob([SECRET]).stream(), { status: 200 });
  assert.equal((await run(stream)).out, stream);
  const empty = new Response(null, { status: 204 });
  assert.equal((await run(empty)).out, empty);
  const upgraded = new Response(null, { status: 101, webSocket: {} });
  assert.equal((await run(upgraded)).out, upgraded);
  /* a clean answer goes out with its status, headers and bytes */
  const clean = new Response('{"ok":true}', { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
  const { out, names } = await run(clean);
  assert.deepEqual(names, []);
  assert.equal(out.status, 201);
  assert.equal(out.statusText, 'Created');
  assert.equal(out.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(await out.text(), '{"ok":true}');
});

/* ---- through the worker ------------------------------------------------- */

test('a real route that would echo a secret answers the usual 500; the owner is told once, by name only', async () => {
  net = netSpy();
  try {
    const db = alertingDb();
    const env = makeEnv({ db, vars: { TURN_KEY_SECRET: SECRET } });
    /* the search route echoes its query: a caller who already knew the secret is the only way to make it carry one */
    const r = await call(worker, env, 'GET', '/api/comments/search?q=' + encodeURIComponent(SECRET));
    await r.ctx.settle();
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { ok: false, error: REFUSAL_TEXT });
    assert.ok(!r.text.includes(SECRET));
    const rows = tally(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'answer');
    assert.equal(rows[0].site, 'GET /api/comments/search');
    assert.deepEqual(rows[0].names, ['TURN_KEY_SECRET']);
    assert.equal(env.emails.length, 1, 'told at once');
    const mail = env.emails[0];
    assert.match(mail.subject, /Answer refused/);
    assert.match(mail.text, /TURN_KEY_SECRET/);
    assert.ok(!JSON.stringify(mail).includes(SECRET), 'the alert names the secret, never carries it');
    assert.ok(!db.prepare("SELECT v FROM app_settings WHERE k = 'ops_egress'").get().v.includes(SECRET));
    /* the health verdict turns red for a day */
    const h = await readOps(env);
    assert.equal(h.ok, false);
    assert.equal(h.egress[0].standing, true);
    /* again within the minute: the same answer refused, no second mail */
    const again = await call(worker, env, 'GET', '/api/comments/search?q=' + encodeURIComponent(SECRET));
    await again.ctx.settle();
    assert.equal(again.status, 500);
    assert.equal(env.emails.length, 1, 'no flood');
    /* a public var's value, echoed, is no secret */
    const pub = await call(worker, env, 'GET', '/api/comments/search?q=' + encodeURIComponent('https://merecatholicity.com'));
    assert.equal(pub.status, 200);
  } finally { net.restore(); }
});

test('a handler that copies the env is refused with the usual 500, and one that swallows the throw is reported anyway', async () => {
  const db = alertingDb();
  const env = makeEnv({ db, vars: { TURN_KEY_SECRET: SECRET } });
  const copying = async (_request, e) => new Response(JSON.stringify({ ok: true, items: Object.assign({}, e) }), { headers: { 'Content-Type': 'application/json' } });
  const cx = ctx();
  const r = await serve(new Request('https://merecatholicity.com/api/comments/copying'), env, cx, copying);
  await cx.settle();
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { ok: false, error: REFUSAL_TEXT });
  const swallowing = async (_request, e) => {
    let copy = null;
    try { copy = JSON.stringify(e); } catch (err) { /* a handler's own catch */ }
    return new Response(JSON.stringify({ ok: true, copy }), { headers: { 'Content-Type': 'application/json' } });
  };
  const cx2 = ctx();
  const r2 = await serve(new Request('https://merecatholicity.com/api/comments/swallowing'), env, cx2, swallowing);
  await cx2.settle();
  assert.equal(r2.status, 200, 'the handler chose to answer; the seal still kept the env out of it');
  assert.deepEqual(await r2.json(), { ok: true, copy: null });
  const rows = tally(db);
  assert.deepEqual(rows.map((x) => [x.kind, x.site]).sort(), [
    ['enumerated', 'GET /api/comments/copying'],
    ['enumerated', 'GET /api/comments/swallowing'],
  ]);
  assert.equal(env.emails.length, 2);
  assert.match(env.emails[0].subject, /sealed env was enumerated/);
  /* a handler that reads a secret by name and puts it in the answer */
  const naming = async (_request, e) => new Response('<p>' + e.TURN_KEY_SECRET + '</p>', { headers: { 'Content-Type': 'text/html' } });
  const cx3 = ctx();
  const r3 = await serve(new Request('https://merecatholicity.com/@someone'), env, cx3, naming);
  await cx3.settle();
  assert.equal(r3.status, 500);
  const card = tally(db).find((x) => x.kind === 'answer');
  assert.equal(card.site, 'GET /@…', 'a handle card is reported by its road, never by the member it names');
});

test('a hub frame that carries a secret never reaches a socket; a clean one still does', async () => {
  const db = alertingDb();
  const hubs = new Map();
  const namespace = { idFromName: (n) => n, get: (n) => hubs.get(n) };
  const env = makeEnv({ db, hub: { namespace }, vars: { HUB_SHARDS: '1', TURN_KEY_SECRET: SECRET } });
  const tasks = [];
  const state = { ...fakeCtx('board'), waitUntil: (p) => tasks.push(p) };
  const hub = new BoardHub(state, env);
  hubs.set('board', hub);
  const up = await hub.fetch(new Request('https://merecatholicity.com/api/comments/live', { headers: { Upgrade: 'websocket' } }));
  assert.ok(up.upgraded);
  const ws = state.sockets[state.sockets.length - 1];
  await hub.webSocketMessage(ws, JSON.stringify({ t: 'sub', scope: ['cat:pub'] }));
  await hub.publish({ v: 1, t: 'new-topic', scopes: ['cat:pub'], id: 1, title: 'about ' + SECRET });
  await hub.publish({ v: 1, t: 'new-topic', scopes: ['cat:pub'], id: 2, title: 'a clean title' });
  await Promise.allSettled(tasks);
  const topics = ws.sent.filter((f) => f.t === 'new-topic');
  assert.deepEqual(topics.map((f) => f.id), [2]);
  assert.ok(!JSON.stringify(ws.sent).includes(SECRET));
  const rows = tally(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kind, rows[0].site, rows[0].names], ['frame', 'BoardHub', ['TURN_KEY_SECRET']]);
  assert.equal(env.emails.length, 1);
  /* the hub's own env is sealed too */
  assert.throws(() => Object.keys(hub.env), EnvLeak);
  takeTrips(hub.env);
});

test('the self-check names a secret too short for the scan to guard', async () => {
  const db = freshDb();
  const env = sealEnv(makeEnv({ db, vars: { A_SHORT_SECRET: 'abc123', TURN_KEY_SECRET: SECRET } }));
  const conds = await runSelfCheck(env);
  assert.deepEqual(conds.filter((c) => c.kind === 'secret_short').map((c) => c.subject), ['A_SHORT_SECRET']);
});

/* ---- the lists the scan trusts, and the entries that must seal ---------- */

test('the public vars are exactly the vars env.ts declares, and cover every var wrangler.jsonc sets', () => {
  const envSrc = src('comments-worker/src/env.ts');
  const section = envSrc.slice(envSrc.indexOf('/* vars'), envSrc.indexOf('/* secrets'));
  const declared = [...section.matchAll(/^\s*([A-Z][A-Z0-9_]*)\?: string;/gm)].map((m) => m[1]).sort();
  assert.deepEqual([...PUBLIC_VARS].sort(), declared, 'PUBLIC_VARS lists the vars section of Env, no more, no less');
  const w = jsonc('comments-worker/wrangler.jsonc');
  const set = [...Object.keys(w.vars || {}), ...Object.values(w.env || {}).flatMap((e) => Object.keys(e.vars || {}))];
  assert.deepEqual(set.filter((k) => !PUBLIC_VARS.includes(k)), [], 'a var in wrangler.jsonc is public by definition: declare it');
  const secretsAt = envSrc.indexOf('/* secrets');
  const secretsSection = envSrc.slice(secretsAt, envSrc.indexOf('\n}\n', secretsAt));
  const secrets = [...secretsSection.matchAll(/^\s*([A-Z][A-Z0-9_]*)\?: string;/gm)].map((m) => m[1]);
  assert.ok(secrets.length >= 5);
  assert.deepEqual(secrets.filter((k) => PUBLIC_VARS.includes(k)), [], 'no secret is declared public');
  assert.deepEqual(UNSCANNED.filter((k) => !PUBLIC_VARS.includes(k)), ['TEST_HASHES'], 'the one unscanned secret is the hash list');
  /* the contact worker */
  const c = jsonc('contact-worker/wrangler.jsonc');
  assert.deepEqual(Object.keys(c.vars || {}).filter((k) => !CONTACT_PUBLIC.includes(k)), []);
  const contactSrc = src('contact-worker/src/index.ts');
  for (const k of CONTACT_PUBLIC) assert.match(contactSrc, new RegExp('\\b' + k + '\\?: string;'), k + ' is an optional var of the contact Env');
  for (const k of ['TURNSTILE_SECRET', 'CONTACT_TO']) assert.ok(!CONTACT_PUBLIC.includes(k), k + ' is scanned');
});

test('every entry seals the env, and every frame leaves through the guarded helper', () => {
  const index = src('comments-worker/src/index.ts');
  assert.match(index, /fetch\(request: Request, env: Env, ctx: ExecutionContext\) \{\s*return serve\(request, env, ctx, route\);\s*\}/,
    'default.fetch is serve() over the router');
  assert.match(index, /async scheduled\(event: ScheduledController, rawEnv: Env, ctx: ExecutionContext\) \{\s*const env = sealEnv\(rawEnv\);/,
    'the crons run against the sealed env');
  assert.ok(!/\basync fetch\(request: Request, env: Env/.test(index), 'no second fetch entry');
  const serveSrc = src('comments-worker/src/serve.ts');
  assert.match(serveSrc, /const env = sealEnv\(rawEnv\);/);
  assert.match(serveSrc, /return guardResponse\(res, secretValues\(rawEnv, UNSCANNED\)/);
  const hub = src('comments-worker/src/durable.ts');
  assert.equal((hub.match(/super\(ctx, sealEnv\(env\)\);/g) || []).length, 2, 'both Durable Objects seal');
  assert.ok(!/super\(ctx, env\)/.test(hub));
  const sends = [...hub.matchAll(/\bws\.send\(/g)];
  assert.equal(sends.length, 2, 'one send per object');
  for (const m of sends) {
    const before = hub.slice(0, m.index);
    const helper = before.lastIndexOf('#send(ws: WebSocket');
    assert.ok(helper > -1 && !/\n  (?:async )?#?[a-zA-Z]+\(/.test(before.slice(before.indexOf('\n', helper))),
      'the send sits inside #send, behind the scan');
  }
  const contact = src('contact-worker/src/index.ts');
  assert.match(contact, /async fetch\(request: Request, rawEnv: Env\) \{\s*const env = sealEnv\(rawEnv\);\s*const res = await handle\(request, env\);\s*return guardResponse\(res, secretValues\(rawEnv, PUBLIC_VARS\)/);
  const session = src('comments-worker/src/dbsession.ts');
  assert.match(session, /deriveEnv\(env, \{ DB: db \}\)/, 'the D1 session derives a sealed env');
  assert.ok(!/Object\.create\(env\)/.test(session));
});
