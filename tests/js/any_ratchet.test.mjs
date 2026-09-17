/* The `any` ratchet (2026-09-16; exact since 2026-09-17).
 *
 * strict: true is on in both tsc projects, and `any` switches it off one
 * value at a time. A type that is `any` is how the worker served its whole env
 * from a public endpoint for six weeks (withNames(env, items): both sides took
 * `any`, so nothing flagged the swapped argument). So:
 *
 *   - the WORKERS (comments-worker, contact-worker) hold ZERO — a hard gate;
 *     an `any` is replaced by the type the value really has, checked against
 *     what the code does at runtime, never silenced with a cast;
 *   - the CLIENT holds a committed baseline (tests/_support/any_baseline.json)
 *     that may move one way only: a commit that adds one fails as a
 *     regression, one that removes some fails too, naming the number to write
 *     — so every reduction is recorded and nothing creeps back.
 *
 * The count is EXACT: the `any` words in a file minus the `any` words left once
 * Node strips its types (module.stripTypeScriptTypes) — every `: any`,
 * `as any`, `any[]`, `<any>`, and none of the comments, strings or identifiers
 * that happen to spell the word. Counted per PROJECT, so moving code between
 * files is neutral; plain .js is not counted, which is why the workers carry
 * none (pure.ts, webpush.ts).
 *
 * Why not typescript-eslint's no-explicit-any: the pinned `typescript` (7.x) is
 * the native compiler and ships no JS compiler API, which typescript-estree
 * needs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(root, 'tests', '_support', 'any_baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

/* the two tsc projects (tsconfig.json; comments-worker/ and contact-worker/ tsconfig.json) */
const PROJECTS = { client: ['client', 'app'], worker: ['comments-worker/src', 'contact-worker/src'] };

function files(dir, ext) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}
const words = (s) => (s.match(/\bany\b/g) || []).length;
/* the type-position `any`s of one file */
function typeAnys(src) {
  const warn = process.emitWarning;
  process.emitWarning = () => {};   // stripTypeScriptTypes is experimental and says so on every call
  try { return words(src) - words(stripTypeScriptTypes(src, { mode: 'strip' })); } finally { process.emitWarning = warn; }
}
const census = (dirs) => dirs.flatMap((d) => files(join(root, d), '.ts'))
  .map((f) => [relative(root, f), typeAnys(readFileSync(f, 'utf8'))]).filter(([, n]) => n > 0);

test('the count is exact: type positions only, never a comment, a string or an identifier', () => {
  assert.equal(typeAnys('let a: any = 1; const b = x as any; let c: any[] = []; f<any>(); type T = Record<string, any>;'), 5);
  assert.equal(typeAnys('/* any */ // any\nconst any = "any"; const s = `any`; function anyOf(many) { return many; }'), 0);
  assert.equal(typeAnys('function f(x: unknown): string { return String(x); }'), 0);
});

test('the workers hold no `any` at all', () => {
  const found = census(PROJECTS.worker);
  assert.deepEqual(found, [], 'a worker file types something `any` — give it the type it has: ' + found.map(([f, n]) => f + ' ' + n).join(', '));
  assert.equal(baseline.worker, 0, 'the worker baseline is zero, and stays zero');
  const js = PROJECTS.worker.flatMap((d) => files(join(root, d), '.js')).map((f) => relative(root, f));
  assert.deepEqual(js, [], 'a plain .js module in a worker is typed `any` to its callers: make it .ts');
});

test(`client: the \`any\` count equals the baseline (${baseline.client}) — it may only fall, and a fall is recorded`, () => {
  const n = census(PROJECTS.client).reduce((t, [, k]) => t + k, 0);
  if (n > baseline.client) {
    assert.fail(`client: ${n} \`any\` > baseline ${baseline.client} — a new any crept in; give it a type`);
  }
  if (n < baseline.client) {
    assert.fail(`client: ${n} \`any\` < baseline ${baseline.client} — good: write ${n} into tests/_support/any_baseline.json in this commit so the ratchet clicks`);
  }
});
