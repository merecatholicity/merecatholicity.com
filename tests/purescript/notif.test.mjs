/* Domain.Notif — the notification list's words and doors (2026-09-12): the
   kinds the ledger admits, the sentence a row reads, the page a tap opens,
   and whether an excerpt may stand under it. Three renderers carried this map
   inline and had drifted once already; now each asks the kernel.

   What would break silently: a kind added to the CHECK without a sentence
   (the row would read as a reply); a reaction's door landing on the wrong
   post because topic_id/comment_id mean different things per kind; a DM row
   showing an excerpt the server cannot have. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Notif from '../../purescript/output/Domain.Notif/index.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const row = (o) => Object.assign({ kind: 'reply', who: 'Ann', topicTitle: '', topicId: 0, commentId: 0, actor: 'a'.repeat(64) }, o);

test('the kind list is the ledger\'s CHECK, in the latest migration that swapped the table', () => {
  const dir = join(root, 'comments-worker', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const withCheck = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes('CHECK (kind IN ('));
  const latest = readFileSync(join(dir, withCheck[withCheck.length - 1]), 'utf8');
  assert.ok(latest.includes("CHECK (kind IN ('" + Notif.kinds.join("','") + "'))"),
    `the newest kind CHECK (${withCheck[withCheck.length - 1]}) must spell Domain.Notif.kinds exactly`);
});

test('every kind has a sentence of its own — none falls through to "replied in"', () => {
  for (const kind of Notif.kinds) {
    const s = Notif.label(row({ kind, topicTitle: 'T' }));
    if (kind !== 'reply') assert.ok(!/replied in/.test(s), `${kind} reads "${s}"`);
  }
});

test('the reaction kinds say "reacted" — never the emoji, never "liked" — and name what was reacted to', () => {
  assert.equal(Notif.label(row({ kind: 'react', topicId: 5, commentId: 9 })), 'Ann reacted to your post');
  assert.equal(Notif.label(row({ kind: 'wall-react', topicId: 0, commentId: 3 })), 'Ann reacted to your post');
  assert.equal(Notif.label(row({ kind: 'wall-react', topicId: 7, commentId: 3 })), 'Ann reacted to your comment', 'topic_id > 0 is the feed comment');
  assert.equal(Notif.label(row({ kind: 'dm-react', commentId: 44 })), 'Ann reacted to your message');
  assert.equal(Notif.label(row({ kind: 'wall-like', commentId: 3 })), 'Ann liked your post', 'the rows from before the picker keep their word');
});

test('the older kinds read as they always did', () => {
  assert.equal(Notif.label(row({ kind: 'dm' })), 'Ann sent you a message');
  assert.equal(Notif.label(row({ kind: 'call' })), '📞 Ann called you');
  assert.equal(Notif.label(row({ kind: 'merecat' })), 'merecat finished answering your question');
  assert.equal(Notif.label(row({ kind: 'wall', topicId: 1 })), 'Ann commented on your post');
  assert.equal(Notif.label(row({ kind: 'wall', topicId: 0 })), 'Ann mentioned you in a post');
  assert.equal(Notif.label(row({ kind: 'mention', topicTitle: 'On grace' })), 'Ann mentioned you in On grace');
  assert.equal(Notif.label(row({ kind: 'reply', topicTitle: '' })), 'Ann replied in a thread', 'no title: "a thread"');
});

test('the door: the exact post, the feed post (and its comment\'s anchor), the conversation landing on the message', () => {
  const a = 'a'.repeat(64);
  assert.equal(Notif.href(row({ kind: 'react', topicId: 5, commentId: 9 })), 'community.html?topic=5#comment-9');
  assert.equal(Notif.href(row({ kind: 'reply', topicId: 5, commentId: 9 })), 'community.html?topic=5#comment-9');
  assert.equal(Notif.href(row({ kind: 'wall-react', topicId: 0, commentId: 3 })), 'feed.html?post=3');
  assert.equal(Notif.href(row({ kind: 'wall-react', topicId: 7, commentId: 3 })), 'feed.html?post=3#wc-7');
  assert.equal(Notif.href(row({ kind: 'wall', topicId: 1, commentId: 3 })), 'feed.html?post=3');
  assert.equal(Notif.href(row({ kind: 'wall-like', commentId: 3 })), 'feed.html?post=3');
  assert.equal(Notif.href(row({ kind: 'dm-react', commentId: 44 })), 'messages.html?dm=' + a + '&m=44');
  assert.equal(Notif.href(row({ kind: 'dm' })), 'messages.html?dm=' + a);
  assert.equal(Notif.href(row({ kind: 'call' })), 'messages.html?dm=' + a);
  assert.equal(Notif.href(row({ kind: 'merecat', topicId: 12 })), 'merecat-ai.html?chat=12');
});

test('who: the nick, else the pseudonym every hash carries, else Someone', () => {
  assert.equal(Notif.who('Ann')('b'.repeat(64)), 'Ann');
  assert.match(Notif.who('')('b'.repeat(64)), /^[A-Z][a-z]+-[A-Z][a-z]+ [0-9a-f]{4}$/, 'the assigned pseudonym');
  assert.equal(Notif.who('')(''), 'Someone');
});

test('an excerpt never stands under an E2E kind or a call', () => {
  for (const k of ['dm', 'call', 'dm-react']) assert.equal(Notif.hasSnippet(k), false, k);
  for (const k of ['reply', 'mention', 'react', 'wall', 'wall-like', 'wall-react']) assert.equal(Notif.hasSnippet(k), true, k);
});
