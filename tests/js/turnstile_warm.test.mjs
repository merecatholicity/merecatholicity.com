/* Turnstile guards SIX actions, and the warm must reach all of them.
 *
 * The live evidence (2026-09-08): the first submit called turnstile.execute()
 * and the page was replaced without ever returning a token — the challenge
 * platform navigating the web view at the exact moment the reader committed. So
 * the challenge is asked for EARLIER, when nothing is at stake, and the press
 * spends a token already waiting.
 *
 * The first cut wired that into mdEditor, which covers the four composers and
 * silently missed the profile editor — a per-site list, and it had already
 * grown a hole. These tests hold the structural net in place instead, and fail
 * if a seventh gated action appears without one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'client', 'comments.ts'), 'utf8');

/* Code only: a comment that tells the history of a bug may name it. */
function uncommented(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

/* The enclosing top-level function of a given offset. */
function enclosing(idx) {
  const head = src.slice(0, idx);
  const m = [...head.matchAll(/^ {2}function (\w+)\(/gm)];
  return m.length ? m[m.length - 1][1] : '(top level)';
}

test('every Turnstile-gated action is one of the six we know about', () => {
  const callers = [...src.matchAll(/getToken\(\)\.then/g)].map((m) => enclosing(m.index));
  const known = new Set(['post', 'boardPost', 'wallComposer', 'viewDm', 'editProfile']);
  for (const c of callers) {
    assert.ok(known.has(c),
      `${c}() asks Turnstile for a token and is not in the covered set — give it a ` +
      'warm (a composer via mdEditor, a .ts-slot on its view, or an explicit warmToken()) ' +
      'and add it here, or a reader will meet the challenge at the moment they press.');
  }
  assert.ok(callers.length >= 6, `expected at least 6 gated call sites, found ${callers.length}`);
});

test('the structural net: focus on a gated view warms the challenge', () => {
  /* .ts-slot is the widget's own mount point, so its presence is the honest
     test of "a challenge will be needed here" — no list to maintain. */
  assert.ok(src.includes("document.addEventListener('focusin'"),
    'the focusin warm net is gone');
  assert.ok(src.includes("if (!document.querySelector('.ts-slot')) return;"),
    'the net must key on the widget mount point, not on a hand-kept list of views');
});

test('the avatar upload is warmed too, since a file input focuses no text', () => {
  const i = src.indexOf('  function editProfile(');
  assert.ok(i > 0, 'editProfile is gone');
  const head = src.slice(i, i + 700);
  assert.ok(/warmToken\(\)/.test(head),
    'the profile editor must warm as it opens: its avatar upload is gated and rides a ' +
    'file input, which the focusin net cannot see');
});

test('a token is spent once and never reused', () => {
  /* Turnstile tokens are single-use server-side. Treating the warm as a cache
     would send a second request with a token the server has already burned. */
  /* Assert the SHAPE, not a comment: the first version of this test pinned an
     exact comment string and broke the moment the wording changed, which tells
     you nothing about whether the code is right. */
  const g = src.slice(src.indexOf('function getToken()'), src.indexOf('function rawToken()'));
  assert.ok(/mcTsToken = null;/.test(g), 'taking the token must clear it — they are single-use');
  assert.ok(/return Promise\.resolve\(w\.token\)/.test(g), 'a ready token is spent without a round trip');
  assert.ok(/ensureFreshToken/.test(g), 'and another is earned to replace it');
  assert.ok(/TOKEN_FRESH_MS = \d+/.test(src), 'a stale token must be discarded, not spent');
});

test('the warm never fires for a reader with no identity', () => {
  /* Warming is only meaningful for someone who can actually post, and running
     challenges for every passing reader would be both wasteful and rude. */
  const i = src.indexOf('function warmToken()');
  const body = src.slice(i, src.indexOf('}', src.indexOf('trace(\'turnstile: warming\')', i)));
  assert.ok(body.includes('!state.key'), 'warmToken must bail without an identity');
});

test('nothing calls turnstile.execute() any more — that was the road that killed the page', () => {
  /* The live finding (2026-09-08): with execution:'execute', calling execute()
     in the installed iOS app replaced the document with no pagehide, no error
     and no token — a web view being killed, not a navigation. Warming it
     earlier only moved the white flash to while the reader was typing. Default
     render mode runs the challenge as the widget mounts, by the ordinary
     embedded path, and hands the token to the callback.
     A future edit that reintroduces execute() brings the crash back, so it
     fails here instead. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');   // drop comments first
  assert.ok(!/turnstile\.execute\s*\(/.test(code),
    'turnstile.execute() is back; use render mode and the callback instead');
  assert.ok(!/execution:\s*'execute'/.test(code),
    "execution:'execute' is back; the default (render) is what avoids the crash");
  assert.ok(/appearance:\s*'interaction-only'/.test(code),
    'the widget should still stay invisible unless a human check is needed');
});

test('the wait for the callback is bounded', () => {
  /* With execute() gone the callback is the ONLY road a token arrives by, so
     nothing else would ever make a stuck challenge fail: an unbounded wait
     would hang the submit with the button disabled and no way forward. */
  const i = src.indexOf('function rawToken()');
  const body = src.slice(i, i + 3000);
  assert.ok(/setTimeout\(/.test(body) && /timed out/.test(body),
    'rawToken must time out rather than wait for a callback that may never come');
});

test('a spent token is replaced by resetting the widget, not by executing', () => {
  assert.ok(/turnstile\.reset\(/.test(src),
    'reset() is how render mode earns the next single-use token');
});

test('exactly one widget per document, in a host that survives navigation', () => {
  /* The .ts-slot mount points sit INSIDE <main>, which the shell replaces
     wholesale on every soft navigation — so rendering there tore down a
     Cloudflare challenge iframe and built a fresh one on every view change.
     In an installed iOS app that churn is what takes the page down, and eager
     warming multiplied it. One host, marked with the shell's own data-mc-app
     so it is preserved across swaps, and a widget id ABOVE mcBoot so a new boot
     reuses it rather than rendering another. */
  assert.ok(/function tsHost\(\)/.test(src), 'the persistent host is gone');
  assert.ok(/h\.setAttribute\('data-mc-app', ''\)/.test(src),
    'the host must carry data-mc-app or the shell will swap it away');
  /* And it must be found by that mark, not by class alone: the Lit profile
     rendered a `.mc-ts-host` of its own inside <main>, a bare querySelector
     found it first, the frame mounted INSIDE the view — visible, unstyled — and
     the next swap destroyed it while the page-scoped handle lived on. */
  const th = src.slice(src.indexOf('function tsHost()'), src.indexOf('function tsFrameLive()'));
  assert.ok(/querySelector\('body > \.mc-ts-host\[data-mc-app\]'\)/.test(th),
    "tsHost must accept only the document's own host: body > .mc-ts-host[data-mc-app]");
  for (const f of readdirSync(join(root, 'app', 'views')).filter((n) => n.endsWith('.ts'))) {
    const v = uncommented(readFileSync(join(root, 'app', 'views', f), 'utf8'));
    assert.ok(!/mc-ts-host/.test(v), `app/views/${f} renders a challenge host of its own`);
  }
  const boot = src.indexOf('function mcBoot()');
  assert.ok(src.indexOf('var mcTsWidget') < boot && src.indexOf('var mcTsToken') < boot,
    'the widget id and token must live ABOVE mcBoot, or every soft nav renders a new widget');
  /* Scoped to the render function: an unanchored search would match the first
     render call against any later section.querySelector in a 11k-line file,
     which is how the first version of this assertion failed on correct code. */
  const rw = src.slice(src.indexOf('function renderTurnstileWidget()'));
  const body = rw.slice(0, rw.indexOf('\n  function '));
  assert.ok(/var slot = tsHost\(\);/.test(body),
    'renderTurnstileWidget must mount into the persistent host');
  assert.ok(!/section\.querySelector\('\.ts-slot'\)/.test(body),
    'the widget must not be rendered into a per-view slot any more');
});

test('a human check can still be completed', () => {
  /* Hidden off-screen by default, the widget would be unreachable exactly when
     it matters — a reader asked to verify with no way to do so. */
  assert.ok(/'before-interactive-callback'/.test(src) && /tsHost\(\)\.classList\.add\('on'\)/.test(src),
    'an interactive challenge must bring the host into view');
  assert.ok(/'after-interactive-callback'/.test(src), 'and hide it again afterwards');
});

test('the challenge container is real, not hidden off-screen', () => {
  /* The live finding (2026-09-08): the host was parked at left:-9999px with
   * opacity:0 and pointer-events:none. Cloudflare's widget hides ITSELF via
   * appearance:'interaction-only'; hiding the container as well puts a
   * cross-origin challenge iframe somewhere it can never be composited, and
   * in the installed iOS app the document was taken away about a second after
   * every mount — no pagehide, no error. Whatever else changes here, the
   * container stays reachable.
   */
  const css = src.slice(src.indexOf(".mc-ts-host{"), src.indexOf(".mc-ts-host.on{"));
  assert.ok(!/left:-9999px/.test(css), 'the host is off-screen again');
  assert.ok(!/opacity:0/.test(css), 'the host is transparent again');
  assert.ok(!/pointer-events:none/.test(css), 'the host cannot be touched again');
  assert.ok(!/display:none/.test(css), 'a challenge cannot render into a display:none container');
});

test('opening a view never runs a challenge on its own', () => {
  /* viewDm called loadTurnstile() unconditionally as its composer mounted, so
   * a reader who did nothing but open a conversation ran a challenge — and on
   * the installed app that was when the page died. The first cut of this test
   * checked viewDm and nothing else, and the very next report (2026-09-09) was
   * the same mount-on-open from the four views it had not looked at: the
   * board form, the profile, the feed composer and the page comments. So this
   * is a SWEEP now: every call site is found and must be one of the three
   * that may — the focus warm, a press that finds no token, and the gate's
   * own re-entry once the server has answered. Intent mounts it; arrival
   * never does. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const sites = [...code.matchAll(/(?<!function )loadTurnstile\(\)/g)].map((m) => {
    const head = code.slice(0, m.index);
    const fns = [...head.matchAll(/^ {2}function (\w+)\(/gm)];
    return fns.length ? fns[fns.length - 1][1] : '(top level)';
  });
  const may = new Set(['warmToken', 'rawToken', 'loadTurnstile']);
  for (const s of sites) {
    assert.ok(may.has(s),
      `${s}() mounts the challenge itself — a view that mounts on open runs a challenge for a ` +
      'reader who has only arrived, which is what took the installed app down. Give the ' +
      'surface a .ts-slot and let the focus net (or an explicit warmToken()) do it.');
  }
  assert.ok(sites.includes('warmToken'), 'the focus warm must still mount it');
  assert.ok(sites.includes('rawToken'), 'a press with no warm token must still be able to earn one');
  /* And no Lit view may reach it either: the kit no longer hands it out. */
  assert.ok(!/loadTurnstile:/.test(code), 'the kit exports loadTurnstile again — a view will mount on open');
  for (const f of readdirSync(join(root, 'app', 'views')).filter((n) => n.endsWith('.ts'))) {
    const v = uncommented(readFileSync(join(root, 'app', 'views', f), 'utf8'));
    assert.ok(!/loadTurnstile/.test(v), `app/views/${f} mounts the challenge itself`);
  }
});

test('a spared reader never mounts, whoever asks', () => {
  /* The sparing lived in warmToken() alone, so any other caller of
   * loadTurnstile() — and there were four — ran the challenge for an identity
   * the server would never have asked. The gate sits on the one road every
   * mount takes now: a known-spared identity returns at once, an unknown one
   * asks /config first and mounts only on a "no". */
  const l = src.slice(src.indexOf('function loadTurnstile()'), src.indexOf('function loadTurnstile()') + 1500);
  const body = l.replace(/\/\*[\s\S]*?\*\//g, '');
  const first = body.slice(body.indexOf('{') + 1).trim().split('\n')[0];
  assert.equal(first.trim(), 'if (mcTsSpared) return;', 'the sparing must be the FIRST thing loadTurnstile checks');
  assert.ok(/if \(mcTsSpared === null\)/.test(body) && /tsSkipCfg\(\)/.test(body),
    'an unknown identity must be asked about before anything mounts');
});

test('the challenge runs in its own browsing context', () => {
  /* The sixth attempt at one bug, and the first that does not depend on being
   * right about the cause. Every earlier fix moved WHEN the widget mounted and
   * the symptom moved with it; this one moves WHERE the challenge lives, so a
   * challenge-platform navigation can only take a same-origin iframe the
   * reader never sees. */
  assert.ok(/function tsEnsureFrame\(\)/.test(src), 'the isolating frame is gone');
  assert.ok(/f\.src = asset\('turnstile\.html'\);/.test(src),
    "the frame must load our own page, and take its cache key from nav.js's stamped " +
    'asset map — it was hand-versioned at ?v=1, which is exactly the kind of key ' +
    'nobody remembers to bump (scripts/stamp_versions.py owns it now)');
  const li = src.indexOf('function loadTurnstile()');
  const load = src.slice(li, src.indexOf('\n  function ', li + 1));
  assert.ok(/if \(!mcTsFell\) \{ tsEnsureFrame\(\); return; \}/.test(load),
    'the parent must not load Cloudflare\'s script at all while the frame is carrying it — ' +
    'that script is what mounts the challenge, and the challenge is what took the document');
});

test('a token from the frame is only accepted from the frame', () => {
  /* postMessage is reachable by anything that can get a handle on the window.
     A forged token would be spent against the worker and refused, but the
     origin and source checks are what keep this from being a channel at all. */
  const l = src.slice(src.indexOf("window.addEventListener('message'"), src.indexOf('function getToken()'));
  assert.ok(/e\.origin !== location\.origin/.test(l), 'the listener must check the origin');
  assert.ok(/e\.source !== mcTsFrame\.contentWindow/.test(l),
    'the listener must check the message came from OUR frame, not merely a same-origin one');
});

test('the challenge never re-runs on a timer', () => {
  /* The owner's ring showed two "token ready" entries 292 seconds apart with
   * nobody touching the screen: refresh-expired defaults to 'auto', so the
   * widget re-challenged every time a token aged out, for as long as the page
   * stayed open. Every one of those was another chance to take the document. */
  for (const [file, what] of [['client/comments.ts', 'the in-page fallback'],
                              ['docs/turnstile.html', 'the isolated widget'],
                              ['docs/contact.js', 'the contact form widget']]) {
    const body = readFileSync(join(root, file), 'utf8');
    assert.ok(/'refresh-expired': 'never'/.test(body), `${what} still auto-refreshes its token`);
    assert.ok(/retry: 'never'/.test(body), `${what} still retries a failed challenge on a loop`);
  }
});

test('the host never exists without its stylesheet', () => {
  /* The frame is a 0-height box by rule, and the rule lived in the DM
   * stylesheet, which only the DM, wall and board-media paths inject. On the
   * profile view there was no rule at all, so the frame stood at the iframe
   * default of 300×150 — the "out-of-place white box" of 2026-09-09. The host
   * injects its own sheet as it is created; the two cannot come apart. */
  const th = src.slice(src.indexOf('function tsHost()'), src.indexOf('function tsFrameLive()'));
  assert.ok(/ensureTsStyles\(\);/.test(th), 'tsHost must inject the host stylesheet before anything else');
  const sheet = src.slice(src.indexOf('function ensureTsStyles()'), src.indexOf('function tsHost()'));
  assert.ok(/\.mc-ts-frame\{[^}]*height:0/.test(sheet), 'the frame must be collapsed to 0 height by default');
  assert.ok(/\.mc-ts-host\.on \.mc-ts-frame\{height:\d+px\}/.test(sheet), 'and given height only for a human check');
  assert.ok(/mc-ts-css/.test(sheet), 'the sheet needs its own id so it is injected once');
  const dm = src.slice(src.indexOf('function ensureDmStyles()'), src.indexOf('function ensureTsStyles()'));
  assert.ok(!/mc-ts-/.test(dm), 'the host rules are back in the DM stylesheet, where the profile view cannot see them');
});

test('a frame torn out of the document is rebuilt, not trusted', () => {
  /* The handle is page-scoped and outlives every boot — which is right — but
   * a frame that something removed (a swapped host, a view that owned it)
   * left the handle pointing at nothing: "mounted", never answering, every
   * press running to its timeout. */
  const ef = src.slice(src.indexOf('function tsEnsureFrame()'), src.indexOf('function renderTurnstileWidget()'));
  assert.ok(/mcTsFrame\.isConnected/.test(ef), 'tsEnsureFrame must notice a frame that is no longer in the document');
  assert.ok(/mcTsFrame = null;/.test(ef) && /mcTsFrameReady = false;/.test(ef),
    'and forget it so a fresh one is built');
  const live = src.slice(src.indexOf('function tsFrameLive()'), src.indexOf('function tsMounted()'));
  assert.ok(/isConnected/.test(live), 'liveness must include being in the document');
  const mounted = src.slice(src.indexOf('function tsMounted()'), src.indexOf('function tsEnsureFrame()'));
  assert.ok(/tsFrameLive\(\)/.test(mounted), 'a ready flag alone must not count as mounted');
});

test("the frame page shares the app's colour scheme", () => {
  /* The page says background: transparent, and it was painted solid white:
   * a child document whose used colour scheme differs from its embedder's is
   * rendered with an opaque canvas (CSS Color Adjustment), and the app's root
   * is color-scheme: dark under the dark theme while the page declared none.
   * Declaring both lets the frame take the app's scheme. */
  const page = readFileSync(join(root, 'docs', 'turnstile.html'), 'utf8');
  assert.ok(/html\s*\{[^}]*color-scheme:\s*light dark/.test(page),
    'docs/turnstile.html must declare color-scheme: light dark on html, or it paints white in a dark app');
});

test('the contact page mounts nothing on arrival', () => {
  /* The 2025 design, found still standing on 2026-09-09: Cloudflare's api.js
   * in the markup (the implicit render — the widget mounts the moment the page
   * opens) and a render-on-boot for soft arrivals. The owner saw a white flash
   * and a reload on the contact page: the mount-on-open kill in its purest
   * form. The page has its own sitekey and nobody to spare, so the challenge
   * must run — but on intent, and on a hard-loaded document. */
  const page = readFileSync(join(root, 'docs', 'contact.html'), 'utf8');
  assert.ok(!/challenges\.cloudflare\.com/.test(page),
    'contact.html must not carry Cloudflare\'s script: the implicit render mounts on arrival');
  assert.ok(!/class="cf-turnstile"/.test(page),
    'the slot must not be cf-turnstile — an implicit render would scan and mount it unasked');
  assert.ok(/class="contact-ts" data-sitekey=/.test(page), 'the explicit slot is gone');
  const js = readFileSync(join(root, 'docs', 'contact.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/render=explicit/.test(js), 'contact.js must load api.js with render=explicit');
  /* the mount is reachable only through want(): focus or the press */
  const mounts = [...js.matchAll(/\bmount\(\)/g)].length;
  assert.ok(mounts >= 2, 'mount() must be called from the onload and from want()');
  assert.ok(!/^\s*mount\(\);/m.test(js.slice(js.indexOf('function boot()'))),
    'boot() must not mount the widget — that is the mount-on-open the postmortem is about');
  assert.ok(/addEventListener\('focusin'/.test(js) && /want\(\)/.test(js.slice(js.indexOf("addEventListener('focusin'"))),
    'the first focus of a field is the intent that mounts it');
  assert.ok(/addEventListener\('submit'/.test(js), 'and the press covers a reader who never focused');
  assert.ok(/'refresh-expired': 'never'/.test(js) && /retry: 'never'/.test(js),
    'the contact widget follows the same clock rules as the other two');
  assert.ok(/turnstile\.reset\(widgetId\)/.test(js), 'a spent or aged token is replaced by reset() at the press');
});
