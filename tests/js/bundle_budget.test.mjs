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

/* `app-chunks` and `chrome-chunks` are not filenames: they are the SUM of every
   content-hashed chunk the entry imports STATICALLY — what a cold open waits on
   before that entry can run, over and above the entry itself.

   Summing matters. Until 2026-09-18 this read the FIRST import only, because
   each entry had exactly one shared chunk. Making four view modules lazy made
   esbuild split the shared code in two, and the old one-chunk reading reported
   chrome's cold open as 7,026 B when it was really 22,564 — a 68% "improvement"
   that was nothing but a chunk it had stopped counting. A budget that can be
   satisfied by moving bytes sideways is not a budget.

   A DYNAMIC import is deliberately not counted: that is the point of making a
   module lazy, and `import(` is what distinguishes the two. */
function eagerChunks(entry) {
  const src = readFileSync(join(root, 'docs', entry), 'utf8');
  const names = new Set();
  const re = /(.)["'](\.\/chunks\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] === '(') continue;            // import("./chunks/x") — lazy, not waited on
    names.add(m[2].replace('./', ''));
  }
  assert.ok(names.size > 0, `docs/${entry} imports no chunk statically — did the split break?`);
  let total = 0;
  for (const n of names) {
    const p = join(root, 'docs', n);
    assert.ok(existsSync(p), `docs/${entry} names ${n}, which is not built`);
    total += statSync(p).size;
  }
  return total;
}

const CHUNK_SUMS = { 'app-chunks': 'app.js', 'chrome-chunks': 'chrome.js' };

for (const name of Object.keys(budget).filter((k) => !k.startsWith('_'))) {
  test(`${name} stays under its ceiling (${budget[name]} B) and the ceiling follows it down`, () => {
    let size;
    if (CHUNK_SUMS[name]) {
      size = eagerChunks(CHUNK_SUMS[name]);
    } else {
      const path = join(root, 'docs', name);
      assert.ok(existsSync(path), name + ' is not built — make bundle (and make css) first');
      size = statSync(path).size;
    }
    const ceiling = budget[name];
    assert.ok(size <= ceiling, `${name}: ${size} B > ceiling ${ceiling} B — the bundle grew; split it or move code out (P2-5), do not raise the ceiling`);
    const floor = Math.floor(ceiling * 0.95);
    assert.ok(size >= floor, `${name}: ${size} B is more than 5% under the ceiling — good: write ${Math.ceil(size * 1.02)} into tests/_support/bundle_budget.json in this commit so the ratchet clicks`);
  });
}

/* The shell loads a page's comments.js on a soft navigation as a CLASSIC script
 * (app/shell.ts loadScript) while the page's own tag is type="module": both
 * roads work only while the ESM entry has no static import or export — its
 * chunks are reached by import(), which a classic script may use. esbuild would
 * add a static import the day a lazy module shared runtime code with the
 * entry; this says so before the soft-navigation road breaks. */
/* The shell is an ES MODULE since 2026-09-17 (the write-path port's P0): built
 * with --splitting so a later phase's code lands in a content-hashed chunk
 * app.js import()s, not in app.js itself. The two halves of that have to agree
 * — an ESM bundle injected as a classic script dies at its first static import,
 * and the only injector is docs/nav.js. */
test('docs/app.js is an ES module, and nav.js injects it as one', () => {
  const app = join(root, 'docs', 'app.js');
  assert.ok(existsSync(app), 'app.js is not built — make bundle first');
  const nav = readFileSync(join(root, 'pagejs', 'nav.js'), 'utf8');
  const at = nav.indexOf("s.src = 'app.js");
  assert.ok(at > 0, 'nav.js injects app.js');
  /* to the appendChild that FOLLOWS it — nav.js appends other scripts earlier */
  const inject = nav.slice(at, nav.indexOf('document.head.appendChild(s)', at));
  assert.ok(/s\.type = 'module';/.test(inject), "nav.js must set s.type = 'module' — the bundle is ESM");
  /* the chunk directory is wiped ONCE, before both bundles: the shell's build
     must not delete the client's chunks, nor the client's the shell's */
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(/--format=esm --splitting/.test(pkg.scripts['build:js']), 'the shell builds as a split ESM bundle');
  /* The bars ride their own entry in the SAME build, so Lit and the bar code
     live in one shared chunk instead of twice over (2026-09-17). */
  assert.ok(/esbuild app\/app\.ts app\/chrome\.ts /.test(pkg.scripts['build:js']), 'both entries build together, sharing chunks');
  const early = nav.indexOf("c.src = 'chrome.js");
  assert.ok(early > 0 && early < at, 'nav.js asks for the bars BEFORE the shell');
  const einject = nav.slice(early, nav.indexOf('document.head.appendChild(c)', early));
  assert.ok(/c\.type = 'module';/.test(einject), 'the early bundle is ESM too');
  assert.equal((pkg.scripts['build:js'].match(/rm -rf docs\/chunks/g) || []).length, 1, 'the chunk wipe runs once');
  assert.ok(!/rm -rf docs\/chunks/.test(pkg.scripts['build:client']), 'and not again in the client build, which would take the shell\'s chunks');
});

test('docs/comments.js is an ES module a classic script tag can still load: no static import or export, chunks by import() only', () => {
  const path = join(root, 'docs', 'comments.js');
  assert.ok(existsSync(path), 'comments.js is not built — make bundle first');
  const src = readFileSync(path, 'utf8');
  assert.equal((src.match(/(?:^|[;}\n])import\s*[{"'*a-zA-Z_$]/g) || []).length, 0, 'a static import — the shell\'s classic loadScript would throw');
  assert.equal((src.match(/(?:^|[;}\n])export\s*[{*]/g) || []).length, 0, 'an export statement — not classic-loadable');
  assert.ok(/import\("\.\/chunks\/admin-[A-Z0-9]+\.js"\)/.test(src), 'the admin views ride a chunk reached by import()');
  assert.ok(/import\("\.\/chunks\/merecat-[A-Z0-9]+\.js"\)/.test(src), 'so does merecat');
  assert.ok(/import\("\.\/chunks\/dm-thread-[A-Z0-9]+\.js"\)/.test(src), 'and the DM thread');
});

