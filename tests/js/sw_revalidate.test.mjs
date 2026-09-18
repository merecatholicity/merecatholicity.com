/* The service worker's staleness question: "has this document changed?"
 *
 * It had been answered by comparing the bytes of a fresh fetch against the
 * cached copy — and the bytes of this site's HTML are not ours alone. The zone
 * runs Cloudflare's JavaScript Detections (terraform/zone.tf, enable_js), which
 * appends a <script> carrying a per-RESPONSE ray id to every HTML body. Three
 * fetches of /index.html on 2026-09-17 returned three distinct bodies, one line
 * apart, so the answer was YES every single time: every cached page served went
 * on to tell every open page "your page is stale" (mc-page-updated), and
 * nav.js's heal policy reloaded any document under 30 s old. On Home that
 * reload replayed the launch splash — the owner's report: "I tapped home and it
 * refreshed itself, even showing the splash screen".
 *
 * The filter below is the fix and these run it, against the real injected block
 * captured from a live response. The second half is the guard that matters just
 * as much: it must not strip so much that a REAL change stops being seen.
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
const siteBytes = new Function(region + '\nreturn siteBytes;')();

/* Cloudflare's JavaScript Detections block, captured verbatim from a live
   response to https://merecatholicity.com/index.html on 2026-09-17. Only r:
   (the ray) and t: move from one response to the next; nothing here is ours. */
const CF = `<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'@RAY@',t:'@TS@'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>`;
const cf = (ray, ts) => CF.replace('@RAY@', ray).replace('@TS@', ts);

/* A page in the shape of ours: the inline theme/splash script (the one thing on
   the page that must never be filtered away), a stamped asset key, and the
   edge's tail last. */
const page = ({ ray = 'a3ce55bcbfcaed3c', ts = 'MTc4OTcxMzM3MQ==', v = '1784160000',
  title = 'Mere Catholicity', boot = "e.setAttribute('data-theme','dark')" } = {}) =>
  '<!DOCTYPE html><html><head>' +
  '<script id="mc-fout">(function(){var e=document.documentElement;' + boot + '})();</script>' +
  '<title>' + title + '</title><link rel="stylesheet" href="style.css?v=' + v + '">' +
  '</head><body><main>Home</main>' +
  '<script src="app.js?v=' + v + '"></script>' + cf(ray, ts) + '</body></html>';


test('two responses for one unchanged page are the same document', () => {
  const first = page({ ray: 'a3ce532a0f8964b6' });
  const second = page({ ray: 'a3ce532b8c2b58dc' });
  assert.notEqual(first, second, 'the fixture must differ byte for byte, or it proves nothing');
  assert.equal(siteBytes(first), siteBytes(second),
    'a ray id is not a deploy — this is the reload the owner saw');
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
  assert.ok(!out.includes('__CF$cv$params'), "the edge's injection must be gone");
  assert.ok(!out.includes('/cdn-cgi/'), 'no cdn-cgi reference may survive the filter');
  assert.ok(out.includes('mc-fout') && out.includes("data-theme"),
    'our own inline script must survive it whole');
  assert.ok(out.includes('app.js?v=') && out.includes('<main>Home</main>'),
    'our own markup must survive it whole');
});

test('nothing left in the worker compares two bodies byte for byte', () => {
  /* A class bug, not one site: any future road that revalidates a document has
     the same edge to discount. The comparison in the fetch handler is the only
     one today, and it goes through the filter. */
  assert.ok(/siteBytes\(fresh\) === siteBytes\(stale\)/.test(sw),
    'the page revalidation must compare siteBytes(), not raw text');
  assert.ok(!/\bfresh === stale\b/.test(sw),
    'a raw body comparison is back: the edge rewrites every HTML response');
});
