/* No HTML sink in the client (P2-7, 2026-09-16). The review counted "11
 * innerHTML sites"; every one was a comment saying "never innerHTML". This
 * locks the fact for the CSP flip: no `innerHTML =`, `outerHTML =`,
 * `insertAdjacentHTML(`, `document.write(`, `eval(`, `new Function(` in
 * app/ or client/ outside comments — the renderer builds nodes
 * (app/richtext.ts) and a policy without 'unsafe-eval' can hold. Since
 * 2026-10-08 the CSP carries Trusted Types (Report-Only from 2026-10-09, so a
 * stray sink reports rather than breaks): the sweep reaches pagejs/ too, and
 * the site makes TWO policies: the `default` at the top of pagejs/nav.ts (and
 * turnstile.html's twin; script URLs only) and the shell's `mc-doc` for the
 * soft navigation's one parse of our own page — a third is a third door. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files: string[] = [];
for (const dir of ['app', 'app/views', 'client', 'pagejs']) {
  for (const f of readdirSync(join(root, dir))) if (f.endsWith('.ts') || f.endsWith('.js')) files.push(join(dir, f));
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const SINKS = [/\.innerHTML\s*[+]?=/, /\.outerHTML\s*[+]?=/, /insertAdjacentHTML\(/, /document\.write\(/, /\beval\(/, /new Function\(/, /srcdoc\s*=/,
  /createContextualFragment\(/, /setHTMLUnsafe\(/, /parseHTMLUnsafe\(/, /parseFromString\((?!docHTML\()/];

test('no HTML or code sink in app/, client/ or pagejs/, outside comments', () => {
  const hits = [];
  for (const f of files) {
    const code = strip(readFileSync(join(root, f), 'utf8'));
    for (const re of SINKS) if (re.test(code)) hits.push(f + ': ' + re.source);
  }
  assert.deepEqual(hits, [], 'a sink here is what the enforced CSP would refuse — build nodes instead');
  assert.ok(files.length > 20, 'the sweep saw the client');
});

test('two Trusted Types policies of our own: the default in nav.js, mc-doc in the shell (Lit brings lit-html)', () => {
  const makers = files.filter((f) => /createPolicy\(/.test(strip(readFileSync(join(root, f), 'utf8'))));
  assert.deepEqual(makers.sort(), ['app/shell.ts', 'pagejs/nav.ts'], 'a new policy name must also be named in the CSP trusted-types list');
  const shell = strip(readFileSync(join(root, 'app/shell.ts'), 'utf8'));
  assert.equal((shell.match(/parseFromString\(docHTML\(/g) || []).length, 1, 'mc-doc serves the one soft-navigation parse');
});
