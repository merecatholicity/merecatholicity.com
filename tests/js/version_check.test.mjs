/* "Is this device running the current app?" — the rules of the update notice.
 *
 * It lives in docs/nav.js rather than the bundle for the same reason the
 * service-worker pump does: nav.js is the first script on every page and keeps
 * working when the stale thing IS the app bundle. That placement means it
 * cannot be imported, so these hold its shape and its refusals; the behaviour
 * end-to-end is covered headlessly against a served page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nav = readFileSync(join(root, 'docs', 'nav.js'), 'utf8');
const block = nav.slice(nav.indexOf('IS THIS DEVICE RUNNING THE CURRENT APP?'),
  nav.indexOf('/* ?debug=1'));

test('it compares what is LOADED, not a version compiled in', () => {
  /* The whole point. A stamped-in build id would say "I am build X" and be
     right about itself while the page around it was stale — and a browser- or
     service-worker-cached HTML skeleton carrying older ?v= keys than the
     kernel it talks to is the exact hazard this site has hit. The URLs on the
     page cannot lie about what is running. */
  assert.ok(/document\.querySelectorAll\('script\[src\], link\[href\]'\)/.test(block),
    'the running version must be read off the live script/link URLs');
  assert.ok(!/MC_BUILD|BUILD_ID/.test(block),
    'a compiled-in build constant is exactly what this must not use');
});

test('the freshness question is never answered from the cache', () => {
  assert.ok(/fetch\(VERSION_URL, \{ cache: 'no-store' \}\)/.test(block),
    "version.json must be fetched no-store — asking a cache whether it is stale " +
    'is not a question that can be answered');
});

test('only assets the page actually carries are judged', () => {
  /* A page that does not load comments.js is not out of date for lacking it. */
  assert.ok(/served\[k\] && served\[k\] !== have\[k\]/.test(block),
    'staleness must require the asset to be present on BOTH sides');
});

test('it prompts and never acts', () => {
  /* The owner's explicit call, after a week of the app reloading itself out
     from under its reader. There is no automatic reload in here. */
  assert.ok(/location\.reload\(\)/.test(block), 'the Reload button must work');
  const reloads = block.match(/location\.reload\(\)/g) || [];
  assert.equal(reloads.length, 1, 'exactly one reload, and it is the button');
  const btn = block.slice(block.indexOf('go.onclick'), block.indexOf('var later'));
  assert.ok(/location\.reload\(\)/.test(btn), 'the only reload must be the button handler');
});

test('it never appears over a half-written post', () => {
  assert.ok(/if \(typingNow\(\)\) return;/.test(block), 'the typing guard is gone');
  /* And it shares the guard rather than growing a second copy: two versions of
     "is the reader mid-compose" would drift, and the drifted one would be the
     one that interrupted somebody. */
  assert.ok(/window\.mcTyping/.test(block), 'must reuse the shared guard');
  assert.ok(/window\.mcTyping = typing;/.test(nav), 'nav.js must publish the shared guard');
});

test('dismissal is remembered per build, so it does not nag', () => {
  assert.ok(/sessionStorage\.setItem\('mc-ver-hide', build\)/.test(block));
  assert.ok(/sessionStorage\.getItem\('mc-ver-hide'\) === build/.test(block),
    'a NEW build must be announced even if the previous one was dismissed');
});

test('a soft navigation does not silently drop the notice', () => {
  /* data-mc-app marks furniture the app shell preserves across a <main> swap,
     the same marker the progress bar and the audio dock use. */
  assert.ok(/bar\.setAttribute\('data-mc-app', ''\)/.test(block));
});

test('being offline is not an error worth showing anyone', () => {
  assert.ok(/\.catch\(function \(\) \{ return null; \}\)/.test(block),
    'a failed check must be silent — a plane or a tunnel is not a stale app');
});

test('the check is paced, and costs the free tier nothing', () => {
  /* Same rhythm as the service-worker pump: foreground, restored page, hourly,
     one per five minutes. version.json is static Pages content — no worker
     request, so this adds nothing to the request budget. */
  assert.ok(/if \(now - last < 300000\) return;/.test(block), 'the 5-minute throttle is gone');
  assert.ok(/visibilitychange/.test(block) && /pageshow/.test(block)
    && /setInterval\(paced, 3600000\)/.test(block), 'a trigger is missing');
});

test('Settings can ask the same question and get the same answer', () => {
  /* One source of truth: the About panel reads this, rather than re-deriving
     staleness and risking a panel that disagrees with the banner. */
  assert.ok(/window\.mcVersion = \{/.test(block));
  for (const k of ['running:', 'served:', 'stale:', 'check:']) {
    assert.ok(block.includes(k), `window.mcVersion.${k} is missing`);
  }
  const chrome = readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');
  assert.ok(/window\.mcVersion/.test(chrome), 'the About panel must read it, not re-derive it');
});
