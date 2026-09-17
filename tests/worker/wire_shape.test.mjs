/* The worker notes an answer that breaks a list Domain.Wire promises
 * (2026-09-17, comments-worker/src/serve.ts) — RUN, not read.
 *
 * What would break silently: `/api/comments/recent` answered `items` as one
 * object for six weeks, every reader's view said "Nothing here yet", and the
 * owner heard nothing. A successful JSON answer whose listed field is present
 * and neither a list nor null is now noted (`ops_shapes`), told once a day per
 * road, and turns the health verdict red; the answer itself still goes (the
 * reader's view refuses it). An absent or null field, a refusal, a non-JSON or
 * an unlisted route is none of this. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../../comments-worker/src/serve.ts';
import { readOps } from '../../comments-worker/src/ops.ts';
import { makeEnv, freshDb, ctx, resetCaches } from '../_support/worker.mjs';

beforeEach(() => { resetCaches(); });

function alertingEnv() {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?, ?, 1, 'test')");
  ins.run('alert_email', 'owner@example.org');
  ins.run('alert_email_on', '1');
  ins.run('alert_discord_on', '0');
  return { db, env: makeEnv({ db }) };
}
const shapes = (db) => {
  const row = db.prepare("SELECT v FROM app_settings WHERE k = 'ops_shapes'").get();
  return row ? JSON.parse(row.v).rows : [];
};
const answering = (body, init = {}) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body),
  { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const ask = async (env, path, route, method = 'GET') => {
  const cx = ctx();
  const r = await serve(new Request('https://merecatholicity.com' + path, { method }), env, cx, route);
  await cx.settle();
  return r;
};

test('the leak\'s shape — items as one object — is answered, noted, told once, and turns the verdict red', async () => {
  const { db, env } = alertingEnv();
  const r = await ask(env, '/api/comments/recent', answering({ ok: true, items: { DB: {}, SITE: 'x' }, page: 1, more: false }));
  assert.equal(r.status, 200, 'the answer still goes: the reader\'s view is the one that refuses it');
  assert.deepEqual((await r.json()).items, { DB: {}, SITE: 'x' });
  const rows = shapes(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].site, rows[0].names], ['GET /api/comments/recent', ['items']]);
  assert.equal(env.emails.length, 1);
  assert.match(env.emails[0].subject, /Answer with a broken shape: GET \/api\/comments\/recent/);
  const h = await readOps(env);
  assert.equal(h.ok, false);
  assert.equal(h.shapes[0].standing, true);
});

test('an absent or null list, a refusal, an error status, text, or an unlisted route is no broken shape', async () => {
  const { db, env } = alertingEnv();
  await ask(env, '/api/comments/search', answering({ ok: true, total: 0 }));                 // absent
  await ask(env, '/api/comments/board/cat', answering({ ok: true, topics: null }));          // null
  await ask(env, '/api/comments/board/author', answering({ ok: false, error: 'No.' }));      // a refusal
  await ask(env, '/api/comments/dm/directory', answering({ ok: true, users: 'x' }, { status: 404 }));  // not a success
  await ask(env, '/api/comments/config', answering('{"ok":true,"cats":"x"}', { headers: { 'Content-Type': 'text/plain' } }));
  await ask(env, '/api/comments/board', answering({ ok: true, cats: 'a map, not a list' }));  // not listed
  await ask(env, '/api/comments/recent', answering({ ok: true, items: [] }), 'POST');        // the method is part of the route
  await ask(env, '/api/comments/recent', answering({ ok: true, items: [{ id: 1 }] }));      // a list: fine
  assert.deepEqual(shapes(db), []);
  assert.equal(env.emails.length, 0);
});

test('the same broken road twice is told once, and a keyed POST read is checked by its method', async () => {
  const { db, env } = alertingEnv();
  await ask(env, '/api/comments/dm/threads', answering({ ok: true, threads: {} }), 'POST');
  await ask(env, '/api/comments/dm/threads', answering({ ok: true, threads: {} }), 'POST');
  const rows = shapes(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].site, rows[0].names], ['POST /api/comments/dm/threads', ['threads']]);
  assert.equal(env.emails.length, 1, 'told once');
});
