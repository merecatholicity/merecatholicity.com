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
import { isDiscordWebhook, discordSnippet } from '../../comments-worker/src/pure.js';

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
