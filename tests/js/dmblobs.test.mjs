/* Decrypted DM attachments are the heaviest thing this app holds, and a blob
 * URL keeps its bytes alive until something revokes it.
 *
 * The defect (found 2026-09-08 from an installed-app crumb ring showing a load
 * with no pagehide, no beforeunload and no error — a killed web view, not a
 * navigation): the cache lived INSIDE mcBoot(), which is the whole client and
 * re-runs on every soft navigation. Each hop replaced it with a fresh {} and
 * orphaned every URL it held without revoking one, so the decrypted bytes
 * stayed resident for the life of the document and a reader moving between
 * conversations climbed until iOS killed the app.
 *
 * These hold the three properties that fix has to keep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
import { clientRoot, clientModule, CLIENT_MODULES } from '../_support/client.mjs';
const src = clientRoot();
const dmSrc = clientModule('dm');
const bootAt = src.indexOf('function mcBoot()');

test('the blob store outlives the boot that fills it', () => {
  const at = src.indexOf('var mcDmBlobs');
  assert.ok(at > 0, 'the DM blob store is gone');
  assert.ok(at < bootAt,
    'mcDmBlobs is declared inside mcBoot — which re-runs on every soft navigation, ' +
    'so each hop would orphan every blob URL it holds without revoking one.');
  for (const name of ['function mcDmBlobGet', 'function mcDmBlobPut']) {
    assert.ok(src.indexOf(name) < bootAt, `${name} must live above mcBoot with the store`);
  }
});

test('every blob the store drops is revoked', () => {
  const put = src.slice(src.indexOf('function mcDmBlobPut'), src.indexOf('function mcBoot()'));
  assert.ok(/mcDmBlobs\.shift\(\)/.test(put), 'eviction must actually remove the oldest entry');
  assert.ok(/URL\.revokeObjectURL\(out\.url\)/.test(put),
    'an evicted entry must be revoked — dropping the reference alone frees nothing');
  assert.ok(/MC_DM_BLOB_MAX/.test(put) && /MC_DM_BLOB_BYTES/.test(put),
    'the store needs both a count and a byte budget: sixteen photos and one video are ' +
    'very different amounts of memory');
  assert.ok(/mcDmBlobs\.length > 1 &&/.test(put),
    'a single attachment larger than the whole budget must still be viewable');
});

test('nothing creates a DM blob outside the store', () => {
  /* A createObjectURL that bypasses mcDmBlobPut is a leak by construction:
     nothing is tracking it, so nothing will ever revoke it. */
  const dm = dmSrc.slice(dmSrc.indexOf('function dmMediaDecrypt'), dmSrc.indexOf('function dmRenderMsg'));
  for (const m of dm.matchAll(/URL\.createObjectURL\(/g)) {
    const after = dm.slice(m.index, m.index + 400);
    assert.ok(/mcDmBlobPut\(/.test(after),
      'a decrypted DM attachment became a blob URL that the store never learned about, ' +
      'so nothing can ever revoke it.');
  }
});

test('attachments decrypt on approach, and hand iOS no decoder until asked', () => {
  const node = dmSrc.slice(dmSrc.indexOf('function dmMediaNode'), dmSrc.indexOf('function dmMediaExpiredNode'));
  assert.ok(/whenNear\(node, paint\)/.test(node),
    'every attachment on the page used to fetch and AES-decrypt the moment the thread drew');
  assert.ok((node.match(/preload = 'none'/g) || []).length === 2,
    "both <video> and <audio> must set preload='none' — iOS allocates a media decoder " +
    'per element, and a thread of voice notes is a thread of decoders');
  assert.ok(/if \(tries\+\+\) return;/.test(node),
    'an evicted blob must re-request once, not leave a broken bubble and not loop');
});

/* The same class, one level up: mcBoot() IS the client and re-runs on every
 * soft navigation, so a listener bound to `document` or `window` inside it
 * must carry the boot's AbortSignal. Without it each hop leaves another live
 * listener holding its own closure — the leak that hid behind full page loads
 * until navigation became soft.
 */
test('every document/window listener the boot installs dies with the boot', () => {
  /* The boot's own body, and every feature module's run() — the module's
     share of what was the boot's top level, installed per boot (Wave F,
     2026-09-11). A run() body sits one indent deeper; it is de-indented so the
     boot-level shape below reads it exactly as it read the old file, and never
     sweeps a listener nested inside a function. */
  const runBody = (text) => {
    const i = text.indexOf('\n  function run() {');
    const j = text.indexOf('\n  }\n  return { bind, run', i);
    return i < 0 || j < 0 ? '' : text.slice(i, j).split('\n').map((l) => l.replace(/^  /, '')).join('\n');
  };
  const boot = src.slice(bootAt) + '\n' + CLIENT_MODULES.map((m) => runBody(clientModule(m))).join('\n');
  const re = /(document|window)\.addEventListener\(([\s\S]{0,4000}?)\n  \}, ([^\n]*)\);/g;
  const escapes = [];
  let seen = 0;
  let m;
  while ((m = re.exec(boot))) {
    const opts = m[3];
    seen += 1;
    if (/bootSig/.test(opts)) continue;
    escapes.push(`${m[1]}.addEventListener(... , ${opts})`);
  }
  assert.deepEqual(escapes, [],
    'a boot-scoped global listener with no { signal: bootSig }: mcBoot re-runs on ' +
    'every soft navigation, so this one accumulates for the life of the document.');
  /* The anti-vacuum guard. This shape only sees multi-line listeners closing
     at the boot's own indent — the ones that live for a view rather than a
     moment, which is the whole risk. If a refactor stops it matching anything
     it has quietly stopped testing anything, and should say so. */
  assert.ok(seen >= 3, `the listener scan matched ${seen} listeners — it has lost its grip on the file`);
});
