/* The pipeline's doors, keyless (2026-09-17).
 *
 * What would break silently: until today merecat.yml and ops-watch.yml
 * opened the worker's pipeline doors with one static key, MERECAT_INGEST_KEY,
 * and the env disclosure published it — whoever read it could rewrite the
 * librarian's shelf, persona and dials. Now a job sends the OIDC token GitHub
 * signed for its run, and oidc.ts checks the signature against GitHub's keys
 * before Domain.Pipeline reads the claims. A verifier that accepts a token it
 * should not — another key, no signature, a swapped payload, a refused token
 * falling through to a key — would change nothing anyone could see. So: RUN
 * every door through the router on the workers.dev front door, with tokens
 * from a stand-in issuer (tests/_support/github_oidc.mjs), and read what each
 * one opened. The claims policy has its own spec (tests/purescript/
 * pipeline.test.mjs). */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, freshLibDb, identity, resetCaches, call, netSpy } from '../_support/worker.mjs';
import { githubIssuer } from '../_support/github_oidc.mjs';
import { keyCache } from '../../comments-worker/src/oidc.ts';

const HOST = 'https://merecatholicity-comments.support-609.workers.dev';
const REPORT_KEY = 'the-dev-box-nightly-report-key';
let worker, gh, stranger, ADMIN, net, logs, log;

before(async () => {
  ({ worker } = await loadWorker());
  gh = await githubIssuer();
  stranger = await githubIssuer();   // the same kid, another key: a forger's issuer
  ADMIN = await identity('pipeline-admin');
});
beforeEach(() => {
  resetCaches();
  net = netSpy((url) => gh.serves(url));
  logs = [];
  log = console.log;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
});
afterEach(() => { net.restore(); console.log = log; });

function env(vars = {}) {
  return makeEnv({ db: freshDb(), libdb: freshLibDb(), vars: { ADMIN_HASHES: ADMIN.hash, OPS_REPORT_KEY: REPORT_KEY, ...vars } });
}
const bearer = (token) => ({ host: HOST, origin: null, headers: { Authorization: 'Bearer ' + token } });
const asRunner = { host: HOST, origin: null };
const said = (event) => logs.filter((l) => l.includes('"event":"' + event + '"')).map((l) => JSON.parse(l));
const jwksAsked = () => net.calls.filter((c) => c.url === 'https://token.actions.githubusercontent.com/.well-known/jwks').length;
const libConfig = async (e, k) => {
  const r = await e.LIBDB.prepare('SELECT v FROM config WHERE k = ?').bind(k).first();
  return r ? r.v : null;
};

test('the librarian\'s job opens the corpus doors with its token alone, and the key set is fetched once', async () => {
  const e = env();
  const token = await gh.token('ingest');
  let r = await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(token));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.persona_file_hash, r.json.config_file_hash], ['', ''], 'the roster names both file hashes');
  r = await call(worker, e, 'POST', '/api/merecat/ingest', { mode: 'begin', work: { id: 'oidc-work', title: 'A work', url: '/w.html', tier: 1 } }, bearer(token));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(jwksAsked(), 1, 'GitHub\'s keys are cached for the isolate');
  assert.deepEqual(said('pipeline_refused'), []);
  assert.deepEqual(said('pipeline_static_key'), []);
});

test('a token GitHub did not sign opens nothing', async () => {
  const e = env();
  const good = await gh.token('ingest');
  const [head, body] = good.split('.');
  const forged = await stranger.token('ingest');
  const other = await gh.token('probe');
  const cases = {
    'another key under the same kid': forged,
    'a payload swapped under a valid signature': head + '.' + other.split('.')[1] + '.' + good.split('.')[2],
    'no signature': head + '.' + body + '.',
    'alg none': Buffer.from(JSON.stringify({ alg: 'none', kid: gh.kid })).toString('base64url') + '.' + body + '.',
    'alg HS256 over the public key': (await gh.sign(gh.claims('ingest'), { alg: 'HS256' })),
    'a critical header': (await gh.sign(gh.claims('ingest'), { crit: ['exp'] })),
    'two parts': head + '.' + body,
    'not base64url': head + '.' + body + '.a+b/c=',
  };
  for (const [name, token] of Object.entries(cases)) {
    const r = await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(token));
    assert.deepEqual([r.status, r.json.error], [403, 'No.'], name);
  }
  for (const auth of ['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer  ' + good, 'bearer ' + good, 'Bearer ' + good + ' x', '']) {
    const r = await call(worker, e, 'POST', '/api/merecat/works', {}, { host: HOST, origin: null, headers: { Authorization: auth } });
    assert.equal(r.status, 403, JSON.stringify(auth.slice(0, 12)));
  }
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(good))).status, 200, 'the real token still opens');
});

test('a refused bearer never falls through to a key in the body', async () => {
  const e = env({ MERECAT_INGEST_KEY: 'the-static-key-for-this-test' });
  const late = await gh.token('ingest', { exp: Math.floor(Date.now() / 1000) - 3600 });
  for (const key of [ADMIN.key, 'the-static-key-for-this-test']) {
    const r = await call(worker, e, 'POST', '/api/merecat/works', { key }, bearer(late));
    assert.equal(r.status, 403, 'an expired token with a good key beside it');
  }
  assert.deepEqual(said('pipeline_refused').map((x) => x.why), [['ingest: expired'], ['ingest: expired']], 'the log says why, never a claim');
});

