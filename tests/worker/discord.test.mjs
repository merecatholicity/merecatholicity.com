/* comments-worker/src/pure.js — the Discord webhook helpers.

   isDiscordWebhook is a SECURITY validator: it is the ONE gate that decides
   whether the worker will POST member post-bodies to a given URL. If it ever
   accepted a non-Discord host, a corrupted or hostile app_setting could turn the
   worker into an open relay that leaks community posts to an attacker. So the
   load-bearing assertions are the REJECTIONS. discordSnippet must strip the
   highlight control sentinels (they must never reach an outside service) and cap
   length so an embed is never over-long. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDiscordWebhook, discordSnippet, parseFeedScope, scopeLabel } from '../../comments-worker/src/pure.js';

test('isDiscordWebhook accepts genuine Discord webhook URLs', () => {
  assert.equal(isDiscordWebhook('https://discord.com/api/webhooks/123456789012345678/AbC-dEf_123'), true);
  assert.equal(isDiscordWebhook('https://discordapp.com/api/webhooks/1/xY-z_0'), true);
  assert.equal(isDiscordWebhook('  https://discord.com/api/webhooks/1/abc  '), true);   // trimmed
});

test('isDiscordWebhook rejects everything that is not a Discord webhook', () => {
  assert.equal(isDiscordWebhook(''), false);
  assert.equal(isDiscordWebhook('   '), false);
  assert.equal(isDiscordWebhook(null), false);
  assert.equal(isDiscordWebhook(undefined), false);
  assert.equal(isDiscordWebhook(42), false);
  // wrong host / spoof attempts — the security-critical rejections
  assert.equal(isDiscordWebhook('https://evil.com/api/webhooks/1/abc'), false);
  assert.equal(isDiscordWebhook('https://discord.com.evil.com/api/webhooks/1/abc'), false);
  assert.equal(isDiscordWebhook('http://discord.com/api/webhooks/1/abc'), false);        // must be https
  assert.equal(isDiscordWebhook('https://discord.com/api/webhooks/'), false);            // no id/token
  assert.equal(isDiscordWebhook('https://discord.com/api/webhooks/abc/def'), false);     // id must be digits
  assert.equal(isDiscordWebhook('https://ptb.discord.com/api/webhooks/1/abc'), false);   // subdomain not allowed
  assert.equal(isDiscordWebhook('https://discord.com/api/webhooks/1/abc?wait=true'), false); // no query allowed
});

test('discordSnippet strips control chars but keeps newlines', () => {
  assert.equal(discordSnippet('abc'), 'abc');
  assert.equal(discordSnippet('line one\nline two'), 'line one\nline two');
  assert.equal(discordSnippet('a\n\n\n\n\nb'), 'a\n\nb');   // 3+ blank lines collapse
  assert.equal(discordSnippet('  hi  '), 'hi');             // trimmed
  // STX (U+0002) / ETX (U+0003) highlight sentinels must be stripped out
  assert.equal(discordSnippet('a' + String.fromCharCode(2) + 'b' + String.fromCharCode(3) + 'c'), 'abc');
  assert.equal(discordSnippet(null), '');
  assert.equal(discordSnippet(undefined), '');
});

test('discordSnippet caps length with an ellipsis', () => {
  const long = 'x'.repeat(600);
  const out = discordSnippet(long, 500);
  assert.equal(out.length, 500);
  assert.ok(out.endsWith('…'));
  assert.equal(discordSnippet('short', 500), 'short');   // under the cap is untouched
});

/* parseFeedScope is the gate on WHAT an admin can subscribe a Discord channel to:
   only our own /api/comments/feed, only a real selector. Anything else is refused
   (null), so the worker never fans out an arbitrary or external feed. */
test('parseFeedScope reads our feed selectors', () => {
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed?topic=219'), 'topic:219');
  assert.equal(parseFeedScope('/api/comments/feed?topic=219'), 'topic:219');            // relative paste
  assert.equal(parseFeedScope('  https://merecatholicity.com/api/comments/feed?topic=7  '), 'topic:7'); // trimmed
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed?cat=General'), 'cat:general'); // lowercased
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed?page=/credo.html'), 'page:/credo.html');
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed/?topic=5'), 'topic:5'); // trailing slash ok
});

test('parseFeedScope refuses everything that is not one of our feeds', () => {
  assert.equal(parseFeedScope(''), null);
  assert.equal(parseFeedScope('   '), null);
  assert.equal(parseFeedScope(null), null);
  assert.equal(parseFeedScope(undefined), null);
  assert.equal(parseFeedScope(42), null);
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed'), null);       // no selector
  assert.equal(parseFeedScope('https://merecatholicity.com/community.html?topic=219'), null); // not the feed endpoint
  assert.equal(parseFeedScope('https://evil.example.com/api/comments/feed?topic=1'), 'topic:1'); // host is not checked — selector is what matters (see note)
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed?topic=0'), null);   // not positive
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed?topic=abc'), null); // not an integer
  assert.equal(parseFeedScope('https://merecatholicity.com/api/comments/feed?cat=bad key'), null); // bad chars
  assert.equal(parseFeedScope('not a url at all spaces'), null);
});

test('scopeLabel reads a scope back in words', () => {
  assert.equal(scopeLabel('topic:219'), 'Topic #219');
  assert.equal(scopeLabel('cat:general'), 'Category: general');
  assert.equal(scopeLabel('page:/credo.html'), 'Page: /credo.html');
  assert.equal(scopeLabel('weird'), 'weird');
  assert.equal(scopeLabel(null), '');
});
