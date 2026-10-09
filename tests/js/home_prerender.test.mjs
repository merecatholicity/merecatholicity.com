/* The Home launcher is painted by the HTML and adopted by the app (app/home.ts,
 * 2026-10-08). It used to exist only once app.js and its chunks had rendered it,
 * which made it the phone's first contentful paint AND its largest, both
 * waiting on ~100 KB of script. Now docs/index.html carries it.
 *
 * Three ways this can go wrong without anything turning red:
 *   · DRIFT. A link added to the launcher's data and not to the page (or the
 *     reverse) shows a reader one launcher on a cold open and another after a
 *     soft navigation. One structure feeds both renderers, and the page must
 *     be what the build writes from it.
 *   · TWO RENDERERS. The string the build writes and the nodes the element
 *     builds when it arrives empty must be the same tree.
 *   · A SHIFT. The Continue row is the one per-reader part. It is in the page
 *     from the start so that filling it in moves nothing, and when there is no
 *     position behind it, it must go away rather than stand as a dead row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HOME_FEATURES, HOME_SECTIONS, homeTree, toHtml, toDom, fillCont, mountLauncher, lastReadPos }
  from '../../app/home.ts';
import { prerendered } from '../../scripts/home_prerender.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
const CSS = readFileSync(join(root, 'styles', 'main.css'), 'utf8');

/* A document just big enough for toDom, fillCont and mountLauncher, whose
   nodes serialize the way toHtml writes. */
function fakeDoc() {
  const VOID = { hr: true };
  const doc = {
    createTextNode: (t) => ({ text: t, ser() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); } }),
    createElement: (tag) => {
      const el = {
        tag, attrs: {}, kids: [], parent: null, ownerDocument: doc,
        get className() { return this.attrs.class || ''; },
        set className(v) { this.attrs.class = v; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        appendChild(c) { c.parent = this; this.kids.push(c); return c; },
        replaceChildren(...cs) { this.kids = []; cs.forEach((c) => this.appendChild(c)); },
        remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); },
        get classList() {
          const self = this;
          return { add(c) { self.attrs.class = (self.className + ' ' + c).trim(); },
            contains(c) { return self.className.split(' ').includes(c); } };
        },
        set textContent(t) { this.kids = [doc.createTextNode(t)]; },
        get textContent() { return this.kids.map((k) => k.text !== undefined ? k.text : k.textContent).join(''); },
        all() { return this.kids.filter((k) => k.tag).flatMap((k) => [k, ...k.all()]); },
        querySelector(sel) {
          const direct = sel.startsWith(':scope > ');
          const want = direct ? sel.slice(9) : sel;
          const pool = direct ? this.kids.filter((k) => k.tag) : this.all();
          return pool.find((k) => (want[0] === '.' ? k.classList.contains(want.slice(1)) : k.tag === want)) || null;
        },
        ser() {
          let open = '<' + tag + (this.attrs.class ? ' class="' + this.attrs.class + '"' : '');
          Object.keys(this.attrs).filter((k) => k !== 'class').forEach((k) => { open += ' ' + k + '="' + this.attrs[k] + '"'; });
          return VOID[tag] ? open + '>' : open + '>' + this.kids.map((k) => k.ser()).join('') + '</' + tag + '>';
        },
      };
      return el;
    },
  };
  return doc;
}

test('docs/index.html carries the launcher the build writes (node scripts/home_prerender.mjs --write)', () => {
  assert.equal(prerendered(PAGE), PAGE, 'docs/index.html is stale: run node scripts/home_prerender.mjs --write');
  assert.ok(PAGE.indexOf('<main class="prose">\n<mc-home><div class="mc-home">') >= 0,
    'the launcher must be the first thing in <main>, so it paints first');
});

test('every launcher link is in the page, once', () => {
  /* less the Continue row, whose placeholder link is the Library's */
  const block = PAGE.slice(PAGE.indexOf('<mc-home>'), PAGE.indexOf('</mc-home>'))
    .replace(/<a class="mc-home-feat mc-home-cont"[^]*?<\/a>/, '');
  const hrefs = HOME_FEATURES.map((f) => f.href).concat(...HOME_SECTIONS.map((s) => s.items.map((i) => i.href)));
  for (const h of hrefs) {
    assert.equal(block.split('href="' + h + '"').length - 1, 1, h);
  }
});

test('the string the build writes and the nodes the element builds are one tree', () => {
  const doc = fakeDoc();
  assert.equal(toDom(homeTree(), doc).ser(), toHtml(homeTree()));
});

test('an empty element builds the launcher; a painted one is adopted, not rebuilt', () => {
  const doc = fakeDoc();
  const empty = doc.createElement('mc-home');
  mountLauncher(empty, null);
  assert.equal(empty.kids.length, 1);
  assert.equal(empty.kids[0].className, 'mc-home');

  const painted = doc.createElement('mc-home');
  const tree = toDom(homeTree(), doc);
  painted.appendChild(tree);
  mountLauncher(painted, null);
  assert.equal(painted.kids[0], tree, 'the painted launcher must stay the same nodes: a rebuild is a second paint');
});

test('the Continue row takes the reader\'s place, or leaves', () => {
  const doc = fakeDoc();
  const host = doc.createElement('mc-home');
  host.appendChild(toDom(homeTree(), doc));
  fillCont(host, { href: 'anf03.html#c4', title: 'Tertullian' });
  const row = host.querySelector('.mc-home-cont');
  assert.equal(row.getAttribute('href'), 'anf03.html#c4');
  assert.equal(row.querySelector('small').textContent, 'Tertullian');
  assert.ok(row.classList.contains('mc-on'));

  const none = doc.createElement('mc-home');
  none.appendChild(toDom(homeTree(), doc));
  fillCont(none, null);
  assert.equal(none.querySelector('.mc-home-cont'), null, 'no position: no dead row');
});

test('the Continue row holds its place before first paint and never wraps', () => {
  assert.match(CSS, /\.mc-home-cont \{ display: none; \}/);
  assert.match(CSS, /html\.mc-cont \.mc-home-cont, \.mc-home-cont\.mc-on \{ display: flex; \}/,
    'the head script\'s html.mc-cont must show the row from the first frame');
  assert.match(CSS, /\.mc-home-cont small \{ white-space: nowrap;/, 'a long title must not grow the row');
});

test('the painted launcher stays off the plain site', () => {
  assert.match(CSS, /html:not\(\.mc-home-boot\) body:not\(\.mc-app\) main:not\(\.mc-app-home\) > mc-home \{ display: none; \}/,
    '?app=0 and a reader without JS keep the book page');
  assert.match(CSS, /body\.mc-app main:has\(> mc-home\) > :not\(mc-home\) \{ display: none; \}/,
    'a soft navigation to Home must not show the book page until mountHome runs');
});

test('the newest reading position wins, and a broken entry is skipped', () => {
  const entries = [
    ['mc-readpos:anf01.html', JSON.stringify({ id: 'c2', title: 'Clement | Mere Catholicity', at: 5 })],
    ['mc-readpos:npnf101.html', JSON.stringify({ title: 'Augustine', at: 9 })],
    ['mc-readpos:bad.html', '{'],
    ['mc-theme', 'dark'],
  ];
  const store = { length: entries.length, key: (i) => entries[i][0], getItem: (k) => (entries.find((e) => e[0] === k) || [])[1] };
  assert.deepEqual(lastReadPos(store), { href: 'npnf101.html', title: 'Augustine' });
});
