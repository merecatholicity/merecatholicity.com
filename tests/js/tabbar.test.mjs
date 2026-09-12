/* The bottom bar is six equal tabs, and the Inbox badge is a spoken count
 * (2026-09-11, the owner's two asks).
 *
 * What would break silently: the raised hero creeping back (it cannot be
 * centred in a six-item bar — that is why it went); a tab left at the default
 * `min-width: auto`, where the longest label refuses to shrink and eats its
 * neighbours' width on a narrow phone; the badge reaching a screen reader as a
 * red disc that says nothing; the phone bar and the desktop rail drifting apart
 * over which number they show. None of these turn anything red by themselves,
 * so the rules are read straight out of the chrome's source and its stylesheet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');
const chrome = readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');

test('no tab is a hero: the markup and the stylesheet agree there is no such thing', () => {
  assert.ok(!/mc-tab-hero/.test(chrome) && !/mc-tab-hero/.test(css), 'the raised centre hero is gone from both halves');
  assert.ok(!/\bhero\?: boolean/.test(chrome), 'and so is the flag that drew it');
  const tabbar = chrome.slice(chrome.indexOf('class McTabbar'), chrome.indexOf("customElements.define('mc-tabbar'"));
  assert.ok(/'mc-tab' \+ \(on === t\.key \? ' mc-tab-on' : ''\)/.test(tabbar),
    'a tab carries one class beyond its own: lit or not');
});

test('every tab is an equal slot that may shrink, and its label never wraps', () => {
  const tab = /\.mc-tab \{([^}]*)}/.exec(css);
  assert.ok(tab, 'no .mc-tab rule');
  assert.ok(/flex: 1 1 0;\s*min-width: 0;/.test(tab[1]),
    'equal slots from a zero basis — `flex: 1` alone keeps min-width:auto and the bar goes crooked');
  assert.ok(/font-size: clamp\(/.test(tab[1]), 'the label size follows the viewport so it fits the slot');
  const lbl = /\.mc-tab-lbl \{([^}]*)}/.exec(css);
  assert.ok(lbl && /white-space: nowrap/.test(lbl[1]) && /text-overflow: ellipsis/.test(lbl[1]),
    'the longest word is clipped, never wrapped onto a second line the bar has no room for');
});

test('the Inbox badge is the DM count, and both the phone bar and the desktop rail say it aloud', () => {
  assert.ok(/{ key: 'messages', label: 'Inbox', svg: 'inbox', href: 'messages\.html', badge: 'dm' }/.test(chrome),
    'the Inbox tab is the one that carries a badge');
  assert.ok(/const raw = localStorage\.getItem\(which === 'dm' \? 'mc-dm-unread' : 'mc-notif-unread'\);/.test(chrome),
    'the count is read from the cache the DM client keeps — the chrome never fetches');
  assert.ok(/function badgeLabel\(label: string, n: number\) \{\s*return n \? label \+ ', ' \+ n \+ \(n === 1 \? ' unread message' : ' unread messages'\) : label;/.test(chrome),
    'a badge is spoken in the tab\'s own label');
  const spoken = chrome.match(/aria-label=\$\{badgeLabel\(t\.label, (?:t\.badge === 'dm' \? this\.dm : 0|n)\)\}/g) || [];
  assert.equal(spoken.length, 2, 'both the phone tab bar and the desktop rail label their badge');
  assert.ok(/badgeText\(n: number\) \{ return n > 99 \? '99\+' : String\(n\); \}/.test(chrome), 'and the disc itself caps at 99+');
});
