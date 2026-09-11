/* The merecat ask row is the DM composer's shape, flush on the tab bar
 * (2026-09-11).
 *
 * What broke silently: main.css fixed the row above the tab bar with
 * `margin: 0`, and the injected #mc-merecat-css (appended later, equal
 * specificity, so it wins) gave it `margin: .8rem 0 .2rem` — for a fixed
 * element `bottom` places the MARGIN edge, so the bar floated .2rem above
 * the tab bar; and the same block stacked the field and a full-width button
 * in a column on phones. The two stylesheets must agree on phones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');
import { clientAll } from '../_support/client.mjs';
const src = clientAll();
/* The injected block as the browser receives it: the source fragments joined
   at their `' +` seams (a regex over the raw source stops at the first quote). */
const injectedRaw = src.slice(src.indexOf("'.merecat-form{display:flex"), src.indexOf("mc-merecat-css", src.indexOf("'.merecat-form{display:flex")));
const injected = injectedRaw.replace(/'\s*\+\s*(?:\/\*[\s\S]*?\*\/\s*)?'/g, '').replace(/^'/, '');

test('on phones the injected merecat block agrees with main.css: a row, margin 0', () => {
  const phoneInjected = /@media \(max-width:600px\)\{\.merecat-form\{flex-direction:row;align-items:flex-end;margin:0\}([^']*?)\}';/.exec(injected);
  assert.ok(phoneInjected, 'the injected block must zero the margin and keep the row on phones — it is appended later and wins');
  assert.ok(/\.merecat-form \.btn-send\{[^}]*border-radius:50%/.test(phoneInjected[1]) && /\.merecat-ask-word\{display:none\}/.test(phoneInjected[1]),
    'and it repeats the round icon-only button, since its own 22px pill would win over main.css');
  assert.ok(!/\.merecat-form\{flex-direction:column/.test(injected), 'no column stacking anywhere');
  const phone = css.slice(css.indexOf('section:has(.merecat-form)'), css.indexOf('.merecat-quota'));
  assert.ok(/\.merecat-form \{[^}]*position: fixed/.test(phone) && /\.merecat-form \{[^}]*flex-direction: row/.test(phone) && /\.merecat-form \{[^}]*margin: 0;/.test(phone),
    'main.css fixes the row on the tab bar with margin 0');
  assert.ok(/\.merecat-form \.btn-send \{[^}]*border-radius: 50%/.test(phone) && /\.merecat-ask-word \{ display: none; \}/.test(phone),
    'the send button is round on phones, its word hidden');
});

test('the field is one row and grows with the words; a cleared box shrinks back', () => {
  const view = src.slice(src.indexOf("var form = el('form', 'merecat-form');"), src.indexOf("var askPlaceholder = q.placeholder;"));
  assert.ok(/q\.rows = 1;/.test(view), 'one row');
  const grow = view.slice(view.indexOf('q.mcGrow = function'), view.indexOf("q.addEventListener('input', q.mcGrow)"));
  assert.ok(/if \(!q\.value\) \{ q\.style\.height = ''; return; \}/.test(grow),
    'an empty box is its natural one row — scrollHeight would count a wrapped placeholder (the 390px finding)');
  assert.ok(/Math\.min\(q\.scrollHeight \+ \(q\.offsetHeight - q\.clientHeight\), 168\)/.test(grow),
    'a filled box grows to a few lines, then scrolls — borders added back, since scrollHeight excludes them on a border-box field');
  assert.ok(/q\.placeholder = narrow \? 'Ask the librarian…' : /.test(view), 'a one-line placeholder on phones');
  assert.ok(/send\.appendChild\(mcIcon\('send'\)\);\s*send\.appendChild\(el\('span', 'merecat-ask-word', 'Ask'\)\);/.test(view), 'the icon and the word');
  assert.ok(/q\.value = '';\s*if \(q\.mcGrow\) q\.mcGrow\(\);/.test(src), 'the cleared box shrinks back');
});
