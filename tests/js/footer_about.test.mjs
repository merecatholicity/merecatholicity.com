/* Phones show no footer except on the home tab, and Settings → About is a
 * themed dialog carrying the footer's information (2026-09-11).
 *
 * What would break silently: a footer creeping back under a phone feature (the
 * DM thread opened onto it); the tab stamp the CSS keys on going missing from
 * a navigation road; the About dialog losing an overlay layer (a scrim a touch
 * passes through, a lock it did not take released — closing the sheet under
 * it); Escape reaching the sheet under the dialog; a footer door missing from
 * About, which is now the only place a phone shows them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');
const chrome = readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');

test('phones show no footer except on the home tab; desktop keeps it', () => {
  const m = /@media \(max-width: 600px\) \{\s*body\.mc-app:not\(\[data-mc-tab="home"\]\) mc-footer \{ display: none; \}\s*\}/.exec(css);
  assert.ok(m, 'the phone rule hides mc-footer on every tab but home');
  assert.ok(/^mc-footer \{ display: block; \}/m.test(css), 'the base rule (desktop) still shows it');
});

test('the shell stamps the tab on <body> on every navigation, beside the art', () => {
  const sync = chrome.slice(chrome.indexOf('function syncThemeArt('), chrome.indexOf('function artOn('));
  assert.ok(/document\.body\.dataset\.mcTab = activeTab\(at\) \|\| 'page'/.test(sync),
    'data-mc-tab rides syncThemeArt, which every soft navigation runs');
});

test('the dialog keeps the three overlay layers and never releases a lock it did not take', () => {
  assert.ok(/\.mc-dialog-scrim \{[^}]*touch-action: none/.test(css) && /\.mc-dialog-scrim \{[^}]*overscroll-behavior: contain/.test(css),
    'the scrim is inert to touch and ends the scroll chain');
  assert.ok(/\.mc-dialog \{[^}]*overscroll-behavior: contain/.test(css), 'the card contains its own overscroll');
  assert.ok(/\.mc-dialog \{[^}]*user-select: text/.test(css), 'the body is selectable — it exists to be copied');
  const dlg = chrome.slice(chrome.indexOf('function mcDialog('), chrome.indexOf('class McSettings extends LitElement'));
  assert.ok(/const took = !!lockDocument\(\);/.test(dlg) && /if \(took\) unlockDocument\(\);/.test(dlg),
    'the lock is taken only when free (a sheet may hold it) and released only when taken');
  assert.ok(/window\.addEventListener\('keydown', onKey, true\)/.test(dlg) && /e\.stopImmediatePropagation\(\);/.test(dlg),
    'Escape is taken on the window, before the sheet\'s own document listener');
  assert.ok(/scrim\.addEventListener\('click', \(e\) => \{ if \(e\.target === scrim\) close\(\); \}\)/.test(dlg), 'the scrim dismisses');
  assert.ok(/closest\('a\[href\]'\)/.test(dlg) && /window\.mcSheet\.close\(\)/.test(dlg), 'a link inside is a navigation: the dialog and the sheet under it close');
});

test('About is the dialog, carries every footer door, and copies them', () => {
  const about = chrome.slice(chrome.indexOf('async openAbout()'), chrome.indexOf('_copyFallback(text: string'));
  assert.ok(/mcDialog\(\{ title: 'About this app', body: wrap, actions: \[reload, copy\] \}\)/.test(about), 'About opens the dialog');
  assert.ok(!/_aboutPanel/.test(chrome), 'the gray inline panel is gone');
  const links = /const FOOTER_LINKS: Array<\[string, string\]> = \[([\s\S]*?)\];/.exec(chrome);
  assert.ok(links, 'FOOTER_LINKS is the data');
  for (const href of ['index.html', 'library.html', 'community.html', 'about.html', 'contact.html', 'terms.html', 'privacy.html']) {
    assert.ok(links[1].includes(`'${href}'`), `About lists ${href}`);
  }
  /* The static footer partial names the same doors — About must not fall behind it. */
  const partial = readFileSync(join(root, 'partials', 'footer.html'), 'utf8');
  for (const m of partial.matchAll(/href="([a-z-]+\.html)"/g)) assert.ok(links[1].includes(`'${m[1]}'`), `the partial's ${m[1]} is in About`);
  assert.ok(/_aboutCopyText\(\) \{[\s\S]*FOOTER_LINKS\.map\(\(\[label, href\]\) => label \+ ': ' \+ new URL\(href, location\.href\)\.href\)/.test(about),
    'Copy hands over the doors as absolute URLs');
  assert.ok(/const text = this\._aboutCopyText\(\);/.test(chrome), 'the Copy button copies that text');
});
