/* The background paintings are warmed for the NEXT page, never at the cost of
 * this one (app/artwarm.ts, 2026-09-18).
 *
 * The lazy load is the feature: styles/main.css fetches a painting only when
 * body[data-art="…"] matches it, so nobody downloads art they never see. What
 * it costs is the first arrival, and on a phone every one of the six tabs is
 * one tap away — so the rest are walked into the cache after this page is
 * completely done.
 *
 * Two classes of bug are held here. The first is DRIFT: the file list lives in
 * the stylesheet and a copy of it lives in the module, so a painting added to
 * one and forgotten in the other would either never be warmed or be fetched as
 * a 404 for ever. Both directions are swept, against the stylesheet AND against
 * the files on disk. The second is a warm that stops being polite — starting
 * before the page in hand is done, running twice per document, or spending a
 * metered reader's data on decoration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TAB_ART, PAGE_ART, WIDE_AT, artUrls, warmArt, browserWarmEnv, installArtWarm }
  from '../../app/artwarm.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');

/* every theme painting the stylesheet actually asks for */
const cssNames = () => {
  const out = new Set();
  for (const m of css.matchAll(/url\(theme\/([a-z-]+)-([md])\.webp\)/g)) out.add(m[1]);
  return out;
};

test('the warm list IS the stylesheet\'s list, both ways', () => {
  /* The drift guard. A new painting added to styles/main.css and not here is
     art that always arrives late; a name here that the stylesheet dropped is a
     download nothing will ever draw. */
  const mine = new Set(TAB_ART.concat(PAGE_ART));
  const theirs = cssNames();
  assert.deepEqual([...mine].sort(), [...theirs].sort(),
    'app/artwarm.ts and styles/main.css disagree about which paintings exist');
  assert.equal(mine.size, TAB_ART.length + PAGE_ART.length, 'a name is listed twice');
});

test('every painting named is a file that exists, in both variants', () => {
  for (const name of TAB_ART.concat(PAGE_ART)) {
    for (const tail of ['-m.webp', '-d.webp']) {
      const p = join(root, 'docs', 'theme', name + tail);
      assert.ok(existsSync(p), 'docs/theme/' + name + tail + ' is warmed but not published');
    }
  }
});

test('the breakpoint is the stylesheet\'s own', () => {
  /* Warming -d below the width that shows -m would download the wrong half of
     the set: twice the bytes, none of them used. */
  assert.ok(css.includes('@media (min-width: ' + WIDE_AT + 'px)'),
    'styles/main.css switches -m to -d at a different width than WIDE_AT');
});

test('the six tabs come first, because a tap is quicker than a link', () => {
  const urls = artUrls(false);
  assert.deepEqual(urls.slice(0, TAB_ART.length), TAB_ART.map((n) => '/theme/' + n + '-m.webp'));
  assert.equal(urls.length, TAB_ART.length + PAGE_ART.length);
});

test('only the variant this viewport will use', () => {
  assert.ok(artUrls(true).every((u) => u.endsWith('-d.webp')));
  assert.ok(artUrls(false).every((u) => u.endsWith('-m.webp')));
});

test('the painting already on screen is not asked for again', () => {
  const urls = artUrls(false, 'profile');
  assert.ok(!urls.includes('/theme/profile-m.webp'));
  assert.equal(urls.length, TAB_ART.length + PAGE_ART.length - 1);
  /* A two-image page names neither half, so both are warmed — which is right:
     communions draws peter AND hagia, and skipping by key would skip neither. */
  assert.equal(artUrls(false, 'communions').length, TAB_ART.length + PAGE_ART.length);
});


/* ---- the walk itself, against a fake world ---- */
function world(over = {}) {
  const log = [];
  let inFlight = 0, most = 0;
  const env = {
    on: () => true,
    wide: () => false,
    showing: () => '',
    sparing: () => false,
    ready: (go) => go(),
    fetchOne: (url) => {
      log.push(url);
      inFlight += 1; most = Math.max(most, inFlight);
      return new Promise((r) => setTimeout(() => { inFlight -= 1; r(); }, 1));
    },
    ...over,
  };
  return { env, log, most: () => most };
}

test('the art switched off downloads nothing at all', async () => {
  const w = world({ on: () => false });
  await warmArt(w.env);
  assert.deepEqual(w.log, [], 'a reader who turned the paintings off must not pay for them');
});

