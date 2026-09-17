/* Every answer keeps the shape it was committed with (2026-09-17).
 *
 * What would break silently: an answer that grows a key (the env copied into
 * `items` grew thirty), loses one a client reads, or turns a list into an
 * object. The leak sweep's answers are read into key paths and types
 * (tests/_support/shapes.mjs) and held to tests/_support/response_shapes.json:
 * a change to what a route answers is a reviewable diff of that file —
 * `node scripts/response_shapes.mjs --write` — and a new key of a public answer
 * goes into comments-worker/API.md in the same commit (tests/py/
 * test_api_parity.py holds the public reads' top-level keys to it). The lists
 * a successful answer always carries are held to Domain.Wire, which the worker
 * and the client both check at run time. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as Wire from '../../purescript/output/Domain.Wire/index.js';
import { runSweep, ROUTES } from '../_support/sweep.mjs';
import { shapeSnapshot, shapeDiff, DYNAMIC } from '../_support/shapes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { _dynamic: dynamic, ...want } = JSON.parse(readFileSync(join(root, 'tests', '_support', 'response_shapes.json'), 'utf8'));

let got;
before(async () => {
  const log = console.log;
  console.log = () => {};
  try { got = shapeSnapshot((await runSweep()).calls); } finally { console.log = log; }
});

test('the snapshot names every route the worker mounts, and nothing else', () => {
  assert.deepEqual(Object.keys(want).sort(), ROUTES.map((r) => r.m + ' ' + r.p).sort());
});

test('the snapshot carries the data-keyed maps the nightly reads', () => {
  assert.deepEqual(dynamic, DYNAMIC);
});

test('every answer has the committed shape: no new key, no lost key, no changed type', () => {
  assert.deepEqual(shapeDiff(want, got), [],
    'run `node scripts/response_shapes.mjs --write`, review the diff, and document a new public key in API.md');
});

test('the lists a successful answer always carries are the ones Domain.Wire promises', () => {
  const table = Object.fromEntries(Wire.lists.map((r) => [r.route, r.fields]));
  const drift = [];
  for (const [route, shape] of Object.entries(want)) {
    const promised = table[route] || [];
    if (JSON.stringify(promised) !== JSON.stringify(shape.lists)) drift.push(`${route}: Wire ${JSON.stringify(promised)}, answered ${JSON.stringify(shape.lists)}`);
  }
  assert.deepEqual(drift, [], 'purescript/src/Domain/Wire.purs lists what the answers carry');
});

test('the leak that started this is a shape change the snapshot refuses', () => {
  const recent = want['GET /api/comments/recent'];
  assert.ok(recent.json.includes('items:array') && recent.json.includes('items[]:object'));
  const broken = JSON.parse(JSON.stringify(want));
  const leaked = broken['GET /api/comments/recent'];
  leaked.json = leaked.json.filter((p) => !p.startsWith('items')).concat(['items:object', 'items.TURNSTILE_SECRET:string']);
  const diff = shapeDiff(want, broken);
  assert.ok(diff.some((d) => /new .*items\.TURNSTILE_SECRET:string/.test(d)), diff.join('\n'));
  assert.ok(diff.some((d) => /gone .*items:array/.test(d)), diff.join('\n'));
});
