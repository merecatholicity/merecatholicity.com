/* The `: any` ratchet (2026-09-16).
 *
 * strict: true is on in both tsc projects, and `: any` switches it off one
 * parameter at a time — the sustainability review counted 1,982 in the client
 * and 882 in the worker. This test holds the two counts at a committed
 * baseline (tests/_support/any_baseline.json) and lets them move in ONE
 * direction: a commit that adds one fails as a regression; a commit that
 * removes some fails too, naming the new number to write — so every reduction
 * is recorded and nothing creeps back. Counted per PROJECT, not per file, so
 * moving code between files (the worker's route split, the DM client's split)
 * is neutral. Raising the baseline is a decision, written in the commit.
 *
 * Why not typescript-eslint's no-explicit-any: the pinned `typescript` (7.0.2)
 * is the native compiler and ships no JS compiler API, which typescript-estree
 * needs — `node -e "console.log(Object.keys(require('typescript')).length)"`
 * prints 2 today; when it prints more, the linter is worth revisiting. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(root, 'tests', '_support', 'any_baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

/* the two tsc projects (tsconfig.json; comments-worker/ and contact-worker/ tsconfig.json) */
const PROJECTS = { client: ['client', 'app'], worker: ['comments-worker/src', 'contact-worker/src'] };

function tsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}
const count = (dirs) => dirs.flatMap((d) => tsFiles(join(root, d)))
  .reduce((n, f) => n + (readFileSync(f, 'utf8').match(/: any\b/g) || []).length, 0);

for (const [name, dirs] of Object.entries(PROJECTS)) {
  test(`${name}: the \`: any\` count equals the baseline (${baseline[name]}) — it may only fall, and a fall is recorded`, () => {
    const n = count(dirs);
    if (n > baseline[name]) {
      assert.fail(`${name}: ${n} \`: any\` > baseline ${baseline[name]} — a new any crept in; give it a type`);
    }
    if (n < baseline[name]) {
      assert.fail(`${name}: ${n} \`: any\` < baseline ${baseline[name]} — good: write ${n} into tests/_support/any_baseline.json in this commit so the ratchet clicks`);
    }
  });
}