test('Save-Data and a 2g link are refusals', async () => {
  const w = world({ sparing: () => true });
  await warmArt(w.env);
  assert.deepEqual(w.log, []);
});

test('the setting is read when the walk fires, not when it is scheduled', async () => {
  /* The walk is scheduled at boot and fires after load + idle — seconds later,
     which is long enough for somebody to open Settings and switch it off. */
  let on = true;
  const w = world({ on: () => on, ready: (go) => { on = false; go(); } });
  await warmArt(w.env);
  assert.deepEqual(w.log, []);
});

test('one at a time, in order', async () => {
  const w = world();
  await warmArt(w.env);
  assert.deepEqual(w.log, artUrls(false));
  assert.equal(w.most(), 1,
    "the reader's own next page must never queue behind thirteen paintings");
});

test('a painting that refuses does not end the walk', async () => {
  const w = world({
    fetchOne: (url) => {
      w0.log.push(url);
      return url.includes('feed') ? Promise.reject(new Error('404')) : Promise.resolve();
    },
  });
  const w0 = w;
  await warmArt(w.env);
  assert.deepEqual(w.log, artUrls(false), 'one missing file must not cost the other twelve');
});


/* ---- the browser's own answers ---- */
function fakeBrowser({ width = 390, art = '', conn = undefined, readyState = 'complete' } = {}) {
  const loads = [];
  globalThis.window = {
    matchMedia: (q) => ({ matches: width >= Number((q.match(/(\d+)px/) || [])[1] || 0) }),
    requestIdleCallback: (cb) => cb(),
    addEventListener: (t, cb) => { if (t === 'load') loads.push(cb); },
    setTimeout,
  };
  globalThis.document = { readyState, body: { dataset: art ? { art } : {} } };
  /* node 24 defines navigator as a getter, so it is replaced, not assigned */
  Object.defineProperty(globalThis, 'navigator', {
    value: conn ? { connection: conn } : {}, configurable: true, writable: true });
  const asked = [];
  globalThis.Image = class {
    set src(u) { asked.push(u); setTimeout(() => this.onload && this.onload(), 0); }
  };
  return { asked, loads };
}

test('the browser env answers the six questions', async () => {
  const b = fakeBrowser({ width: 1280, art: 'profile', conn: { effectiveType: '4g' } });
  const env = browserWarmEnv(() => true);
  assert.equal(env.wide(), true, '1280px takes the desktop paintings');
  assert.equal(env.showing(), 'profile');
  assert.equal(env.sparing(), false);
  await warmArt(env);
  assert.deepEqual(b.asked, artUrls(true, 'profile'));
  assert.ok(b.asked.every((u) => u.startsWith('/theme/')),
    'the URL must be the one the stylesheet resolves to, or the cache entry is not shared');
});

test('a phone takes the phone paintings, and Save-Data takes none', async () => {
  fakeBrowser({ width: 390 });
  assert.equal(browserWarmEnv(() => true).wide(), false);
  fakeBrowser({ width: 390, conn: { saveData: true } });
  assert.equal(browserWarmEnv(() => true).sparing(), true);
  fakeBrowser({ width: 390, conn: { effectiveType: 'slow-2g' } });
  assert.equal(browserWarmEnv(() => true).sparing(), true);
  fakeBrowser({ width: 390, conn: { effectiveType: '3g' } });
  assert.equal(browserWarmEnv(() => true).sparing(), false, '3g still gets its art');
});

test('nothing starts until the page in hand has finished loading', async () => {
  const b = fakeBrowser({ readyState: 'loading' });
  const env = browserWarmEnv(() => true);
  let fired = false;
  env.ready(() => { fired = true; });
  assert.equal(fired, false, 'the current page owns the network until its load event');
  assert.equal(b.loads.length, 1, 'and the wait is a one-shot load listener');
  b.loads[0]();
  assert.equal(fired, true);
});

test('one walk per document, however often the chrome is installed', async () => {
  /* mcBoot re-runs on every soft navigation (CLAUDE.md); a warm per hop would
     be a slow drip of needless requests. This test runs LAST: the latch is
     module state, and once it is down it stays down. */
  const b = fakeBrowser({ width: 390 });
  installArtWarm(() => true);
  installArtWarm(() => true);
  installArtWarm(() => true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(b.asked.length, artUrls(false).length,
    'the second and third install must have walked nothing');
});
