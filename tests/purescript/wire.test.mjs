/* Domain.Wire — the lists the wire promises (2026-09-17).
 *
 * What would break silently: `GET /api/comments/recent` answered `items` as
 * one object for six weeks and the Recent activity view read it as "nothing
 * here yet". The table names, per route, the top-level fields a successful
 * answer always carries as lists; the worker alerts and the client refuses an
 * answer where one of them is something else. That the table matches what
 * the worker really answers is tests/worker/response_shapes.test.mjs's to say;
 * this file is the rule's reading. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as Wire from '../../purescript/output/Domain.Wire/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routes = JSON.parse(readFileSync(join(root, 'tests', '_support', 'routes.json'), 'utf8')).map((r) => r.m + ' ' + r.p);

test('a route names its lists by method and path; a route not in the table has none', () => {
  assert.deepEqual(Wire.listFields('GET')('/api/comments/recent'), ['items']);
  assert.deepEqual(Wire.listFields('GET')('/api/comments/config'), ['bible', 'cats', 'faiths', 'pages', 'ranks']);
  assert.deepEqual(Wire.listFields('POST')('/api/comments/dm/thread'), ['messages']);
  assert.deepEqual(Wire.listFields('POST')('/api/comments/recent'), [], 'the method is part of the route');
  assert.deepEqual(Wire.listFields('GET')('/api/comments/recent/'), [], 'the caller strips the trailing slash');
  assert.deepEqual(Wire.listFields('GET')('/api/comments/board'), [], 'the board index is a map, not a list');
});

test('the table is one row per real route, sorted, each naming at least one field once', () => {
  const keys = Wire.lists.map((r) => r.route);
  assert.deepEqual(keys, [...keys].sort(), 'sorted, so a diff reads cleanly');
  assert.equal(new Set(keys).size, keys.length, 'one row per route');
  for (const r of Wire.lists) {
    assert.ok(routes.includes(r.route), r.route + ' is a route the worker mounts');
    assert.ok(r.fields.length >= 1 && new Set(r.fields).size === r.fields.length, r.route);
    assert.deepEqual(r.fields, [...r.fields].sort(), r.route);
  }
});
