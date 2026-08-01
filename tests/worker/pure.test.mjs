/* comments-worker/src/pure.js — the pure worker helpers extracted for testing.
   Two security-critical jobs live here, and this file guards both:

   1. IP/ban-key normalization. A ban must not be evadable by an IPv6 client whose
      interface id rotates daily, so ipKey folds every v6 address to its stable
      /64. The load-bearing assertion is that two different addresses in the same
      /64 produce the SAME key.
   2. boardEventPublic — the ONE predicate that keeps the admins-only "back room"
      off the anonymous live socket. If this ever returned true for a back-room
      event, the room would leak. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ipFamily, ipv6Groups, ipv6Prefix64, ipv6Full, ipKey, toBanKey,
  isSharedV4, reverseDnsName, looksLikeIp, boardEventPublic, sanitizeScopes,
} from '../../comments-worker/src/pure.js';

test('ipFamily distinguishes v4 / v6 / neither', () => {
  assert.equal(ipFamily('203.0.113.7'), 4);
  assert.equal(ipFamily('2605:59ca:39db:4308::1'), 6);
  assert.equal(ipFamily('not-an-ip'), 0);
  assert.equal(ipFamily(''), 0);
});

test('ipv6Groups expands :: and rejects malformed addresses', () => {
  assert.deepEqual(ipv6Groups('::1'),
    ['0000', '0000', '0000', '0000', '0000', '0000', '0000', '0001']);
  assert.equal(ipv6Groups('1:2:3:4:5:6:7:8:9'), null, 'too many hextets -> null');
  assert.equal(ipv6Groups('zzzz::1'), null, 'non-hex -> null');
  assert.equal(ipv6Groups('203.0.113.7'), null, 'a v4 address is not a v6 group set');
  // ipv6Full is all 32 nibbles, no separators (for the .ip6.arpa name)
  assert.equal(ipv6Full('2605:59ca:39db:4308::1'), '260559ca39db43080000000000000001');
  // a zone id (%eth0) on a bare address is stripped
  assert.equal(ipv6Prefix64('2605:59ca:39db:4308::1%eth0'), '2605:59ca:39db:4308::/64');
});

test('ipv6Prefix64 is the canonical /64 with leading zeros trimmed', () => {
  assert.equal(ipv6Prefix64('2605:59ca:39db:4308:aaaa:bbbb:cccc:dddd'), '2605:59ca:39db:4308::/64');
  assert.equal(ipv6Prefix64('2001:0db8:0000:0042:0000:0000:0000:0001'), '2001:db8:0:42::/64');
  assert.equal(ipv6Prefix64('nope'), null);
});

test('ipKey: v4 verbatim (trimmed), v6 folded to /64', () => {
  assert.equal(ipKey('  203.0.113.7 '), '203.0.113.7', 'v4 verbatim, trimmed');
  assert.equal(ipKey('2605:59ca:39db:4308:1111:2222:3333:4444'), '2605:59ca:39db:4308::/64');
});

test('ban-evasion guard: a rotating v6 interface id maps to ONE key', () => {
  // Same /64, different (rotated) interface identifiers -> same ban key.
  const a = ipKey('2605:59ca:39db:4308:1111:2222:3333:4444');
  const b = ipKey('2605:59ca:39db:4308:9999:8888:7777:6666');
  assert.equal(a, b, 'both addresses in the /64 share a ban key');
  // A different /64 must NOT collide.
  assert.notEqual(a, ipKey('2605:59ca:39db:4309:1111:2222:3333:4444'));
});

test('toBanKey: raw address normalizes; a stored /64 passes through; junk is null', () => {
  assert.equal(toBanKey('203.0.113.7'), '203.0.113.7');
  assert.equal(toBanKey('2605:59ca:39db:4308:1:2:3:4'), '2605:59ca:39db:4308::/64');
  assert.equal(toBanKey('2605:59CA:39DB:4308::/64'), '2605:59ca:39db:4308::/64', 'stored key round-trips (lowercased)');
  assert.equal(toBanKey('drop table'), null);
  assert.equal(toBanKey(''), null);
});

test('isSharedV4 flags CGNAT 100.64.0.0/10 only', () => {
  assert.equal(isSharedV4('100.64.0.1'), true);
  assert.equal(isSharedV4('100.127.255.255'), true);
  assert.equal(isSharedV4('100.63.255.255'), false, 'just below the range');
  assert.equal(isSharedV4('100.128.0.1'), false, 'just above the range');
  assert.equal(isSharedV4('10.0.0.1'), false);
});

test('looksLikeIp is a loose gate: must have a dot or colon and only IP characters', () => {
  assert.equal(looksLikeIp('203.0.113.7'), true);
  assert.equal(looksLikeIp('2605:59ca:39db:4308::1'), true);
  assert.equal(looksLikeIp('hello'), false, 'no dot or colon');
  assert.equal(looksLikeIp(''), false);
  assert.equal(looksLikeIp('drop; table'), false, 'space/semicolon are not IP chars');
});

test('reverseDnsName builds the PTR query name for v4 and v6', () => {
  assert.equal(reverseDnsName('203.0.113.7'), '7.113.0.203.in-addr.arpa');
  assert.equal(reverseDnsName('2605:59ca:39db:4308::1').endsWith('.ip6.arpa'), true);
  assert.equal(reverseDnsName('nope'), null);
});

test('boardEventPublic: the back-room privacy gate (never leaks adminsonly)', () => {
  assert.equal(boardEventPublic({ cat: 'pub' }), true);
  assert.equal(boardEventPublic({ cat: 'rc', scopes: ['cat:rc'] }), true);
  assert.equal(boardEventPublic({ cat: 'adminsonly' }), false, 'back-room cat never crosses');
  assert.equal(boardEventPublic({ cat: 'pub', scopes: ['cat:adminsonly'] }), false, 'a back-room scope never crosses');
  assert.equal(boardEventPublic(null), false);
  assert.equal(boardEventPublic(undefined), false);
});

test('sanitizeScopes: the WebSocket allowlist — the private-scope guard holds', () => {
  const CATS = ['pub', 'rc', 'adminsonly'];
  const ME = 'a'.repeat(64);
  const OTHER = 'b'.repeat(64);
  const san = (raw, me) => sanitizeScopes(raw, me, CATS);
  // public scopes anyone may hold
  assert.deepEqual(san(['board:index'], ME), ['board:index']);
  assert.deepEqual(san(['cat:pub'], ME), ['cat:pub']);
  assert.deepEqual(san(['topic:42'], ME), ['topic:42']);
  assert.deepEqual(san(['feed:global'], ''), ['feed:global']);
  assert.deepEqual(san(['presence:' + OTHER], ME), ['presence:' + OTHER], 'anyone may watch anyone online');
  // the back room can never be subscribed
  assert.deepEqual(san(['cat:adminsonly'], ME), [], 'admins-only room is never a live scope');
  assert.deepEqual(san(['cat:nope'], ME), [], 'an unknown cat is dropped');
  assert.deepEqual(san(['topic:0'], ME), [], 'non-positive topic dropped');
  // THE load-bearing security rule: a private user:<hash> is kept ONLY for its own hash
  assert.deepEqual(san(['user:' + ME], ME), ['user:' + ME], 'my own private scope is allowed');
  assert.deepEqual(san(['user:' + OTHER], ME), [], "another member's private scope is REFUSED");
  assert.deepEqual(san(['user:' + ME], ''), [], 'an unauthenticated socket gets no private scope');
  assert.deepEqual(san(['presence:xyz'], ME), [], 'a malformed presence hash is dropped');
  // capped at 5, junk ignored
  assert.equal(san(['board:index', 'cat:pub', 'cat:rc', 'topic:1', 'topic:2', 'topic:3'], ME).length, 5, 'at most 5 scopes');
  assert.deepEqual(san('not-an-array', ME), []);
  assert.deepEqual(san([42, {}, null, 'board:index'], ME), ['board:index'], 'non-string entries ignored');
});