test('the claims decide: another branch, a pull request, another workflow, a lapsed token', async () => {
  const e = env();
  const now = Math.floor(Date.now() / 1000);
  for (const [name, over, why] of [
    ['a branch', { ref: 'refs/heads/feature' }, 'not main'],
    ['a pull request', { event_name: 'pull_request_target' }, 'not a push, a schedule or a dispatch'],
    ['the watchdog\'s file', { job_workflow_ref: 'merecatholicity/merecatholicity.com/.github/workflows/ops-watch.yml@refs/heads/main' }, 'another workflow'],
    ['a fork', { repository_id: '1', repository_owner_id: '2' }, 'another repository'],
    ['GitHub\'s default audience', { aud: 'https://github.com/merecatholicity' }, 'another audience'],
    ['two audiences', { aud: ['merecatholicity-comments', 'sts.amazonaws.com'] }, 'another audience'],
    ['a self-hosted runner', { runner_environment: 'self-hosted' }, 'not a GitHub-hosted runner'],
    ['expired', { exp: now - 120 }, 'expired'],
    ['no expiry', { exp: undefined }, 'expired'],
    ['a string expiry', { exp: String(now + 300) }, 'expired'],
    ['not yet valid', { nbf: now + 600 }, 'not yet valid'],
    ['a numeric repository id', { repository_id: 1303720165 }, 'another repository'],
  ]) {
    logs.length = 0;
    const r = await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(await gh.token('ingest', over)));
    assert.equal(r.status, 403, name);
    assert.deepEqual(said('pipeline_refused')[0].why, ['ingest: ' + why], name);
  }
});

test('an unknown key is looked for once a minute at most, and an unreachable key set refuses', async () => {
  const e = env();
  const rotated = await gh.sign(gh.claims('ingest'), { kid: 'a-key-github-has-not-published' });
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(rotated))).status, 403);
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(rotated))).status, 403);
  assert.equal(jwksAsked(), 1, 'the second unknown kid inside the minute does not refetch');
  keyCache.tried -= 61_000;
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(rotated))).status, 403);
  assert.equal(jwksAsked(), 2, 'after the minute it asks again');
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(await gh.token('ingest')))).status, 200, 'a known kid needs no fetch');
  assert.equal(jwksAsked(), 2);
  /* the hour runs out: the keys are fetched again */
  keyCache.at -= 3_600_001;
  keyCache.tried -= 3_600_001;
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(await gh.token('ingest')))).status, 200);
  assert.equal(jwksAsked(), 3);

  /* GitHub down: closed, and not asked again inside the minute */
  net.restore();
  resetCaches();
  net = netSpy((url) => (url.includes('token.actions.githubusercontent.com') ? new Response('bad gateway', { status: 502 }) : null));
  const token = await gh.token('ingest');
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(token))).status, 403);
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(token))).status, 403);
  assert.equal(net.calls.length, 1);
  assert.equal(said('pipeline_keys_failed').length, 1);
  /* a key set with nothing usable in it is no key set */
  net.restore();
  resetCaches();
  net = netSpy(() => Response.json({ keys: [{ kty: 'EC', kid: gh.kid, crv: 'P-256', x: 'x', y: 'y' }, { kty: 'RSA', kid: gh.kid, alg: 'RS512', n: gh.jwks.keys[0].n, e: 'AQAB' }] }));
  assert.equal((await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(token))).status, 403);
});

