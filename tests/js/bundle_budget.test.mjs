/* The bundles have a budget (P2-5, 2026-09-16). docs/comments.js, docs/app.js
 * and docs/style.css are held to the ceilings in tests/_support/bundle_budget.json
 * (their size on the day plus two percent). A build over a ceiling fails — the
 * DM, merecat and admin modules were riding to every reader of a KJV chapter
 * before anyone measured; a build more than five percent under it fails too,
 * asking for the ceiling to come down: the number only ever falls, and every
 * fall is recorded. The files are build output — `make bundle` (and `make css`)
 * first, as the stamp test already requires. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const budget = JSON.parse(readFileSync(join(root, 'tests', '_support', 'bundle_budget.json'), 'utf8'));

for (const name of Object.keys(budget).filter((k) => !k.startsWith('_'))) {
  test(`${name} stays under its ceiling (${budget[name]} B) and the ceiling follows it down`, () => {
    const path = join(root, 'docs', name);
    assert.ok(existsSync(path), name + ' is not built — make bundle (and make css) first');
    const size = statSync(path).size;
    const ceiling = budget[name];
    assert.ok(size <= ceiling, `${name}: ${size} B > ceiling ${ceiling} B — the bundle grew; split it or move code out (P2-5), do not raise the ceiling`);
    const floor = Math.floor(ceiling * 0.95);
    assert.ok(size >= floor, `${name}: ${size} B is more than 5% under the ceiling — good: write ${Math.ceil(size * 1.02)} into tests/_support/bundle_budget.json in this commit so the ratchet clicks`);
  });
}
