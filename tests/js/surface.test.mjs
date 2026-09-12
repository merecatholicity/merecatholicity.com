/* The shared press-and-hold surface and the reactions' ledger (2026-09-12):
 * the one overlay a message, a board post, an article-page comment, a feed
 * post and a feed comment open — reactions above, the node lit in a hole,
 * the acts below — and the ledger every public pill paints from.
 *
 * What would break silently: a post's ⋯ growing its own menu again beside
 * the surface (two roads, one of them without the reaction bar); a post
 * armed for the hold without the reaction it is armed for; the caller's own
 * act elements NOT returned to their pop on close (the standing webtests
 * assert them there, and the next open would find the pop empty); a touch on
 * a feed comment opening its post's surface too; a reaction sent that the
 * kernel would refuse; a live tally overwriting the viewer's own reaction;
 * the phone selection rule for posts missing (a hold that starts a
 * selection under the finger — the DM's lesson). Every check reads the
 * sources; nothing runs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientAll, clientModule } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = clientAll();
const surface = clientModule('surface');
const board = clientModule('board');
const wall = clientModule('wall');
const dm = clientModule('dm');
const postView = readFileSync(join(root, 'app', 'views', 'post.ts'), 'utf8');
const mainCss = readFileSync(join(root, 'styles', 'main.css'), 'utf8');
const fn = (text, name, next) => {
  const i = text.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = next ? text.indexOf(`function ${next}(`, i + 10) : text.indexOf('\n  function ', i + 10);
  return text.slice(i, j > i ? j : i + 9000);
};

test('one surface: the DM, the board and the feed all open openActs; nothing else builds a dm-act', () => {
  assert.equal((src.match(/el\('div', 'dm-act /g) || []).length, 1, 'the overlay root is built in exactly one place');
  assert.ok(/openActs\(\{ node: node, at: at, mine: mine,/.test(fn(dm, 'dmOpenActions', 'dmArmGestures')), 'the DM opens the shared surface');
  assert.ok(/openActs\(\{\s*node: host \|\| wrap,/.test(fn(board, 'postMenu')), 'the ⋯ opens the shared surface');
  assert.ok(!/comment-menu-sheet/.test(board), 'the ⋯ no longer travels its items into the app sheet — the surface is the phone road');
  assert.ok(!/wrap\.classList\.add\('open'\)/.test(board), 'nor opens its own desktop pop');
});

test('a post is armed for the hold with the reaction it is armed for, in both renderers', () => {
  const classic = fn(board, 'commentNode', 'postMenu');
  assert.ok(/hold: article, react: \{ target: 'post', id: c\.id, seed: c \}/.test(classic), 'the classic renderer');
  assert.ok(/hold: article, react: \{ target: 'post', id: c\.id, seed: c \}/.test(postView), 'the Lit renderer');
  assert.ok(/if \(items\.length \|\| state\.myHash\)/.test(classic) && /if \(items\.length \|\| kit\.state\.myHash\)/.test(postView),
    'a keyed reader gets the ⋯ even on a post with no acts — it is the road to the reaction bar on desktop');
  const menu = fn(board, 'postMenu');
  assert.ok(/if \(host\) armHold\(host, open\);/.test(menu), 'postMenu arms the node it is given');
  assert.ok(/if \(react && host && !react\.silent\) reactRegister\(react\.target, react\.id, host, react\.seed\);/.test(menu),
    'and registers the post in the ledger unless the caller paints its own pill');
  assert.ok(/react: react && state\.myHash\s*\? \{ current: reactMine\(react\.target, react\.id\), onPick:/.test(menu), 'the bar shows the viewer\'s current reaction, and only to a keyed reader');
});

test('the feed: a post is a wall target, a comment a wallc target, each painting its own pill; Like is the ❤️', () => {
  assert.ok(/react: \{ target: 'wall', id: p\.id, seed: p, silent: true \}/.test(wall) && /react: \{ target: 'wallc', id: c\.id, seed: c, silent: true \}/.test(wall));
  assert.ok(/reactRegister\('wall', post\.id, box, post, function \(cells: any\[\], mine: string\)/.test(wall), 'the action bar paints from the ledger');
  assert.ok(/reactRegister\('wallc', c\.id, wrap, c, function \(cells: any\[\], mine: string\)/.test(wall), 'so does the comment\'s like control');
  assert.ok(/reactSend\('wall', post\.id, '❤️'\)/.test(wall) && /reactSend\('wallc', c\.id, '❤️'\)/.test(wall), 'a tap on Like is the heart');
  assert.ok(/liked = mine === '❤️'/.test(wall), 'Like is lit exactly when my reaction is the heart');
  assert.ok(!/\/wall\/like'/.test(wall) && !/\/wall\/likers'/.test(wall) && !/function showLikers/.test(wall), 'the like roads are gone from the client');
  assert.ok(/node\.id = 'wc-' \+ c\.id;/.test(wall), 'a feed comment carries the anchor a reaction\'s bell lands on');
});

test('a scrim tap in the first moments after opening is the hold\'s own click, never a dismissal', () => {
  const open = fn(surface, 'openActs', 'armHold');
  assert.ok(/var openedAt = Date\.now\(\);/.test(open) && /if \(Date\.now\(\) - openedAt < 400\) return; closeActs\(\);/.test(open),
    'the node may have been scrolled to fit, so the release\'s click lands on a scrim');
});

test('the caller\'s own acts travel into the menu and go HOME on close, in order', () => {
  const open = fn(surface, 'openActs', 'armHold');
  assert.ok(/travelled\.push\(\{ node: it, parent: it\.parentNode \}\);/.test(open), 'each element remembers where it came from');
  assert.ok(/travelled\.forEach\(function \(t\) \{\s*t\.node\.classList\.remove\('dm-act-item'\); t\.node\.removeAttribute\('role'\);\s*if \(t\.parent\) t\.parent\.appendChild\(t\.node\);/.test(open),
    'and goes back on close, its menu dress removed');
  assert.ok(/setTimeout\(closeActs, 0\)/.test(open), 'a travelled act closes the surface AFTER its own handler has run');
  const menu = fn(board, 'postMenu');
  assert.ok(/onClose: function \(\) \{ items\.forEach\(function \(k: any\) \{ pop\.appendChild\(k\); \}\); \}/.test(menu), 'the ⋯ puts them back in its pop');
});

test('the nearest armed node takes the hold; a control, a field or a pill is never a hold', () => {
  const arm = fn(surface, 'armHold', 'reactKey');
  assert.ok(/node\.setAttribute\('data-mc-hold', ''\);/.test(arm) && /t\.closest\('\[data-mc-hold\]'\) !== node\) return;/.test(arm),
    'a feed comment inside a feed post takes its own hold; the post stays still');
  assert.ok(/if \(skip && t && t\.closest && t\.closest\(skip\)\) return;/.test(arm));
  assert.ok(/'video,audio,textarea,input,select,button,a\.wall-media,\.dm-edit-box,\.dm-react-pill,\.mc-react-pill,\.comment-form'/.test(arm), 'the default skip list');
  assert.ok(/if \(o\.contextmenu\) \{/.test(arm) && /if \(o\.more\) \{/.test(arm), 'a right-click and the hover ⌄ are the DM\'s roads, asked for');
  assert.ok(/contextmenu: true, more: true/.test(fn(dm, 'dmArmGestures', 'dmBubble')), 'the DM asks for both');
  assert.ok(!/contextmenu: true/.test(fn(board, 'postMenu')), 'a post keeps the browser\'s own menu over its prose');
});

test('the ledger: a reaction goes out only through the kernel; mine again withdraws; a live tally keeps my own', () => {
  const send = fn(surface, 'reactSend', 'bump');
  assert.ok(/if \(want === was\) want = '';/.test(send));
  assert.ok(/window\.mcCore\.reaction\(want\) === null\) return;/.test(send), 'validated by Domain.Reaction before the wire');
  assert.ok(/fetch\(API \+ '\/react'/.test(send) && /emoji: want/.test(send));
  assert.ok(/ent\.cells = before; ent\.mine = was;/.test(send), 'reverted on refusal');
  assert.ok(/if \(!state\.myHash\) \{ if \(window\.mcOnboard\) window\.mcOnboard\(\); return; \}/.test(send), 'a keyless reader is shown the door in');
  const live = fn(surface, 'onLiveReact', 'closeWho');
  assert.ok(/ledger\[k\]\.cells = /.test(live) && !/\.mine = /.test(live), 'a live tally never touches the viewer\'s own reaction');
  assert.ok(/if \(m\.t === 'react'\) onLiveReact\(m\);/.test(surface), 'the frame lands in run()');
  assert.ok(/reactLoadMine\('post', /.test(board) && /kit\.reactLoadMine\('post', /.test(readFileSync(join(root, 'app', 'views', 'topic.ts'), 'utf8')) && /reactLoadMine\('post', d\.comments/.test(clientModule('comments')),
    'the viewer\'s own reactions ride a keyed read after every cached board payload — topic (both renderers) and article page');
});

test('on a phone a hold picks a post, never a word: posts are not selectable text, their fields are', () => {
  assert.ok(/@media \(hover: none\) \{\s*\.comment \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}\s*\.comment textarea, \.comment input \{ -webkit-user-select: text; user-select: text; \}/.test(mainCss),
    'main.css: .comment is not selectable under (hover:none); its textarea/input stay text');
});

test('the DM bell lands on the message: ?m= rides find= to the server and is scrolled to', () => {
  assert.ok(/else if \(mWant > 0\) payload\.find = mWant;/.test(dm), 'the thread asks for the message\'s page');
  assert.ok(/var landOn = mWant > 0 \? list\.querySelector\('\[data-dmid="' \+ mWant \+ '"\]'\) : null;/.test(dm) && /dmFlash\(landOn\);/.test(dm));
  const idx = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
  assert.ok(/const find = Math\.floor\(Number\(data\.find\) \|\| 0\);/.test(idx) && /p = Math\.floor\(\(\(pos && pos\.n\) \|\| 0\) \/ DM_PER_PAGE\) \+ 1;/.test(idx), 'the worker places it');
});
