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

/* Every producer of a page-region .mc-load, and the sweep that covers it. The
   first cut of this rule swept `client/` alone and the test looked there alone,
   so the shell and the Lit views went on minting unswept rings and the owner
   saw a pair again on a board topic. The list is the point: a NEW producer must
   join it with a sweep beside it, or this goes red. */
const PRODUCERS = [
  ['client/comments.ts', 'function skeleton', "el('div', 'mc-load'", 'the classic client, inside skeleton()'],
  ['app/shell.ts', 'function skeletonInto', "createElement('div')", 'the shell, for a platform page it builds'],
  ['app/views/util.ts', 'export function mountView', 'appendChild', 'the Lit half, swept at MOUNT since render() must stay pure'],
];

test('every half of the app mints .mc-load in one swept place — none of them alone', () => {
  const offenders = [];
  for (const dir of ['client', 'app', 'app/views']) {
    for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith('.ts'))) {
      const path = dir + '/' + f;
      read(path).split('\n').forEach((line) => {
        /* `mc-load-in` is the INLINE spinner beside a word (loadingLine); only
           the standalone block is the page's one placeholder. */
        if (/mc-load/.test(line) && !/mc-load-in/.test(line) && !/^\s*(\/\*|\*|\/\/)/.test(line)) offenders.push(path);
      });
    }
  }
  const allowed = new Set(PRODUCERS.map((x) => x[0]));
  assert.deepEqual([...new Set(offenders)].filter((o) => !allowed.has(o)), [],
    'a .mc-load minted outside the swept producers can stack under one already standing');
});

test('each producer sweeps the page region BEFORE it paints', () => {
  for (const [path, marker, paint, why] of PRODUCERS) {
    const src = read(path);
    const at = src.indexOf(marker);
    assert.ok(at >= 0, path + ': ' + marker + ' must exist (' + why + ')');
    const fn = src.slice(at, at + 900);
    const swept = fn.indexOf('.mc-load');
    const painted = fn.indexOf(paint);
    assert.ok(swept >= 0, path + ' must find the rings already standing');
    assert.match(fn, /closest\(['"]main['"]\)|'main \.mc-load'/, path + ' must scope the sweep to the page region');
    assert.ok(painted >= 0, path + ': paint step ' + paint + ' not found');
    assert.ok(fn.indexOf('remove()') < painted, path + ': sweep FIRST, then paint');
  }
});

test('the CSS cold-start ring is mutually exclusive with a rendered one, by :empty', () => {
  /* the other half of the guarantee: the CSS placeholder cannot coexist with a
     real one, because the moment anything renders into the section it stops
     matching. If that selector ever loses :empty, two rings come back. */
  const css = read('styles/main.css');
  assert.match(css, /section\.comments\.board:empty::after/,
    'the cold-start ring must hang off :empty, never a class a view could leave behind');
});
