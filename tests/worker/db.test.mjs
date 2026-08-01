/* Repository layer (comments-worker/src/db.ts). Locks the bind-placeholder
 * helpers that replaced the hand-rolled `?N` loops — the whole point of the
 * extraction is that inList emits BYTE-IDENTICAL placeholder strings, so these
 * assertions derive their expected values from the exact expression the inline
 * code used. Also covers the Query builder's ?-renumbering and the mappers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inList, Query, rankFor, withNames } from '../../comments-worker/src/db.ts';

test('inList matches the hand-rolled placeholder loops exactly', () => {
  // the inline form was: chunk.map((_, j) => '?' + (j + 1)).join(',')
  const handRolled = (n, offset = 1) =>
    Array.from({ length: n }, (_, j) => '?' + (j + offset)).join(',');
  for (const n of [0, 1, 2, 3, 50]) {
    assert.equal(inList(n), handRolled(n), `inList(${n})`);
  }
  // the `+ 2` variant (postIds.map((_, i) => '?' + (i + 2))) at the reply site
  assert.equal(inList(3, 2), handRolled(3, 2));
  assert.equal(inList(3, 2), '?2,?3,?4');
});

test('inList edge cases', () => {
  assert.equal(inList(0), '');
  assert.equal(inList(1), '?1');
  assert.equal(inList(4), '?1,?2,?3,?4');
});

test('Query builder renumbers bare ? to sequential ?N and keeps bind order', () => {
  const { sql, binds } = new Query()
    .add('SELECT * FROM t WHERE a = ?', 5)
    .add('AND b IN (?, ?)', 1, 2)
    .add('ORDER BY id')
    .build();
  assert.equal(sql, 'SELECT * FROM t WHERE a = ?1 AND b IN (?2, ?3) ORDER BY id');
  assert.deepEqual(binds, [5, 1, 2]);
});

test('rankFor maps counts to the ladder labels (Domain.Rank)', () => {
  assert.equal(rankFor(0), 'Novice');
  assert.equal(rankFor(250), 'Scribe');
  assert.equal(rankFor(1000), 'Master Scribe');
  assert.equal(rankFor('nan'), 'Novice'); // coerces junk -> 0
});

test('withNames attaches assigned pseudonym + rank only when posts known', () => {
  const hash = 'a'.repeat(64);
  const named = withNames({ author_hash: hash, nick: 'x' }, 250);
  assert.equal(typeof named.assigned, 'string');
  assert.equal(named.nick, 'x');          // existing fields preserved
  assert.equal(named.posts, 250);
  assert.equal(named.rank, 'Scribe');
  // no posts arg -> no rank/posts written, assigned still set
  const bare = withNames({ author_hash: hash });
  assert.equal(typeof bare.assigned, 'string');
  assert.equal(bare.posts, undefined);
  assert.equal(bare.rank, undefined);
  // null author_hash -> assigned null
  assert.equal(withNames({ author_hash: null }).assigned, null);
});
