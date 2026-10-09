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
 * 3. NOTHING BEFORE THE FIRST PAINT (2026-10-08). The bars and the shell are
 *    requested after the page's first frame, the meter and the service worker
 *    after `load`. Fetched at once they raced the stylesheet and the launcher
 *    for a phone's first paint, and Lighthouse billed the app's ~100 KB to the
 *    page's FCP and LCP.
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
import { stripTypes } from '../_support/ts.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAV = stripTypes(readFileSync(join(root, 'pagejs', 'nav.ts'), 'utf8'));

type Listener = (e: { type: string }) => void;

/* The smallest document nav.js can run against: it stamps <html>, reads
   cookies and storage, appends scripts to <head>, and binds listeners. */
function run({ corpus = false, hostname = 'merecatholicity.com', webdriver = false, hidden = false, sw = undefined }: { corpus?: boolean; hostname?: string; webdriver?: boolean; hidden?: boolean; sw?: unknown } = {}) {
  const added: { src?: string }[] = [];
  const listeners: Record<string, Record<string, Listener[]>> = { document: {}, window: {} };
  /* the stub element and window are deliberately loose (`any`): a fake DOM for vm, no tighter than it is */
  const el = (tag: string): any => ({
    tagName: (tag || '').toUpperCase(), attrs: {}, children: [], className: '',
    style: {}, dataset: {},
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k: string) { delete this.attrs[k]; },
    hasAttribute(k: string) { return k in this.attrs; },
    insertBefore(n: unknown) { this.children.push(n); return n; },
    remove() {},
    appendChild(c: unknown) { this.children.push(c); return c; },
    removeChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  });
  const html = el('html');
  const head = { ...el('head'), appendChild(n: { src?: string }) { added.push(n); return n; } };
  const body = el('body');
  const main = el('main');
  main.className = corpus ? 'prose corpus' : 'prose';

  const doc = {
    documentElement: html, head, body, cookie: '', readyState: 'loading',
    visibilityState: hidden ? 'hidden' : 'visible',
    createElement: el,
    getElementById() { return null; },
    querySelector(sel: string) { return sel.indexOf('main.prose.corpus') >= 0 ? (corpus ? main : null) : null; },
    querySelectorAll() { return []; },
    addEventListener(t: string, fn: Listener) { (listeners.document[t] ||= []).push(fn); },
    removeEventListener(t: string, fn: Listener) {
      listeners.document[t] = (listeners.document[t] || []).filter((f) => f !== fn);
    },
  };
  const store = new Map();
  const timers: (() => void)[] = [];
  const frames: (() => void)[] = [];
  const win: Record<string, any> = {
    location: { hostname, pathname: '/anf03-apology.html', search: '', href: 'x', reload() {} },
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k) : null),
      setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k),
    },
    navigator: { webdriver, serviceWorker: sw, clipboard: undefined },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    performance: { getEntriesByType: () => [], navigation: { type: 0 } },
    // no requestIdleCallback: the setTimeout road, held until the test asks
    requestIdleCallback: undefined,
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener(t: string, fn: Listener) { (listeners.window[t] ||= []).push(fn); },
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
    fire: (where: string, type: string) => (listeners[where][type] || []).forEach((f) => f({ type })),
    press: () => (listeners.document.pointerdown || []).forEach((f) => f({ type: 'pointerdown' })),
    flush: () => { const q = timers.splice(0); q.forEach((f) => f()); },
    /* one frame: its callbacks, then the tasks they queued (the paint falls
       between the two) — never the 3s backstop, which flush() is */
    frame: () => {
      const queued = timers.length;
      frames.splice(0).forEach((f) => f());
      timers.splice(queued).forEach((f) => f());
    },
  };
}

const has = (srcs: string[], name: string) => srcs.some((s) => s.indexOf(name) === 0);

test('an app page loads its bars and the shell right after its first paint', () => {
  const page = run({ corpus: false });
  assert.ok(!has(page.srcs(), 'chrome.js') && !has(page.srcs(), 'app.js'),
    'nothing of the app may race the stylesheet for the first frame');
  page.frame();
  assert.ok(!has(page.srcs(), 'app.js'), 'not until the first frame has been presented');
  page.frame();
  assert.ok(has(page.srcs(), 'chrome.js'), 'the bars');
  assert.ok(has(page.srcs(), 'app.js'), 'the shell must not wait for load on the app itself');
});

test('a frame that never comes is covered, and a hidden tab does not wait for one', () => {
  const frozen = run({ corpus: false });
  frozen.flush();
  assert.ok(has(frozen.srcs(), 'app.js'), 'the backstop must bring the shell without a frame');
  const hidden = run({ corpus: false, hidden: true });
  assert.ok(has(hidden.srcs(), 'chrome.js') && has(hidden.srcs(), 'app.js'),
    'a background tab paints nothing, so it must not wait for a paint');
});

test('a reading page gets its bars after the first paint and the shell after the page is loaded', () => {
  const page = run({ corpus: true });
  page.frame();
  page.frame();
  assert.ok(has(page.srcs(), 'chrome.js'), 'the two fixed bars still arrive within a frame of the first paint');
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

test('the beacon rides every page on the live hostname, after load', () => {
  const beacon = (page: ReturnType<typeof run>) => page.srcs().some((s) => s.indexOf('https://static.cloudflareinsights.com/') === 0);
  const app = run({});
  assert.ok(!beacon(app), 'a meter must not race the page it measures for the first paint');
  app.fire('window', 'load');
  assert.ok(beacon(app));
  const reading = run({ corpus: true });
  reading.fire('window', 'load');
  assert.ok(beacon(reading),
    'a reading page is measured like any other — it is the page search sends people to');
});

test('nothing is measured from a dev box or from automation', () => {
  const lp = run({ hostname: '127.0.0.1' });
  lp.fire('window', 'load');
  const local = lp.srcs().join(' ');
  assert.ok(local.indexOf('cloudflareinsights') < 0, 'a local preview is not a visit');
  const rp = run({ webdriver: true });
  rp.fire('window', 'load');
  const robot = rp.srcs().join(' ');
  assert.ok(robot.indexOf('cloudflareinsights') < 0,
    'the nightly headless run would post itself into the numbers every night');
});

test('the service worker is registered after load, not during the first paint', () => {
  /* a first install primes six pages (docs/sw.js PAGES), whose fetches raced
     the page's own first frame */
  const registered: string[] = [];
  const sw = {
    controller: null, register: (u: string) => { registered.push(u); return Promise.resolve(); },
    getRegistration: () => Promise.resolve(null), addEventListener() {},
  };
  const page = run({ sw });
  page.frame();
  page.frame();
  assert.deepEqual(registered, [], 'no registration before load');
  page.fire('window', 'load');
  assert.deepEqual(registered, ['sw.js']);
});
