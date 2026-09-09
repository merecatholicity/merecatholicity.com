/* In-app hops must be soft, and must name their real destination.
 *
 * Two defects with one symptom shipped together (2026-09-07): readers saw "a
 * white flash and a hard total page reload" when they opened a conversation,
 * posted, or searched.
 *
 *   1. Code moved the app with `location.href = …`, which is a full document
 *      load — the shell's whole soft-navigation layer bypassed.
 *   2. Two live links still pointed at RETIRED urls (community.html?dm=,
 *      ?post=). Those resolve: the router redirects them. But the redirect is
 *      a SECOND full load, so one tap cost two documents.
 *
 * Both are invisible in review and neither breaks a page, so they are held
 * here instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* Files that navigate on the reader's behalf. */
const SOURCES = [
  'client/comments.ts',
  ...readdirSync(join(root, 'app', 'views')).filter((f) => f.endsWith('.ts')).map((f) => 'app/views/' + f),
  'app/appchrome.ts',
];

/* The hops that are deliberately FULL loads, each for a stated reason. A new
   entry here should be arguable out loud, not a convenience. */
const HARD_ON_PURPOSE = {
  'terms.html': 'the identity was just revoked; only a fresh document is sure to leave nothing keyed to it',
  'index.html': 'logout, and the no-history fallback of the Back control',
  'profile.html': 'the client is not loaded — a full load is how it arrives',
};

function hardNavs(src) {
  const out = [];
  const re = /location\.(?:href\s*=|replace\(|assign\()\s*'([^']*\.html[^']*)'/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

test('nothing moves the app with a full document load unless it means to', () => {
  for (const f of SOURCES) {
    for (const target of hardNavs(read(f))) {
      const page = target.split('?')[0].split('#')[0];
      assert.ok(Object.prototype.hasOwnProperty.call(HARD_ON_PURPOSE, page),
        `${f} navigates to ${target} with location.href/replace — that is a full document ` +
        'load (white flash, lost scroll, dropped live socket). Use go() in the client, ' +
        'goto() in a Lit view, or window.mcNav; if the full load is genuinely wanted, ' +
        'say why and add the page to HARD_ON_PURPOSE.');
    }
  }
});

/* The retired urls the router still answers, and their real homes. Keeping
   this table here means a NEW legacy alias is only ever added on purpose. */
const RETIRED = [
  ['community.html?dm=', 'messages.html?dm='],
  ['community.html?inbox', 'messages.html'],
  ['community.html?me=', 'profile.html'],
  ['community.html?profile=', 'profile.html?u='],
  ['community.html?post=', 'feed.html?post='],
  ['community.html?feed=', 'feed.html'],
];

test('no live link points at a url the router will only redirect', () => {
  for (const f of SOURCES) {
    const src = read(f);
    for (const [old, real] of RETIRED) {
      /* The router's own switch names these to redirect them; that is the
         one legitimate mention, and it reads the params, never the url. */
      const idx = src.indexOf("'" + old);
      assert.equal(idx, -1,
        `${f} links to ${old} — retired. It resolves only because the router ` +
        `redirects it, and that redirect is a second full page load. Link ${real} instead.`);
    }
  }
});

test('the shell exposes the programmatic door these callers need', () => {
  const shell = read('app/shell.ts');
  assert.ok(/window\.mcNav = function/.test(shell), 'window.mcNav is gone');
  assert.ok(/softNav\(url, !replace\)/.test(shell), 'mcNav must run the ordinary soft navigation');
  assert.ok(/if \(!sameOrigin\(url\) \|\| !pageish\(url\)/.test(shell),
    'mcNav must fall back to a real load for anything the shell cannot carry');
  const util = read('app/views/util.ts');
  assert.ok(/export function goto\(/.test(util), 'the Lit views lost their goto helper');
  assert.ok(/window\.mcNav/.test(read('client/comments.ts')), 'the classic client lost its go() bridge');
});

/* The other half of instant navigation: a view can now be swapped away with a
 * Lit update still queued, so a lifecycle hook can run on a DETACHED element.
 * `this.parentElement` is null there, and the composer mounts threw on it
 * (prod, the moment DM links stopped being full page loads). Any view that
 * mounts imperative machinery into its parent must check first.
 */
test('a view never mounts into a parent it no longer has', () => {
  for (const f of ['app/views/board.ts', 'app/views/topic.ts']) {
    const src = read(f);
    /* Every hook that reads this.parentElement outside a click callback must
       stand behind the connected check. */
    assert.ok(/if \(!this\.isConnected \|\| !this\.parentElement\) return;/.test(src),
      `${f} reads this.parentElement in a lifecycle hook with no connected guard — ` +
      'an instant soft navigation can run that hook after the element is gone, and ' +
      'the read throws.');
  }
});

/* Pages that must arrive by a FULL document load, each with its reason. The
   shell keeps them in DOCUMENT_PAGES and every door consults it. A page joins
   this list only with an argument, because a full load is exactly what soft
   navigation exists to avoid. */
const DOCUMENT_PAGES = {
  'contact.html': 'its Turnstile challenge has nobody to spare and completes only on a hard-loaded document (2026-09-09)',
};

test('the document pages are the ones argued for, and every door honours them', () => {
  const shell = read('app/shell.ts');
  const m = shell.match(/var DOCUMENT_PAGES = \[([^\]]*)\];/);
  assert.ok(m, 'the shell no longer declares DOCUMENT_PAGES');
  const declared = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(declared.sort(), Object.keys(DOCUMENT_PAGES).sort(),
    'the shell\'s DOCUMENT_PAGES and this table must agree — add the reason here');
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, '');
  /* the click interceptor */
  const click = code.slice(code.indexOf("document.addEventListener('click'"), code.indexOf('window.mcNav = '));
  assert.ok(/if \(documentPage\(url\)\) return;/.test(click), 'the click interceptor must let a document page load natively');
  /* the programmatic door */
  const nav = code.slice(code.indexOf('window.mcNav = '), code.indexOf("window.addEventListener('popstate'"));
  assert.ok(/documentPage\(url\)\) \{ location\.href = url\.href; return; \}/.test(nav), 'mcNav must fall through to a real load for a document page');
  /* the history walk */
  const pop = code.slice(code.indexOf("window.addEventListener('popstate'"));
  assert.ok(/if \(documentPage\(u\)\) \{ location\.reload\(\); return; \}/.test(pop), 'back/forward into a document page must reload, not swap');
});
