/* The conversation reads like a chat app (2026-09-11): reading back is never
 * interrupted and never blind, and typing shows wherever the reader is.
 *
 * What would break silently: a live word auto-scrolling a reader who was
 * reading back (their place lost); a word that landed out of view with
 * nothing to say so (a jump button that never appears, a badge that never
 * counts, no unread line); "seen" sent for words the reader never reached;
 * the unread line on open drawn without the server's word for what was unread
 * BEFORE the open marked it read; typing shown only where the reader is not
 * looking; the inbox badge reading "new" for twelve words. Source rules over
 * the DM client and the Lit inbox; the DM battery proves them in a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientModule } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dm = clientModule('dm');
const inbox = readFileSync(join(root, 'app', 'views', 'profile.ts'), 'utf8');
const view = dm.slice(dm.indexOf('function viewDm('), dm.indexOf('\n  function bind() {'));
const append = view.slice(view.indexOf('append: function (msg: any) {'), view.indexOf('editMsg: function'));
const dmCss = (() => { const i = dm.indexOf('function ensureDmStyles()'); return dm.slice(i, dm.indexOf("st.id = 'mc-dm-css'", i)); })();

test('a live word never scrolls a reader who is reading back: it waits under the unread line and the jump button counts it', () => {
  assert.ok(/var wasNear = nearEnd\(\);\s*var landed = placeMsg\(msg\);\s*if \(wasNear\) \{\s*scrollToEnd\(\);/.test(append), 'at the foot: the word scrolls into view');
  assert.ok(/\} else \{[\s\S]*?if \(!pending\) setUnreadLine\(1, landed\); else bumpUnreadLine\(pending \+ 1\);\s*pending \+= 1; unseenLive \+= 1;/.test(append),
    'reading back: the line above the first waiting word, the count bumped after, and no scroll');
  assert.ok(/updateJump\(\);\s*\} else \{/.test(append), 'the button is re-judged after every live word');
});

test('"seen" goes out only for words the reader reached: at the foot as they arrived, or when the reader comes down to them', () => {
  assert.equal((append.match(/dmSeenPing\(other\)/g) || []).length, 1, 'one ping in append — in the at-the-foot branch');
  assert.ok(/if \(wasNear\) \{\s*scrollToEnd\(\);[\s\S]*?dmSeenPing\(other\);\s*\} else \{/.test(append));
  assert.ok(/function updateJump\(\) \{[\s\S]*?if \(!away\) \{\s*pending = 0;\s*if \(unseenLive\) \{ unseenLive = 0; dmSeenPing\(other\); \}/.test(view),
    'reaching the foot pings once for the live words that waited there');
});

test('the jump button: hung from the fixed composer, shown whenever the foot is out of view, its badge the count, a smooth ride down', () => {
  assert.ok(/jump = el\('button', 'dm-jump'\);[\s\S]*?form\.appendChild\(jump\);/.test(view), 'it rides the composer, and so the keyboard');
  assert.ok(/jump\.hidden = !away;/.test(view) && /jumpN\.hidden = !pending;/.test(view) && /jumpN\.textContent = pending > 99 \? '99\+' : String\(pending\);/.test(view));
  assert.ok(/jump\.addEventListener\('click', function \(\) \{ scrollToEnd\(true\); \}\);/.test(view), 'a tap rides down smoothly');
  assert.ok(/window\.addEventListener\('scroll', function \(\) \{\s*if \(jumpRaf\) return;\s*jumpRaf = requestAnimationFrame\(function \(\) \{ jumpRaf = 0; updateJump\(\); \}\);\s*\}, \{ passive: true, signal: bootSig \} as any\);/.test(view),
    'one rAF-throttled scroll listener, dying with the boot');
  assert.ok(/\.dm-jump\{position:absolute;right:\.7rem;bottom:calc\(100% \+ \.6rem\)/.test(dmCss), 'the button sits above the composer');
  assert.ok(/\.dm-jump\[hidden\]\{display:none\}/.test(dmCss) && /\.dm-jump-n\[hidden\]\{display:none\}/.test(dmCss), 'hidden means hidden — both carry their own display');
});

test('the unread line on open: above the first unread word the SERVER named, the count on the button, and WhatsApp\'s landing', () => {
  assert.ok(/var firstUnread = d\.unread_from \? list\.querySelector\(/.test(view), 'the server says which word was first unread before the open');
  assert.ok(/if \(firstUnread && Number\(d\.unread\) > 0\) \{ setUnreadLine\(Number\(d\.unread\), firstUnread\); pending = Number\(d\.unread\); \}/.test(view));
  assert.ok(/function landing\(\) \{\s*scrollToEnd\(\);\s*if \(unreadLine\) \{[\s\S]*?if \(top < under\)[\s\S]*?\}\s*updateJump\(\);\s*\}/.test(view),
    'the foot; then the line just under the header when the unread words do not fit');
  assert.ok(/var settle = function \(\) \{ landing\(\); if \(\+\+n < 6\) setTimeout\(settle, 50\); \};/.test(view), 'the post-load re-landing lands the same way');
  assert.ok(/function unreadText\(n: number\) \{ return n === 1 \? '1 unread message' : n \+ ' unread messages'; \}/.test(view));
  assert.ok(/\.dm-unread-line\{display:flex;/.test(dmCss) && /\.dm-unread-line::before,\.dm-unread-line::after\{content:"";flex:1;border-top:/.test(dmCss), 'a rule with the words in the middle');
});

test('typing shows wherever the reader is: the header line, a three-dot bubble at the foot, and the inbox row', () => {
  assert.ok(/setTyping: function \(on: any\) \{\s*clearTimeout\(typingHideT\);\s*typingOn = !!on; paintSub\(\); typingBubble\(!!on\);/.test(view));
  assert.ok(/function typingBubble\(on: boolean\) \{[\s\S]*?typingNode = el\('div', 'dm-msg dm-typing-bubble'\);[\s\S]*?for \(var i = 0; i < 3; i\+\+\) typingNode\.appendChild\(el\('span', 'dm-typing-dot'\)\);[\s\S]*?if \(wasNear\) scrollToEnd\(\);/.test(view),
    'the bubble keeps the foot in view when the reader is there');
  assert.ok(/paintSub\(\); typingBubble\(false\);   \/\/ a real message ends "typing"/.test(view));
  assert.ok(/if \(state\.inboxTyping\) state\.inboxTyping\(m\.from, m\.state !== 'stop'\);/.test(dm), 'the classic inbox hears it');
  assert.ok(/else if \(det\.t === 'typing' && det\.from\) this\._typing\(String\(det\.from\), det\.state !== 'stop'\);/.test(inbox), 'the Lit inbox hears it');
  assert.ok(/if \(this\.typing && this\.typing\[h\]\) return html`<div class="board-row-sub dm-row-pres"><span class="dm-row-dot on"><\/span><span class="dm-sub-typing">typing…<\/span><\/div>`;/.test(inbox),
    'the Lit inbox row reads typing…');
  assert.ok(/@keyframes dm-typing\{/.test(dmCss) && /\.dm-typing-dot:nth-child\(2\)\{animation-delay:\.2s\}/.test(dmCss));
  const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');
  assert.ok(/\.dm-sub-typing \{ color: #3ba55d; font-style: italic; animation: dm-typing-pulse/.test(css), 'the stylesheet styles the word where the DM block is not injected (the inbox)');
});

test('the inbox badge is the count', () => {
  assert.ok(/el\('span', 'dm-unread-badge', String\(t\.unread\)\)/.test(dm), 'classic');
  assert.ok(/<span class="dm-unread-badge">\$\{t\.unread\}<\/span>/.test(inbox), 'Lit');
});
