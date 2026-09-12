/* DMs are never AI-screened (the owner's standing rule, locked 2026-09-12):
 * a direct message is end-to-end encrypted — the server holds only
 * ciphertext, so no screen COULD read it — and privacy is the point. Turnstile
 * on the send is fine (a bot gate, not a reader). Every DM handler must stay
 * free of the AI screen, and every screen call in the worker must sit in a
 * handler that is not a DM's.
 *
 * What would break silently: a `screen(` or `screenImage(` slipping into a DM
 * handler by copy-paste from the wall's (the calls are one line and look
 * routine), or the media upload's per-section scan growing a 'dm' context. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');

/* every top-level `async function NAME(` … up to the next one, by name */
function bodies(src) {
  const out = {};
  const re = /\n(?:export )?async function ([A-Za-z0-9_]+)\(/g;   // lib.ts exports its handlers
  let m, prev = null;
  while ((m = re.exec(src))) {
    if (prev) out[prev.name] = src.slice(prev.at, m.index);
    prev = { name: m[1], at: m.index };
  }
  if (prev) out[prev.name] = src.slice(prev.at);
  return out;
}
const SCREEN = /\bscreen\(|\bscreenImage\(|\bscreenMedia\(/;
const DM = (name) => /Dm|SystemDm/.test(name);

test('no DM handler in the worker calls the AI screen; the send is Turnstile-gated', () => {
  for (const [src, atLeast] of [[idxSrc, 8], [libSrc, 1]]) {
    const all = bodies(src);
    const dm = Object.keys(all).filter(DM);
    assert.ok(dm.length >= atLeast, 'the DM handlers are found by name (' + dm.length + ')');
    for (const name of dm) assert.ok(!SCREEN.test(all[name]), `${name} must never screen — the words are ciphertext and the rule is privacy`);
  }
  const send = bodies(idxSrc).handleDmSend;
  assert.ok(/verifyTurnstile\(env, String\(data\.token \|\| ''\), ip, String\(data\.key \|\| ''\)\)/.test(send), 'Turnstile stays on the send (a bot gate, not a reader)');
});

test('every screen call in the worker sits in a non-DM handler, and the media scan knows no dm context', () => {
  const all = bodies(idxSrc);
  const callers = Object.keys(all).filter((n) => SCREEN.test(all[n]));
  assert.ok(callers.length >= 6, 'the screen has callers (' + callers.length + ')');
  assert.deepEqual(callers.filter(DM), [], 'none of them is a DM handler');
  const upload = all.mediaUpload;
  assert.ok(upload && /mediaScanEnabled\(settings, ctxKind\)/.test(upload), 'the image scan is the wall/board upload\'s');
  assert.ok(!/ctxKind === 'dm'|'dm'\)/.test(upload), 'and it knows no dm context');
  const dmMedia = all.handleDmMediaUpload;
  assert.ok(dmMedia && /ciphertext/.test(dmMedia) && !SCREEN.test(dmMedia), 'the DM upload stores opaque ciphertext, unscreened');
});
