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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'client', 'comments.ts'), 'utf8');

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
  assert.ok(src.includes('warmTok = null;                 // single-use: spend it and warm another'),
    'taking the warm token must clear it');
  assert.ok(/TOKEN_FRESH_MS = \d+/.test(src), 'a stale token must be discarded, not spent');
});

test('the warm never fires for a reader with no identity', () => {
  /* Warming is only meaningful for someone who can actually post, and running
     challenges for every passing reader would be both wasteful and rude. */
  const i = src.indexOf('function warmToken()');
  const body = src.slice(i, src.indexOf('}', src.indexOf('trace(\'turnstile: warming\')', i)));
  assert.ok(body.includes('!state.key'), 'warmToken must bail without an identity');
});
