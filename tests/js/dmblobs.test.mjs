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
const src = readFileSync(join(root, 'client', 'comments.ts'), 'utf8');
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
  const dm = src.slice(src.indexOf('function dmMediaDecrypt'), src.indexOf('function dmRenderMsg'));
  for (const m of dm.matchAll(/URL\.createObjectURL\(/g)) {
    const after = dm.slice(m.index, m.index + 400);
    assert.ok(/mcDmBlobPut\(/.test(after),
      'a decrypted DM attachment became a blob URL that the store never learned about, ' +
      'so nothing can ever revoke it.');
  }
});

test('attachments decrypt on approach, and hand iOS no decoder until asked', () => {
  const node = src.slice(src.indexOf('function dmMediaNode'), src.indexOf('function dmMediaExpiredNode'));
  assert.ok(/whenNear\(node, paint\)/.test(node),
    'every attachment on the page used to fetch and AES-decrypt the moment the thread drew');
  assert.ok((node.match(/preload = 'none'/g) || []).length === 2,
    "both <video> and <audio> must set preload='none' — iOS allocates a media decoder " +
    'per element, and a thread of voice notes is a thread of decoders');
  assert.ok(/if \(tries\+\+\) return;/.test(node),
    'an evicted blob must re-request once, not leave a broken bubble and not loop');
});
