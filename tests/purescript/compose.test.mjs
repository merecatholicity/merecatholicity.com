/* Domain.Compose — send-time @mention resolution. When a reply is posted, only
   the picked members whose token still literally stands in the body are sent as
   mentions (edit one out and it drops), deduped by hash, kept in order. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Compose from '../../purescript/output/Domain.Compose/index.js';

const mentionsIn = (text, picks) => Compose.mentionsIn(text)(picks);

test('mentionsIn: keeps picks whose token survives in the body, in order', () => {
  assert.deepEqual(
    mentionsIn('hi @alice and @bob', [{ token: '@alice', hash: 'h1' }, { token: '@bob', hash: 'h2' }]),
    ['h1', 'h2']);
});

test('mentionsIn: a token edited out of the body is dropped', () => {
  assert.deepEqual(
    mentionsIn('only @alice', [{ token: '@alice', hash: 'h1' }, { token: '@bob', hash: 'h2' }]),
    ['h1']);
});

test('mentionsIn: dedups by hash, and returns [] when no token remains', () => {
  assert.deepEqual(mentionsIn('@a @a', [{ token: '@a', hash: 'h1' }, { token: '@a', hash: 'h1' }]), ['h1']);
  assert.deepEqual(mentionsIn('none', [{ token: '@x', hash: 'h9' }]), []);
});
