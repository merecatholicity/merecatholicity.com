/* docs/nav.js decides what every page loads, and two of its decisions are new.
 *
 * 1. A READING PAGE WAITS FOR THE SHELL, IT DOES NOT WAIT ON IT (2026-09-18).
 *    The platform review asked for the app shell to be dropped outright on
 *    corpus pages — ~101 KB gzipped of application that a reader of the
 *    Ante-Nicene Fathers will never use — and since the volumes were split the
 *    median reading page is 14 KB of HTML, so the shell is five times the page
 *    it is loaded onto. But the shell IS this site's navigation on a phone:
 *    dropping it by class of page would take the tab bar away from anyone who
 *    reloaded a library page. So it arrives late instead: after load and an
 *    idle callback, or at the first touch, whichever comes first.
 * 2. THE METER (2026-09-18). The Web Analytics beacon rides this file, and two
 *    gates keep it honest: never off a merecatholicity.com hostname, and never
 *    under automation — the nightly headless run against production would
 *    otherwise post itself into the numbers every night.
 *
 * Both are conditions inside one IIFE, so this RUNS the file in a stub DOM and
 * asks what it appended, rather than reading it for the shape of its source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAV = readFileSync(join(root, 'pagejs', 'nav.js'), 'utf8');

/* The smallest document nav.js can run against: it stamps <html>, reads
   cookies and storage, appends scripts to <head>, and binds listeners. */
function run({ corpus = false, hostname = 'merecatholicity.com', webdriver = false } = {}) {
  const added = [];
  const listeners = { document: {}, window: {} };
  const el = (tag) => ({
    tagName: (tag || '').toUpperCase(), attrs: {}, children: [], className: '',
    style: {}, dataset: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    insertBefore(n) { this.children.push(n); return n; },
    remove() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  });
  const html = el('html');
  const head = { ...el('head'), appendChild(n) { added.push(n); return n; } };
  const body = el('body');
  const main = el('main');
  main.className = corpus ? 'prose corpus' : 'prose';

  const doc = {
    documentElement: html, head, body, cookie: '', readyState: 'loading',
    visibilityState: 'visible',
    createElement: el,
    getElementById() { return null; },
    querySelector(sel) { return sel.indexOf('main.prose.corpus') >= 0 ? (corpus ? main : null) : null; },
    querySelectorAll() { return []; },
    addEventListener(t, fn) { (listeners.document[t] ||= []).push(fn); },
    removeEventListener(t, fn) {
      listeners.document[t] = (listeners.document[t] || []).filter((f) => f !== fn);
    },
  };
  const store = new Map();
  const timers = [];
  const win = {
    location: { hostname, pathname: '/anf03-apology.html', search: '', href: 'x', reload() {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
    },
    navigator: { webdriver, serviceWorker: undefined, clipboard: undefined },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    performance: { getEntriesByType: () => [], navigation: { type: 0 } },
    // no requestIdleCallback: the setTimeout road, held until the test asks
    requestIdleCallback: undefined,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener(t, fn) { (listeners.window[t] ||= []).push(fn); },
    removeEventListener() {},
    caches: undefined, fetch: () => Promise.resolve({ ok: false }),
  };
  win.window = win;
  win.document = doc;
  win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(NAV, ctx, { filename: 'nav.js' });
  return {
    srcs: () => added.map((n) => n.src || '').filter(Boolean),
    fire: (where, type) => (listeners[where][type] || []).forEach((f) => f({ type })),
    press: () => (listeners.document.pointerdown || []).forEach((f) => f({ type: 'pointerdown' })),
    flush: () => { const q = timers.splice(0); q.forEach((f) => f()); },
  };
}

const has = (srcs, name) => srcs.some((s) => s.indexOf(name) === 0);

test('an app page loads the shell at once, as it always has', () => {
  const page = run({ corpus: false });
  assert.ok(has(page.srcs(), 'chrome.js'), 'the bars');
  assert.ok(has(page.srcs(), 'app.js'), 'the shell must not be delayed on the app itself');
});

test('a reading page gets its bars at once and the shell after the page is loaded', () => {
  const page = run({ corpus: true });
  assert.ok(has(page.srcs(), 'chrome.js'), 'the two fixed bars still arrive within a round trip');
  assert.ok(!has(page.srcs(), 'app.js'), '~101 KB of application ahead of the text');
  page.fire('window', 'load');
  page.flush();
  assert.ok(has(page.srcs(), 'app.js'), 'the shell must still arrive — it is the phone\'s navigation');
});

test('a reader who reaches for a tab does not wait for an idle callback', () => {
  const page = run({ corpus: true });
  assert.ok(!has(page.srcs(), 'app.js'));
  page.press();
  assert.ok(has(page.srcs(), 'app.js'), 'the first touch must bring the shell at once');
});

test('a scroll is a reader too', () => {
  /* book.html and bishop-presbyter.html carry BOTH the corpus class and a
     comments section, so if that section is ever opened its client is fetched
     by the shell. The one reader who could have waited out the idle timeout was
     a desktop wheel-scroller on the way down the site's longest document — a
     wheel tick summons the shell at the top of the page instead. */
  const page = run({ corpus: true });
  page.fire('window', 'scroll');
  assert.ok(has(page.srcs(), 'app.js'), 'a wheel tick must summon the shell');
});

test('the shell is appended once however many roads reach it', () => {
  const page = run({ corpus: true });
  page.press();
  page.fire('window', 'load');
  page.flush();
  page.press();
  assert.equal(page.srcs().filter((s) => s.indexOf('app.js') === 0).length, 1);
});

test('the beacon rides every page on the live hostname', () => {
  assert.ok(run({}).srcs().some((s) => s.indexOf('https://static.cloudflareinsights.com/') === 0));
  assert.ok(run({ corpus: true }).srcs()
    .some((s) => s.indexOf('https://static.cloudflareinsights.com/') === 0),
  'a reading page is measured like any other — it is the page search sends people to');
});

test('nothing is measured from a dev box or from automation', () => {
  const local = run({ hostname: '127.0.0.1' }).srcs().join(' ');
  assert.ok(local.indexOf('cloudflareinsights') < 0, 'a local preview is not a visit');
  const robot = run({ webdriver: true }).srcs().join(' ');
  assert.ok(robot.indexOf('cloudflareinsights') < 0,
    'the nightly headless run would post itself into the numbers every night');
});
