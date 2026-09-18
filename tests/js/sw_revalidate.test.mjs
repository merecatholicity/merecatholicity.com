/* The service worker's staleness question: "has this document changed?"
 *
 * It had been answered by comparing the bytes of a fresh fetch against the
 * cached copy — and the bytes of this site's HTML are not ours alone. The zone's
 * bot management (terraform/zone.tf) injects a per-RESPONSE token into every
 * HTML body, and not the same one for everybody: a real browser gets a hidden
 * crawler-protection link (.../cdn-cgi/content?id=<token>, measured headless
 * against prod on 2026-09-18 — two fetches of each cached page, four pairs of
 * different bodies), while curl gets JavaScript Detections' <script> and its
 * ray (three fetches, three bodies, 2026-09-17). So the answer was YES every
 * single time: every cached page served went on to tell every open page "your
 * page is stale" (mc-page-updated), and nav.js's heal policy reloaded any
 * document under 30 s old. On Home that reload replayed the launch splash —
 * the owner's report: "I tapped home and it refreshed itself, even showing the
 * splash screen".
 *
 * Both halves of the cure are run here against the real injected markup,
 * captured from live responses: `siteBytes`, which must neutralize the edge
 * without stripping so much that a REAL change stops being seen, and
 * `codeKeys`, the belt — nobody is told to heal unless the ?v= keys moved, so
 * whatever the edge injects NEXT cannot cost a reader their page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sw = readFileSync(join(root, 'docs', 'sw.js'), 'utf8');

/* sw.js is a classic worker script — no exports, and evaluating the whole of it
   would want `caches` and `self`. So the filter is sliced out by its two
   anchors and RUN. Both anchors are asserted first: a rename fails here loudly
   rather than leaving these tests quietly exercising a copy of dead code. */
const OPEN = 'var SCRIPT_TAG =';
const CLOSE = '/* end of the edge filter */';

test('these tests run the filter that actually ships', () => {
  assert.ok(sw.includes(OPEN) && sw.includes(CLOSE),
    'the edge filter in docs/sw.js was renamed — update the anchors here too');
  assert.ok(sw.indexOf(CLOSE) > sw.indexOf(OPEN), 'the anchors are out of order');
});

const region = sw.slice(sw.indexOf(OPEN), sw.indexOf(CLOSE));
const [siteBytes, codeKeys] = new Function(region + '\nreturn [siteBytes, codeKeys];')();

/* Cloudflare's JavaScript Detections block, captured verbatim from a live
   response to https://merecatholicity.com/index.html on 2026-09-17. Only r:
   (the ray) and t: move from one response to the next; nothing here is ours. */
const CF = `<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'@RAY@',t:'@TS@'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>`;
const cf = (ray, ts) => (ray === null ? '' : CF.replace('@RAY@', ray).replace('@TS@', ts));

/* The crawler-protection honeypot, captured verbatim from a live response to
   https://merecatholicity.com/index.html on 2026-09-18 — what a REAL browser is
   served, right after <body>. Only the id moves from one response to the next. */
const HONEYPOT = '<a href="https://merecatholicity.com/cdn-cgi/content?id=@ID@" aria-hidden="true"' +
  ' rel="nofollow noopener" style="display: none !important; visibility: hidden !important"></a>';
const honeypot = (id) => HONEYPOT.replace('@ID@', id);

/* A page in the shape of ours: the inline theme/splash script (the one thing on
   the page that must never be filtered away), a stamped asset key, and the
   edge's two injections around our markup. */
const page = ({ ray = 'a3ce55bcbfcaed3c', ts = 'MTc4OTcxMzM3MQ==', v = '1784160000',
  id = 'YD294hwiEd1vfTc6PnzJA65W.N2NgDM9nS4AoTqEfrA-1789715778.1143563-1.2.1.1-q0igv3HKThBA9E',
  title = 'Mere Catholicity', boot = "e.setAttribute('data-theme','dark')" } = {}) =>
  '<!DOCTYPE html><html><head>' +
  '<script id="mc-fout">(function(){var e=document.documentElement;' + boot + '})();</script>' +
  '<title>' + title + '</title><link rel="stylesheet" href="style.css?v=' + v + '">' +
  '</head><body>' + honeypot(id) + '<main>Home</main>' +
  '<script src="app.js?v=' + v + '"></script>' + cf(ray, ts) + '</body></html>';


