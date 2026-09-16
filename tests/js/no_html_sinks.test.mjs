/* No HTML sink in the client (P2-7, 2026-09-16). The review counted "11
 * innerHTML sites"; every one was a comment saying "never innerHTML". This
 * locks the fact for the CSP flip: no `innerHTML =`, `outerHTML =`,
 * `insertAdjacentHTML(`, `document.write(`, `eval(`, `new Function(` in
 * app/ or client/ outside comments — the renderer builds nodes
 * (app/richtext.ts) and a policy without 'unsafe-eval' can hold. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = [];
for (const dir of ['app', 'app/views', 'client']) {
  for (const f of readdirSync(join(root, dir))) if (f.endsWith('.ts')) files.push(join(dir, f));
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const SINKS = [/\.innerHTML\s*[+]?=/, /\.outerHTML\s*[+]?=/, /insertAdjacentHTML\(/, /document\.write\(/, /\beval\(/, /new Function\(/, /srcdoc\s*=/];

test('no HTML or code sink in app/ or client/, outside comments', () => {
  const hits = [];
  for (const f of files) {
    const code = strip(readFileSync(join(root, f), 'utf8'));
    for (const re of SINKS) if (re.test(code)) hits.push(f + ': ' + re.source);
  }
  assert.deepEqual(hits, [], 'a sink here is what the enforced CSP would refuse — build nodes instead');
  assert.ok(files.length > 20, 'the sweep saw the client');
});
