/* Domain.Board — the forum category table, the single source for the worker's
   CAT_META/BOARD_CATS and the client's CATS. The row order is the display order,
   the last row is the admins-only back room, and adminCat is its board key.
   These pin the shape so a category can't silently drift between the two sides. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Board from '../../purescript/output/Domain.Board/index.js';

test('the category table has 14 rows and catKeys matches the row keys', () => {
  assert.equal(Board.catRows.length, 14, '14 categories');
  assert.equal(Board.catKeys.length, 14);
  assert.deepEqual(Board.catKeys, Board.catRows.map((r) => r[0]), 'catKeys === row keys');
});

test('the first and last rows are stable (pub … adminsonly)', () => {
  assert.deepEqual(Board.catRows[0], ['pub', 'Pub',
    'General discussion, for whatever fits nowhere more specific. New here? ',
    'Introduce yourself and say hello', 'community.html?topic=37']);
  assert.deepEqual(Board.catRows[13], ['adminsonly', 'Admins only', 'The back room.']);
});

test('adminCat is the back room board key', () => {
  assert.equal(Board.adminCat, 'board:adminsonly');
});
