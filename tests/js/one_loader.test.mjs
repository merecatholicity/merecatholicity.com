/* ONE loading indicator on the page at a time (2026-09-19).
 *
 * Three layers can each stand a placeholder into the same screen and none of
 * them can see the others: the shell paints a spinner into the `section` it
 * builds for a platform page (app/shell.ts instantMain), styles/main.css paints
 * one into `section.comments.board:empty` while nothing has rendered yet, and a
 * view — often a lazily-loaded chunk, so it arrives late, after the layers above
 * it have already drawn — paints its own. Each is correct alone. Together they
 * are two rings stacked on one screen, which reads as a fault rather than as
 * patience; the owner reported exactly that on the DM screen.
 *
 * The rule: minting a placeholder retires every one already standing in the page
 * region. "The placeholder" was always meant to be singular — the CSS comment
 * beside .mc-load calls it "the placeholder" and leans on a fade-in so a fast
 * load shows none at all, which only makes sense for one. This cannot be a code
 * review note because the duplicate appears only on a slow connection, and only
 * when the late layer happens to arrive while an earlier ring is still up. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('minting a placeholder retires the ones already standing, before it builds its own', () => {
  const src = read('client/comments.ts');
  const fn = src.slice(src.indexOf('function skeleton(kind'), src.indexOf('function loadingLine'));
  assert.ok(fn.length > 40, 'skeleton() must exist');
  const sweep = fn.indexOf('.mc-load\').forEach');
  const build = fn.indexOf("el('div', 'mc-load'");
  assert.ok(sweep >= 0, 'skeleton() must sweep the placeholders already up');
  assert.ok(sweep < build, 'sweep FIRST, then build — the other order removes the new ring too');
  assert.match(fn, /querySelectorAll\('main \.mc-load'\)/,
    'scoped to the page region: an overlay or sheet keeps its own spinner');
});

test('the client mints .mc-load in exactly one place, so the sweep cannot be bypassed', () => {
  const offenders = [];
  for (const f of readdirSync(join(root, 'client')).filter((n) => n.endsWith('.ts'))) {
    read('client/' + f).split('\n').forEach((line, i) => {
      /* `mc-load-in` is the INLINE spinner that rides beside a word (loadingLine);
         only the standalone block is the page's one placeholder. */
      if (/'mc-load'/.test(line) && !/function skeleton/.test(line)) offenders.push('client/' + f + ':' + (i + 1));
    });
  }
  assert.deepEqual(offenders.filter((o) => !o.startsWith('client/comments.ts')), [],
    'a second .mc-load minted outside skeleton() escapes the sweep and can stack');
});

test('the CSS cold-start ring is mutually exclusive with a rendered one, by :empty', () => {
  /* the other half of the guarantee: the CSS placeholder cannot coexist with a
     real one, because the moment anything renders into the section it stops
     matching. If that selector ever loses :empty, two rings come back. */
  const css = read('styles/main.css');
  assert.match(css, /section\.comments\.board:empty::after/,
    'the cold-start ring must hang off :empty, never a class a view could leave behind');
});
