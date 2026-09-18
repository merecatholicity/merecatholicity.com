/* Badges everywhere (2026-09-12): the Inbox count and the bell are the
 * shell's — refreshed on every page a live frame reaches, and on reconnect —
 * and reading marks read on every door.
 *
 * What would break silently: the refresh back inside a page boot (a member on
 * Home hears a friend's message and sees nothing until the next platform
 * page — the owner's report); the shell refreshing for the thread on screen
 * (the word appends there and pings seen; a refresh would flash a count);
 * two bells for one message (the classic handlers not deferring); a badge
 * cache untouched when a thread or a post is opened (the bell staying lit
 * for a message the reader is looking at — the other report); the resync
 * not refreshing a stale cache; a stored count PAINTED past its TTL (last
 * visit's number on every fresh open, then taken away — the owner's report,
 * 2026-09-17) or re-stamped so it looks fresh. Every check reads the sources. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientModule, clientDm } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const badges = readFileSync(join(root, 'app', 'badges.ts'), 'utf8');
const shell = readFileSync(join(root, 'app', 'shell.ts'), 'utf8');
const dm = clientDm();
const profile = clientModule('profile');
const board = clientModule('board');

test('the shell owns the refresh: installed right after the live layer, hearing dm and notification frames and the resync', () => {
  const live = shell.indexOf('installLive();'), at = shell.indexOf('installBadges();');
  assert.ok(live > 0 && at > live && at - live < 200, 'installed right after installLive');
  const code = badges.replace(/\/\/[^\n]*/g, '');   // the comments off the lines
  assert.ok(/if \(m\.t === 'dm'\) \{\s*if \(m\.thread_id && openThreadId\(\) === Number\(m\.thread_id\)\) return;\s*if \(m\.from && openThreadWith\(\) === m\.from\) return;\s*bell\(\); refresh\('dm'\);/.test(code), 'a dm frame not for the conversation on screen: the Inbox count and one bell');
  assert.ok(/else if \(m\.t === 'notification'\) \{\s*if \(notifListOpen\(\)\) return;\s*bell\(\); refresh\('notif'\);/.test(code), 'a notification frame, unless the list is open');
  assert.ok(/document\.addEventListener\('mc-live-resync', \(\) => \{[\s\S]*?if \(stale\(DM_CACHE\)\) refresh\('dm'\);\s*if \(stale\(NOTIF_CACHE\)\) refresh\('notif'\);/.test(badges), 'a reconnect refreshes what is stale');
  assert.ok(/if \(now - lastBell < 1500\) return;/.test(badges), 'one sound per burst');
  assert.ok(/localStorage\.setItem\(name, JSON\.stringify\(\{ n: n, at: Date\.now\(\) \}\)\)/.test(badges) && /new CustomEvent\('mc-badge', \{ detail: \{ from: 'shell'/.test(badges), 'the caches the chrome reads, and the event every bar repaints on');
  assert.ok(!/setInterval/.test(badges), 'never a poller');
});

test('the classic handlers defer to the shell, and the identity line follows a shell write', () => {
  assert.ok(/function liveDmBadge\(\) \{\s*if \(\(window as any\)\.mcBadges\) return;/.test(dm), 'the DM badge road defers');
  assert.ok(/function liveNotifBadge\(\) \{\s*if \(\(window as any\)\.mcBadges\) return;/.test(profile), 'the bell road defers');
  assert.ok(/document\.addEventListener\('mc-badge', function \(ev: any\) \{ if \(ev && ev\.detail && ev\.detail\.from === 'shell'\) renderIdentity\(\); \}, \{ signal: bootSig \}\);/.test(profile));
});

test('the fresh count every door hands back is set at once (the doors themselves are run in tests/worker/notif_read)', () => {
  assert.ok(/if \(typeof d\.notif_unread === 'number'\) notifCacheSet\(d\.notif_unread\);/.test(dm), 'the thread sets the bell from its payload');
  assert.ok(/\.then\(function \(d\) \{ if \(d && typeof d\.notif_unread === 'number'\) notifCacheSet\(d\.notif_unread\); \}\)/.test(dm), 'so does the seen ping');
  assert.ok(/if \(typeof d\.notif_unread === 'number'\) notifCacheSet\(d\.notif_unread\);\s*\/\/ opening read the post's bells/.test(board), 'and the feed post');
});

test('a count is painted only while it is fresh, and a fresh open asks at once (2026-09-17)', () => {
  /* the bars and their helpers moved to app/chromebits.ts, the early bundle's
     module (2026-09-17); the chrome is the two files together */
  const chrome = readFileSync(join(root, 'app', 'chromebits.ts'), 'utf8')
    + readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');
  const count = chrome.slice(chrome.indexOf('function badgeCount('), chrome.indexOf('function badgeText('));
  assert.ok(/core\.cacheBadgeShows\(Date\.now\(\) - \(Number\(o\.at\) \|\| 0\)\)/.test(count),
    'the chrome asks the kernel whether the stored number may still be shown');
  assert.ok(/if \(!core \|\| !core\.cacheBadgeShows\) return 0;/.test(count), 'no kernel: no badge, never a guess');
  assert.ok(!/o\.n > 0 \? o\.n : 0;[\s\S]{0,40}\} catch/.test(count), 'the old unconditional paint is gone');
  assert.ok(/function askIfUnpaintable\(\) \{[\s\S]*?if \(stale\(DM_CACHE\)\) refresh\('dm', 0\);\s*if \(stale\(NOTIF_CACHE\)\) refresh\('notif', 0\);/.test(badges),
    'the shell asks for an unpaintable count with no debounce');
  assert.ok(/\n  askIfUnpaintable\(\);/.test(badges), 'on the fresh open, once');
  assert.ok(/function refresh\(which: string, wait = 300\)/.test(badges), 'a live frame keeps its debounce');
  assert.ok(!/setInterval/.test(badges), 'still never a poller');
  /* and neither classic check may re-stamp a stored count */
  for (const [name, src] of [['dm-inbox', dm], ['profile', profile]]) {
    assert.ok(/if \(window\.mcBadges\) \{ window\.mcBadges\.refresh\('(dm|notif)', force \? 300 : 0\); return; \}/.test(src),
      name + ': the read defers to the shell where it stands');
    assert.ok(/Asking = true;/.test(src) && /Asking = false;/.test(src), name + ': an in-flight flag keeps parallel boots quiet');
    assert.ok(!/localStorage\.setItem\((DM|NOTIF)_CACHE, JSON\.stringify\(\{ n: c \? c\.n : 0, at: Date\.now\(\) \}\)\)/.test(src),
      name + ': never a stamp that makes last visit\'s number look fresh');
  }
});
