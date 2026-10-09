/* The inline head script (scripts/inject_social.py, `mc-fout`) decides, before
 * the stylesheet paints, three things about Home: hide the static book page
 * (html.mc-home-boot), hold the Continue row's place (html.mc-cont), and
 * whether to draw the launch splash.
 *
 * The splash is the installed app's launch screen, and since 2026-10-08 it is
 * ONLY that: `display-mode: standalone`, or iOS's navigator.standalone. In a
 * browser tab it hid a launcher the HTML already carries (app/home.ts). No
 * headless Chrome can be put in display-mode (Emulation.setEmulatedMedia does
 * not honour it), so this RUNS the script that ships in docs/index.html against
 * stubbed media, storage and navigation timing, and reads the classes it set.
 * tests/py/test_boot_splash.py holds the splash's own safety (its deadline,
 * its clearing on a throw).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script id="mc-fout">([\s\S]*?)<\/script>/)![1];

function boot({ path = '/', standalone = false, iosStandalone = false, reload = false, store = {} }: { path?: string; standalone?: boolean; iosStandalone?: boolean; reload?: boolean; store?: Record<string, string> } = {}) {
  const classes = new Set<string>();
  const keys = Object.keys(store);
  const html = {
    classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
    setAttribute() {}, style: {},
  };
  const ctx = vm.createContext({
    document: {
      documentElement: html, cookie: '',
      head: { appendChild() {} },
      createElement: () => ({ style: {} }),
      querySelector: () => null,
    },
    location: { pathname: path },
    localStorage: {
      length: keys.length, key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => (k in store ? store[k] : null),
    },
    navigator: iosStandalone ? { standalone: true } : {},
    matchMedia: (q: string) => ({ matches: standalone && q === '(display-mode: standalone)' }),
    performance: { getEntriesByType: () => [{ type: reload ? 'reload' : 'navigate' }] },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, Date,
  });
  vm.runInContext(SCRIPT, ctx);
  return classes;
}

test('a browser tab gets the launcher at once, never a splash over it', () => {
  const c = boot();
  assert.ok(c.has('mc-home-boot'), 'the static book page still hides behind the launcher');
  assert.ok(!c.has('mc-splash'), 'a splash in a tab hid a launcher that was already painted');
});

test('the installed app keeps its launch screen', () => {
  assert.ok(boot({ standalone: true }).has('mc-splash'), 'display-mode: standalone');
  assert.ok(boot({ iosStandalone: true }).has('mc-splash'), 'an iOS home-screen web clip');
  assert.ok(!boot({ standalone: true, reload: true }).has('mc-splash'), 'a reload is still not a launch');
  assert.ok(!boot({ standalone: true, path: '/library.html' }).has('mc-splash'), 'anywhere but Home is a resume');
});

test('a stored reading position holds the Continue row\'s place before first paint', () => {
  assert.ok(boot({ store: { 'mc-theme': 'dark', 'mc-readpos:anf03.html': '{"at":1}' } }).has('mc-cont'));
  assert.ok(!boot({ store: { 'mc-theme': 'dark' } }).has('mc-cont'), 'no position, no reserved row');
  assert.ok(!boot({ path: '/credo.html', store: { 'mc-readpos:anf03.html': '{"at":1}' } }).has('mc-cont'),
    'Home only');
});

test('the plain site gets none of it', () => {
  const c = boot({ standalone: true, store: { 'mc-app': '0', 'mc-readpos:anf03.html': '{"at":1}' } });
  assert.deepEqual([...c], []);
});
