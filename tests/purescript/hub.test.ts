/* Domain.Hub — the live hub's sharding law (2026-09-17).
 *
 * What would break silently: a member's sockets split across shards (their
 * "last socket closed" fires while a tab still lives, a DM routed to a shard
 * that does not hold them); shard 0 losing the historic name "board" (the
 * first sharded deploy would strand every socket on an instance nothing fans
 * to); a public scope judged private (a board event reaching one shard of
 * N); the var read as zero (a modulo by zero in the upgrade path). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Hub from '../../purescript/output/Domain.Hub/index.js';

const H = (c) => c.repeat(64);

test('normalizeShards: a whole number clamped to 1..maxShards; blank or junk is 1', () => {
  assert.equal(Hub.maxShards, 64);
  assert.equal(Hub.normalizeShards(''), 1);
  assert.equal(Hub.normalizeShards('junk'), 1);
  assert.equal(Hub.normalizeShards('0'), 1);
  assert.equal(Hub.normalizeShards('-3'), 1);
  assert.equal(Hub.normalizeShards('1'), 1);
  assert.equal(Hub.normalizeShards('8'), 8);
  assert.equal(Hub.normalizeShards('999'), 64, 'clamped to the ceiling');
});

test('shardOf: stable, in range, spread, and 0 for a non-hex key or n = 1', () => {
  const hashes = ['0123456789abcdef', 'ffffffff' + '0'.repeat(56), H('a'), H('7'), 'deadbeefcafe' + '0'.repeat(52)];
  for (const h of hashes) {
    assert.equal(Hub.shardOf(1)(h), 0, 'one shard: everything is shard 0');
    for (const n of [2, 3, 8, 64]) {
      const i = Hub.shardOf(n)(h);
      assert.ok(i >= 0 && i < n, `${h.slice(0, 8)} mod ${n} in range`);
      assert.equal(Hub.shardOf(n)(h), i, 'stable');
    }
  }
  assert.equal(Hub.shardOf(8)('ffffffff' + '0'.repeat(56)), 0xfffffff % 8, 'the first SEVEN digits (28 bits, inside Int)');
  assert.equal(Hub.shardOf(8)('0000001' + '0'.repeat(57)), 1);
  assert.equal(Hub.shardOf(8)(''), 0, 'no key: shard 0');
  assert.equal(Hub.shardOf(8)('not-hex-at-all'), 0);
  assert.equal(Hub.shardOf(8)('ABCDEF0' + '0'.repeat(57)), 0, 'uppercase is not a digest here');
  assert.equal(Hub.shardOf(0)(H('a')), 0, 'n below 1 is treated as 1, never a modulo by zero');
  const spread = new Set();
  for (let k = 0; k < 64; k++) spread.add(Hub.shardOf(8)(k.toString(16).padStart(7, '0') + '0'.repeat(57)));
  assert.equal(spread.size, 8, 'every shard is reachable');
});

test('shardName / shardIndex: shard 0 is the historic "board"; the two are inverses', () => {
  assert.equal(Hub.shardName(0), 'board');
  assert.equal(Hub.shardName(-1), 'board');
  assert.equal(Hub.shardName(1), 'board:1');
  assert.equal(Hub.shardName(17), 'board:17');
  for (let i = 0; i < 64; i++) assert.equal(Hub.shardIndex(Hub.shardName(i)), i);
  assert.equal(Hub.shardIndex('board'), 0);
  assert.equal(Hub.shardIndex('board:0'), 0);
  assert.equal(Hub.shardIndex('board:x'), 0);
  assert.equal(Hub.shardIndex('chat:3'), 0, 'anything unrecognised is 0');
  assert.deepEqual(Hub.shardNames(1), ['board']);
  assert.deepEqual(Hub.shardNames(3), ['board', 'board:1', 'board:2']);
  assert.deepEqual(Hub.shardNames(0), ['board'], 'never an empty fan');
});

test('scopeHome: only user:<hash> is private', () => {
  assert.equal(Hub.scopeHome('user:' + H('a')).value0, H('a'));
  for (const s of ['board:index', 'cat:pub', 'topic:12', 'feed:global', 'presence:' + H('a'), 'dmview:t4', ''])
    assert.equal(Hub.scopeHome(s).value0, undefined, s + ' is public');
});

test('routeScopes: private-only events go to their home shards, deduplicated; any public scope means every shard', () => {
  const a = 'user:' + H('a'), b = 'user:' + H('b');
  const homes = (n, scopes) => { const r = Hub.routeScopes(n)(scopes); return r.value0 === undefined ? null : r.value0; };
  assert.deepEqual(homes(1, [a, b]), [0], 'one shard: one call');
  const n = 8;
  const ia = Hub.shardOf(n)(H('a')), ib = Hub.shardOf(n)(H('b'));
  assert.deepEqual(homes(n, [a]), [ia]);
  assert.deepEqual(homes(n, [a, a]), [ia], 'deduplicated');
  assert.deepEqual(homes(n, [a, b]).slice().sort(), [ia, ib].filter((x, i, arr) => arr.indexOf(x) === i).sort());
  assert.equal(homes(n, [a, 'topic:3']), null, 'a public scope beside a private one: fan to all');
  assert.equal(homes(n, ['board:index']), null);
  assert.equal(homes(n, ['presence:' + H('a')]), null, 'a presence watch may sit on any shard');
  assert.deepEqual(homes(n, []), [], 'no scopes: nowhere');
});
