/* Domain.Links — offsite profile links (website + X/FB/Instagram/TikTok). The
   security-critical rule: a stored value becomes an href, so nothing but an
   http(s) URL or a normalized handle-URL may ever pass. This locks that. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Links from '../../purescript/output/Domain.Links/index.js';

const norm = (p: string, raw: string) => Links.normalize(p)(raw);

test('bare handles normalize to the platform URL (@ stripped)', () => {
  assert.deepEqual(norm('x', 'adam'), { ok: true, url: 'https://x.com/adam', error: '' });
  assert.deepEqual(norm('x', '@adam'), { ok: true, url: 'https://x.com/adam', error: '' });
  assert.equal(norm('facebook', 'adam.smith').url, 'https://www.facebook.com/adam.smith');
  assert.equal(norm('instagram', 'adam_s').url, 'https://www.instagram.com/adam_s');
  assert.equal(norm('tiktok', 'adam').url, 'https://www.tiktok.com/@adam');
});

test('explicit http(s) URLs are kept as-is', () => {
  assert.equal(norm('x', 'https://x.com/adam').url, 'https://x.com/adam');
  assert.equal(norm('instagram', 'http://instagram.com/adam').url, 'http://instagram.com/adam');
  assert.equal(norm('website', 'https://example.com/me').url, 'https://example.com/me');
});

test('website accepts a bare domain (https prefixed) but not a bare word', () => {
  assert.equal(norm('website', 'example.com').url, 'https://example.com');
  assert.equal(norm('website', 'my.site/path').url, 'https://my.site/path');
  assert.equal(norm('website', 'notaurl').ok, false);
});

test('empty is a valid cleared value', () => {
  assert.deepEqual(norm('x', ''), { ok: true, url: '', error: '' });
  assert.deepEqual(norm('website', '   '), { ok: true, url: '', error: '' });
});

test('SECURITY: non-http(s) schemes are rejected', () => {
  assert.equal(norm('website', 'javascript:alert(1)').ok, false);
  assert.equal(norm('website', 'javascript:alert(1)').error, 'bad_scheme');
  assert.equal(norm('x', 'data:text/html,hi').ok, false);
  assert.equal(norm('website', 'mailto:a@b.com').ok, false);
});

test('handles reject illegal characters and over-length', () => {
  assert.equal(norm('x', 'has space').ok, false);
  assert.equal(norm('x', 'bad/slash').ok, false);
  assert.equal(norm('x', 'x'.repeat(201)).error, 'too_long');
});

test('our own hosts: the apex, www and every subdomain, and nothing that only looks like one', () => {
  for (const u of ['https://merecatholicity.com', 'https://merecatholicity.com/journal.html?a=1',
                   'http://www.merecatholicity.com/#x', 'https://press.merecatholicity.com/',
                   'https://files.merecatholicity.com/book.pdf', 'HTTPS://Press.MereCatholicity.com/titles/x/']) {
    assert.equal(Links.isOwnHost(u), true, u);
  }
  for (const u of ['https://merecatholicity.com.evil.example/', 'https://notmerecatholicity.com/',
                   'https://evil.example/?https://merecatholicity.com', 'javascript:alert(1)//merecatholicity.com',
                   'https://merecatholicity.community/', 'ftp://merecatholicity.com/', '']) {
    assert.equal(Links.isOwnHost(u), false, u);
  }
});

test('the site itself is the apex or www alone: a subdomain is ours but not this app', () => {
  assert.equal(Links.isOwnSite('https://merecatholicity.com/kjv.html#john-3-16'), true);
  assert.equal(Links.isOwnSite('https://www.merecatholicity.com'), true);
  assert.equal(Links.isOwnSite('https://press.merecatholicity.com/'), false);
});