test('two responses for one unchanged page are the same document', () => {
  /* Both injections at once, each with its own token, which is the worst the
     edge has been seen to do. */
  const first = page({ ray: 'a3ce532a0f8964b6', id: 'k.6UxvK3xC-1789715778.1143563-1.2.1.1-q0igv3' });
  const second = page({ ray: 'a3ce532b8c2b58dc', id: 'iMDDNpCyhD-1789715778.4348195-1.2.1.1-CZnbJg' });
  assert.notEqual(first, second, 'the fixture must differ byte for byte, or it proves nothing');
  assert.equal(siteBytes(first), siteBytes(second),
    'a ray id and a honeypot token are not a deploy — this is the reload the owner saw');
});

test('the honeypot alone is enough to have caused it', () => {
  /* What a real browser is actually served: no JSD script at all, one hidden
     link whose token moves every response. The shipped-and-then-corrected
     filter (2026-09-18) stripped <script> only, and missed exactly this. */
  const one = page({ ray: null, id: 'T_nbrzRmmb-1789715778.1143563-1.2.1.1-aaaaaa' });
  const two = page({ ray: null, id: 'LxWrAtbxu4-1789715778.4348195-1.2.1.1-bbbbbb' });
  assert.notEqual(one, two);
  assert.equal(siteBytes(one), siteBytes(two));
});

test('nobody is told to heal unless the code moved', () => {
  /* The belt. Whatever the edge injects next — a third token, in a shape
     nothing here anticipates — it cannot reload a reader's page, because a
     reload is justified by the ?v= keys and by nothing else. */
  const invented = (t) => page().replace('<main>Home</main>',
    '<main>Home</main><img src="/cdn-cgi/beacon/' + t + '.gif" alt="">');
  assert.equal(codeKeys(siteBytes(invented('aaa'))), codeKeys(siteBytes(invented('bbb'))),
    'an unforeseen injection must never look like a code change');
  assert.equal(codeKeys(siteBytes(page())), codeKeys(siteBytes(page({ title: 'Community' }))),
    'markup that moves without the keys refreshes the cache and wakes nobody');
  assert.notEqual(codeKeys(siteBytes(page({ v: '1784160000' }))),
    codeKeys(siteBytes(page({ v: '1784999999' }))), 'a deploy IS a reason to heal');
});

test('the honeypot URL is not mistaken for an asset key', () => {
  /* It carries ?id=, not ?v=, and it is collapsed before codeKeys ever sees it
     — but the assertion is cheap and the failure would be a reload loop. */
  assert.ok(!codeKeys(siteBytes(page())).includes('cdn-cgi'));
  assert.ok(codeKeys(siteBytes(page())).includes('app.js?v='));
});

test('a deploy is still a change', () => {
  /* The whole point of the mechanism: a cached skeleton carrying last deploy's
     ?v= keys IS stale, and the page must be told. */
  assert.notEqual(siteBytes(page({ v: '1784160000' })), siteBytes(page({ v: '1784999999' })));
});

test('a change to our own inline script is still a change', () => {
  /* The guard against over-stripping. The theme and launch-splash script is
     INLINE, so a filter that took out every <script> would go blind to the one
     script most likely to change — and would have hidden the very fix that
     stops the splash replaying. */
  assert.notEqual(siteBytes(page()), siteBytes(page({ boot: "e.setAttribute('data-theme','light')" })));
});

test('changed content is still a change', () => {
  assert.notEqual(siteBytes(page()), siteBytes(page({ title: 'Community' })));
});

test('it removes the edge and nothing else', () => {
  const out = siteBytes(page());
  assert.ok(!out.includes('__CF$cv$params'), "the edge's script must be gone");
  assert.ok(!/\/cdn-cgi\/[^"'\s<>]/.test(out),
    'every cdn-cgi URL must be collapsed to its bare path, token and all');
  assert.ok(out.includes('/cdn-cgi/"'), 'the honeypot element itself stays, tokenless');
  assert.ok(out.includes('mc-fout') && out.includes("data-theme"),
    'our own inline script must survive it whole');
  assert.ok(out.includes('app.js?v=') && out.includes('<main>Home</main>'),
    'our own markup must survive it whole');
});

test('nothing left in the worker compares two bodies byte for byte', () => {
  /* A class bug, not one site: any future road that revalidates a document has
     the same edge to discount. The comparison in the fetch handler is the only
     one today, and it goes through the filter. */
  assert.ok(/siteBytes\(fresh\), s = siteBytes\(stale\)/.test(sw),
    'the page revalidation must compare siteBytes(), not raw text');
  assert.ok(!/\bfresh === stale\b/.test(sw),
    'a raw body comparison is back: the edge rewrites every HTML response');
  assert.ok(/if \(codeKeys\(f\) === codeKeys\(s\)\) return;[\s\S]{0,200}mc-page-updated/.test(sw),
    'mc-page-updated — the message that reloads a reader — must be gated on codeKeys');
});
