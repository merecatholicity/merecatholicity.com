/* Admins edit any post (2026-09-12): the board's /edit and the feed's
 * /wall/edit admit the row's author OR an admin, and log an admin's edit.
 *
 * What would break silently: a handler quietly back to `WHERE author_hash =
 * me` (the client would offer edit to an admin and the server would answer
 * "Not yours"); an admin edit that leaves no trace in the tail. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
const body = (name) => {
  const i = idxSrc.indexOf(`async function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = idxSrc.indexOf('\nasync function ', i + 10);
  return idxSrc.slice(i, j > i ? j : i + 6000);
};

test('the board edit: the row by id, the author or an admin, the same refusal for everyone else, the admin logged', () => {
  const h = body('handleEdit');
  assert.ok(/FROM comments WHERE id = \?1 AND status != 'deleted'"\s*\)\.bind\(id\)\.first\(\);/.test(h), 'selected by id alone');
  assert.ok(/const asAdmin = !!row && row\.author_hash !== authorHash;/.test(h));
  assert.ok(/if \(!row \|\| \(asAdmin && !\(await isAdminHash\(env, authorHash\)\)\)\) return json\(\{ ok: false, error: 'Not yours, or already gone\.' \}, 403\);/.test(h));
  assert.ok(/event: 'admin_post_edit'/.test(h), 'an admin edit leaves a trace in the tail');
});

test('the feed edit: the same door, for a post and a comment alike', () => {
  const h = body('handleWallEdit');
  assert.ok(/'SELECT id, author_hash FROM ' \+ table \+ " WHERE id = \?1 AND status != 'deleted'"\s*\)\.bind\(id\)\.first\(\);/.test(h));
  assert.ok(/const asAdmin = !!row && row\.author_hash !== me;/.test(h));
  assert.ok(/if \(!row \|\| \(asAdmin && !\(await isAdminHash\(env, me\)\)\)\) return json\(\{ ok: false, error: 'Not yours, or already gone\.' \}, 403\);/.test(h));
  assert.ok(/event: 'admin_post_edit'/.test(h));
});
