/* The Settings "Clear app cache" button.
 *
 * This is the one control in the app that deletes the reader's stored data, so
 * the only rule worth guarding is what it must NEVER delete. `mc-comment-key`
 * is the whole account and is unrecoverable — there is no reset-password road
 * back — and `mc-draft:*` is the reader's own unsent writing. A future edit that
 * swept either into the clearable set would destroy accounts silently, and the
 * person who wrote it would have no way of knowing.
 *
 * The design is fail-safe on purpose: an allowlist, so anything unlisted
 * survives. These tests hold that shape in place. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');

function clearBlock() {
  const i = src.indexOf('async clearCache()');
  assert.ok(i > 0, 'clearCache() not found — has the Settings control been renamed?');
  const j = src.indexOf('location.reload();', i);
  assert.ok(j > i, 'clearCache() no longer ends in a reload');
  return src.slice(i, j);
}

function listed(name) {
  const b = clearBlock();
  const m = new RegExp(`const ${name}(?:_PREFIX)? = \\[([^\\]]*)\\]`).exec(b)
    || new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(b);
  assert.ok(m, `${name} not found inside clearCache()`);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

test('the clearable set is an explicit allowlist, not a sweep', () => {
  const block = clearBlock();
  /* A `localStorage.clear()` — or a "remove everything starting mc-" — would
     take the key with it. The whole safety of this control is that it names
     what goes. */
  assert.ok(!/localStorage\.clear\(\)/.test(block),
    'clearCache must never call localStorage.clear(): that deletes the identity key');
  assert.ok(block.includes('CLEARABLE.indexOf(k) !== -1'),
    'membership must be tested against the explicit list');
});

test('the identity key and unsent drafts can never be cleared', () => {
  const all = listed('CLEARABLE').concat(listed('CLEARABLE_PREFIX'));
  assert.ok(!all.includes('mc-comment-key'),
    'mc-comment-key is the account and is UNRECOVERABLE — it must never be clearable');
  for (const entry of all) {
    assert.ok(!'mc-comment-key'.startsWith(entry),
      `${entry} would match the identity key by prefix`);
    assert.ok(!'mc-draft:something'.startsWith(entry),
      `${entry} would sweep the reader's unsent drafts`);
    /* Reading positions and preferences are the reader's too — not caches. */
    assert.ok(!'mc-readpos:/book.html'.startsWith(entry), `${entry} would sweep reading positions`);
    assert.ok(!'mc-agreed-at'.startsWith(entry), `${entry} would sweep the terms agreement`);
  }
});

test('every clearable entry really is derived data', () => {
  /* Each of these can be rebuilt from the server or is a one-shot scrap, so
     losing it costs a refetch and nothing else. Anything added here later
     should be able to pass the same sentence. */
  const DERIVED = new Set(['mc-dm-unread', 'mc-notif-unread', 'mc-admin', 'mc-social',
    'mc-presence', 'mc-flash', 'mc-posted-at', 'mc-merecat-prefill', 'mc-altip-fail:']);
  for (const entry of listed('CLEARABLE').concat(listed('CLEARABLE_PREFIX'))) {
    assert.ok(DERIVED.has(entry),
      `${entry} was added to the clearable set — confirm it is derived data that the ` +
      'app can rebuild, then add it here with that reasoning');
  }
});

test('it clears the service worker caches, which is the actual fix', () => {
  const block = clearBlock();
  assert.ok(/caches\.keys\(\)/.test(block) && /caches\.delete/.test(block),
    'stale SW caches are what "the app looks out of date" usually means');
  /* Unregistering would cost the reader their offline shell for no extra fix:
     nav.js re-registers on the next load and re-primes the caches anyway. */
  assert.ok(!/unregister\(/.test(block),
    'the service worker should not be unregistered — emptying its caches is the fix');
});

test('the control is offered to everyone, not gated behind admin', () => {
  /* The ROW markup, not the phrase — clearCache()'s own comment names it too. */
  const i = src.indexOf('<span>Clear app cache<small>');
  assert.ok(i > 0, 'the Settings row is gone');
  /* The admin block closes before it; the row must not sit inside that ternary. */
  const adminAt = src.indexOf("${isAdmin() ? html`<h3 class=\"mc-set-sec\">Administration</h3>");
  const adminEnds = src.indexOf("` : ''}", adminAt);
  assert.ok(i > adminEnds, 'the clear-cache row must sit outside the isAdmin() block');
});
