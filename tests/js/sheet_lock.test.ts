/* While a sheet is open, the sheet is the only thing that scrolls.
 *
 * The live report (2026-09-09, phones): scrolling the Settings sheet usually
 * moved the sheet, but sometimes moved the page behind it. A touch reaches the
 * document by three roads — scroll chaining off the sheet's edge (or off a sheet
 * too short to scroll), a drag on the scrim, and the document simply being
 * scrollable underneath — and the fix closes all three. These tests hold each
 * road shut, in the source they live in, so a later edit that reopens one fails
 * here rather than in someone's hand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');
const chrome = readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');
const ptr = readFileSync(join(root, 'app', 'ptr.ts'), 'utf8');

/* The body of every rule whose selector list is exactly `sel`. */
function rules(sel) {
  const out = [];
  const re = new RegExp('(^|[}\\n])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) out.push(m[2]);
  return out;
}

test('the sheet contains its own overscroll, on phones and on desktop', () => {
  /* A scroll container at its edge hands the gesture to the next scroller up,
     which is the document. `contain` ends the chain at the sheet — including a
     sheet whose content is too short to scroll at all. */
  const bodies = rules('.mc-sheet');
  assert.equal(bodies.length, 2, 'expected the mobile and the desktop .mc-sheet rules');
  for (const b of bodies) assert.ok(/overscroll-behavior:\s*contain/.test(b), '.mc-sheet must set overscroll-behavior: contain');
  assert.ok(bodies.some((b) => /touch-action:\s*pan-y/.test(b)), 'the phone sheet allows only vertical panning');
});

test('the scrim is inert to touch', () => {
  const bodies = rules('.mc-sheet-scrim');
  assert.equal(bodies.length, 2, 'expected the mobile and the desktop .mc-sheet-scrim rules');
  for (const b of bodies) assert.ok(/touch-action:\s*none/.test(b), 'a drag on the scrim must not scroll the document');
});

test('the document is locked underneath an open sheet', () => {
  /* The road every engine honours: with the body fixed there is nothing behind
     the sheet that CAN scroll. The offset rides in the inline `top`. */
  assert.ok(/html\.mc-sheet-open,\s*html\.mc-sheet-open body\s*\{[^}]*overflow:\s*hidden/.test(css),
    'html.mc-sheet-open must hide overflow on html and body');
  assert.ok(/html\.mc-sheet-open body\s*\{[^}]*position:\s*fixed/.test(css),
    'html.mc-sheet-open body must be position: fixed — overflow alone is not honoured by every touch engine');
  assert.ok(/html\.mc-sheet-open body\s*\{[^}]*width:\s*100%/.test(css), 'a fixed body must keep its width');
});

test('mc-sheet holds the lock for exactly as long as it is open', () => {
  const cls = chrome.slice(chrome.indexOf('class McSheet extends LitElement'), chrome.indexOf("customElements.define('mc-sheet'"));
  const upd = cls.slice(cls.indexOf('updated(changed'), cls.indexOf('dragStart('));
  assert.ok(/changed\.has\('open'\)/.test(upd) && /lockDocument\(\)/.test(upd) && /unlockDocument\(\)/.test(upd),
    'updated() must lock on open and unlock on close');
  const dc = cls.slice(cls.indexOf('disconnectedCallback()'), cls.indexOf('_focusables()'));
  assert.ok(/unlockDocument\(\)/.test(dc), 'a sheet that leaves the document must release the lock');
});

test('the lock remembers where the page was and puts it back, instantly', () => {
  const lock = chrome.slice(chrome.indexOf('function lockDocument()'), chrome.indexOf('function unlockDocument()'));
  const unlock = chrome.slice(chrome.indexOf('function unlockDocument()'), chrome.indexOf('class McSheet'));
  assert.ok(/lockY = window\.scrollY/.test(lock), 'the lock must record the scroll offset');
  assert.ok(/body\.style\.top = \(-lockY\)/.test(lock), 'the offset rides in the body\'s inline top so the page does not visibly move');
  assert.ok(/classList\.add\('mc-sheet-open'\)/.test(lock) && /classList\.remove\('mc-sheet-open'\)/.test(unlock),
    'the CSS keys on html.mc-sheet-open');
  assert.ok(/behavior:\s*'instant'/.test(unlock), 'restoring the offset must never animate');
  assert.ok(/paddingRight/.test(lock) && /paddingRight = ''/.test(unlock),
    'desktop: the vanished scrollbar\'s width is padded back, and the padding is removed again');
  assert.ok(/if \(lockY !== null\) return;/.test(lock), 'one lock for the document, however many sheets ask');
});

test('pull-to-refresh never arms from the scrim or under a locked document', () => {
  /* With the body fixed, window.scrollY reads 0 whatever the real offset, so
     the "at the top" test would lie; and the scrim is not the page. */
  const el = ptr.slice(ptr.indexOf('function eligible('), ptr.indexOf("document.addEventListener('touchstart'"));
  assert.ok(/\.mc-sheet-scrim/.test(el), 'the scrim must be on the ignore list');
  assert.ok(/mc-sheet-open/.test(el), 'a locked document must not be eligible');
});