test('the persona and the dials: only the job a reviewer approved, or an admin; the ingest job sets its stamp', async () => {
  const e = env();
  const ingestJob = await gh.token('ingest');
  const configJob = await gh.token('config');
  const stamp = { last_ingest: '2026-09-17T15:00:00Z', last_ingest_by: '35236215735' };
  let r = await call(worker, e, 'POST', '/api/merecat/config', { config: stamp }, bearer(ingestJob));
  assert.deepEqual([r.status, r.json.set], [200, 2], 'the ingest job stamps its run');
  assert.equal(await libConfig(e, 'last_ingest_by'), '35236215735');
  for (const [name, body] of [
    ['the persona', { persona: 'You are someone else.' }],
    ['a dial', { config: { temperature: 1.9 } }],
    ['a dial beside the stamp', { config: { ...stamp, topk: 40 } }],
    ['the persona\'s file hash', { config: { persona_file_hash: 'f'.repeat(64) } }],
    ['the dials\' file hash', { config: { config_file_hash: 'f'.repeat(64) } }],
  ]) {
    logs.length = 0;
    r = await call(worker, e, 'POST', '/api/merecat/config', body, bearer(ingestJob));
    assert.deepEqual([r.status, r.json.error], [403, 'No.'], name);
    assert.deepEqual(said('pipeline_refused')[0].why, ['config: the ingest job sets only its stamp'], name);
  }
  assert.equal(await libConfig(e, 'persona'), null, 'nothing the ingest job sent reached the persona');
  r = await call(worker, e, 'POST', '/api/merecat/config',
    { persona: 'You are merecat.', config: { topk: 12, persona_file_hash: 'a'.repeat(64), config_file_hash: 'b'.repeat(64) } }, bearer(configJob));
  assert.deepEqual([r.status, r.json.set], [200, 4], 'the approved job pushes the persona, a dial and both file hashes');
  assert.deepEqual([await libConfig(e, 'persona'), await libConfig(e, 'topk')], ['You are merecat.', '12']);
  r = await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(configJob));
  assert.deepEqual([r.status, r.json.persona_file_hash, r.json.config_file_hash], [200, 'a'.repeat(64), 'b'.repeat(64)], 'and reads the roster it compares against');
  r = await call(worker, e, 'POST', '/api/merecat/config', { key: ADMIN.key, persona: 'An admin\'s edit.' }, asRunner);
  assert.equal(r.status, 200, 'the owner, by hand');
  r = await call(worker, e, 'POST', '/api/merecat/config', { persona: 'Nobody.' }, asRunner);
  assert.equal(r.status, 403, 'no credential at all');
  r = await call(worker, e, 'POST', '/api/merecat/config', { persona: 'The watchdog.' }, bearer(await gh.token('probe')));
  assert.equal(r.status, 403, 'the watchdog\'s token is not the librarian\'s');
  assert.equal(await libConfig(e, 'persona'), 'An admin\'s edit.');
});

test('the ops door: the watchdog\'s token reads the health; the nightly\'s key reads and reports; neither opens anything else', async () => {
  const e = env();
  const watchdog = await gh.token('probe');
  let r = await call(worker, e, 'POST', '/api/comments/ops/report', { probe: true }, bearer(watchdog));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(typeof r.json.health.ok, 'boolean');
  r = await call(worker, e, 'POST', '/api/comments/ops/report', { source: 'webtest', pass: 1, fail: 0, suites: [], regressions: ['a fake regression'] }, bearer(watchdog));
  assert.equal(r.status, 403, 'the watchdog reads, never reports');
  assert.equal(e.emails.length, 0);
  r = await call(worker, e, 'POST', '/api/comments/ops/report', { probe: true }, bearer(await gh.token('ingest')));
  assert.equal(r.status, 403, 'the librarian\'s token does not probe');
  r = await call(worker, e, 'POST', '/api/merecat/works', {}, bearer(watchdog));
  assert.equal(r.status, 403, 'the watchdog\'s token does not open the shelf');

  r = await call(worker, e, 'POST', '/api/comments/ops/report', { key: REPORT_KEY, probe: true }, asRunner);
  assert.equal(r.status, 200);
  r = await call(worker, e, 'POST', '/api/comments/ops/report', { key: REPORT_KEY, source: 'webtest', pass: 30, fail: 0, suites: ['worker_reads 30/30'], regressions: [] }, asRunner);
  assert.deepEqual([r.status, r.json.stored], [200, true]);
  for (const path of ['/api/merecat/works', '/api/merecat/config', '/api/merecat/ingest']) {
    r = await call(worker, e, 'POST', path, { key: REPORT_KEY, config: { topk: 1 }, mode: 'begin', work: { id: 'x' } }, asRunner);
    assert.equal(r.status, 403, 'the report key opens ' + path);
  }
  r = await call(worker, e, 'POST', '/api/comments/admin/health', { key: REPORT_KEY });
  assert.equal(r.status, 403, 'the report key is not an admin');
  r = await call(worker, e, 'POST', '/api/comments/ops/report', { key: REPORT_KEY.slice(0, -1) + 'X', probe: true }, asRunner);
  assert.equal(r.status, 403);
  const unset = env({ OPS_REPORT_KEY: undefined });
  r = await call(worker, unset, 'POST', '/api/comments/ops/report', { key: '', probe: true }, asRunner);
  assert.equal(r.status, 403, 'an unset key matches nothing, not even an empty one');
  r = await call(worker, e, 'POST', '/api/comments/ops/report', null, asRunner);
  assert.equal(r.status, 400, 'a body that is not an object');
});

test('the static key, for the deploy the workflows take to move: it still opens the three doors, and says so', async () => {
  const e = env({ MERECAT_INGEST_KEY: 'the-static-key-for-this-test' });
  for (const [path, body] of [
    ['/api/merecat/works', {}],
    ['/api/merecat/config', { persona: 'Pushed the old way.' }],
    ['/api/comments/ops/report', { probe: true }],
  ]) {
    const r = await call(worker, e, 'POST', path, { key: 'the-static-key-for-this-test', ...body }, asRunner);
    assert.equal(r.status, 200, path);
  }
  assert.equal(said('pipeline_static_key').length, 3, 'every use is logged, so the tail shows when nothing uses it');
  const r = await call(worker, env(), 'POST', '/api/merecat/works', { key: '' }, asRunner);
  assert.equal(r.status, 403, 'an unset static key matches nothing');
});
