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
 * not refreshing a stale cache. Every check reads the sources. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientModule } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const badges = readFileSync(join(root, 'app', 'badges.ts'), 'utf8');
const shell = readFileSync(join(root, 'app', 'shell.ts'), 'utf8');
const idx = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
const dm = clientModule('dm');
const profile = clientModule('profile');
const board = clientModule('board');

test('the shell owns the refresh: installed right after the live layer, hearing dm and notification frames and the resync', () => {
  const live = shell.indexOf('installLive();'), at = shell.indexOf('installBadges();');
  assert.ok(live > 0 && at > live && at - live < 200, 'installed right after installLive');
  const code = badges.replace(/\/\/[^\n]*/g, '');   // the comments off the lines
  assert.ok(/if \(m\.t === 'dm'\) \{\s*if \(m\.from && openThreadWith\(\) === m\.from\) return;\s*bell\(\); refresh\('dm'\);/.test(code), 'a dm frame not for the thread on screen: the Inbox count and one bell');
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

test('reading marks read on every door, and the fresh count rides back', () => {
  const thread = idx.slice(idx.indexOf('async function handleDmThread('), idx.indexOf('\nasync function ', idx.indexOf('async function handleDmThread(') + 10));
  assert.ok(/UPDATE notifications SET read_at = \?3 WHERE recipient_hash = \?1 AND kind IN \('dm','dm-react','call'\) AND actor_hash = \?2 AND read_at IS NULL/.test(thread), 'opening a conversation reads every bell its sender rang');
  assert.ok(/notif_unread: await notifUnreadCount\(env, me\) \}, 200\);/.test(thread), 'and says the fresh count');
  const seen = idx.slice(idx.indexOf('async function handleDmSeen('), idx.indexOf('\nasync function ', idx.indexOf('async function handleDmSeen(') + 10));
  assert.ok(/kind IN \('dm','dm-react','call'\) AND actor_hash = \?2 AND read_at IS NULL/.test(seen) && /return json\(\{ ok: true, notif_unread: await notifUnreadCount\(env, me\) \}, 200\);/.test(seen), 'the seen ping too');
  const post = idx.slice(idx.indexOf('async function handleWallPostGet('), idx.indexOf('\nasync function ', idx.indexOf('async function handleWallPostGet(') + 10));
  assert.ok(/kind IN \('wall','wall-like','wall-react'\) AND comment_id = \?2 AND read_at IS NULL/.test(post) && /notif_unread: notifUnread/.test(post), 'opening a feed post reads its bells');
  const react = idx.slice(idx.indexOf('async function handleDmReact('), idx.indexOf('\nasync function ', idx.indexOf('async function handleDmReact(') + 10));
  assert.ok(/dmViewing\(other, me\)/.test(react) && /if \(!onScreen\) \{ const ring = notifyReact\(env, bell\);/.test(react), 'a reaction to a word on screen rings no bell');
  assert.ok(/if \(typeof d\.notif_unread === 'number'\) notifCacheSet\(d\.notif_unread\);/.test(dm), 'the thread sets the bell from its payload');
  assert.ok(/\.then\(function \(d\) \{ if \(d && typeof d\.notif_unread === 'number'\) notifCacheSet\(d\.notif_unread\); \}\)/.test(dm), 'so does the seen ping');
  assert.ok(/if \(typeof d\.notif_unread === 'number'\) notifCacheSet\(d\.notif_unread\);\s*\/\/ opening read the post's bells/.test(board), 'and the feed post');
});
