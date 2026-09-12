/* The DM message action surface (2026-09-10): the WhatsApp press-and-hold
 * over one bubble — reactions above, the bubble lit in a hole between four
 * pieces of scrim, the menu below — and the reply envelope a quoted reply
 * rides in. Since 2026-09-12 the overlay and the gestures are the SHARED
 * surface (client/surface.ts openActs / armHold — the board and the feed
 * open the same one); the DM keeps its bubble, its acts and its swipe. The
 * laws below are the surface's, wherever it is opened from.
 *
 * What would break silently: an overlay that lets a touch reach the page
 * behind it (the law every overlay here keeps — contained overscroll, an
 * inert scrim, the document locked while it stands); a lock released by a
 * surface that never took it; a surface that outlives the boot; a gesture
 * that steals the page's own scroll; the mount-hole (bubble) styles that the
 * hover ⌄ and the reaction pill hang from; and the envelope: a reply must
 * survive a round trip and any older plaintext must still read as itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
import { clientAll } from '../_support/client.mjs';
const src = clientAll();
const mainCss = readFileSync(join(root, 'styles', 'main.css'), 'utf8');

const fn = (name, next) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = next ? src.indexOf(`function ${next}(`, i + 10) : src.indexOf('\n  function ', i + 10);
  return src.slice(i, j > i ? j : i + 8000);
};

/* The injected stylesheets, as the strings they are built from: the DM's own
   block and the surface's (the overlay's rules moved there with the code). */
const block = (fnName, id) => {
  const i = src.indexOf('function ' + fnName + '()');
  const j = src.indexOf("st.id = '" + id + "'", i);
  assert.ok(i > 0 && j > i, fnName + ' not found');
  return src.slice(i, j);
};
const dmCss = block('ensureDmStyles', 'mc-dm-css') + '\n' + block('ensureActStyles', 'mc-act-css');

test('the surface keeps the three overlay layers: contained overscroll, an inert scrim, the document lock', () => {
  assert.ok(/\.dm-act-scrim\{[^}]*touch-action:none/.test(dmCss), 'a drag on the scrim must not scroll the document');
  assert.ok(/\.dm-act-scrim\{[^}]*overscroll-behavior:contain/.test(dmCss), 'the scrim ends the scroll chain');
  assert.ok(/\.dm-act-bar\{[^}]*overscroll-behavior:contain/.test(dmCss), 'the (scrollable) reaction bar ends the chain too');
  const open = fn('openActs', 'armHold');
  assert.ok(/lockedByUs = !!window\.mcSheet\.lock\(\)/.test(open), 'the phone surface takes the sheet\'s own document lock');
  assert.ok(/if \(lockedByUs && window\.mcSheet && window\.mcSheet\.unlock\) window\.mcSheet\.unlock\(\)/.test(open),
    'the lock is released only by the surface that took it — never one a sheet holds');
});

test('the lock says whether it was taken, and the sheet bridge hands it out', () => {
  const chrome = readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');
  const lock = chrome.slice(chrome.indexOf('function lockDocument()'), chrome.indexOf('function unlockDocument()'));
  assert.ok(/if \(lockY !== null\) return;/.test(lock) && /return true;\s*\}\s*$/.test(lock),
    'lockDocument returns true only when this call took the lock');
  assert.ok(/lock: lockDocument,\s*unlock: unlockDocument,/.test(chrome), 'window.mcSheet exposes lock/unlock');
});

test('one surface at a time, and it dies with the boot', () => {
  assert.ok(/bootSig\.addEventListener\('abort', closeActs, \{ once: true \}\)/.test(src),
    'a soft navigation must tear the surface down — the boot re-runs, the overlay must not stay');
  const open = fn('openActs', 'armHold');
  assert.ok(/^\s*closeActs\(\);/m.test(open), 'opening closes whatever was open');
  assert.ok(/document\.removeEventListener\('keydown', onKey, true\)/.test(open) && /window\.removeEventListener\('scroll', onScroll, true\)/.test(open),
    'every listener the surface installs is removed on close');
});

test('a hold is not a scroll, a scroll is not a hold, and the click after a hold is swallowed', () => {
  const arm = fn('armHold', 'reactKey');
  assert.ok(/'touchstart'[\s\S]*\{ passive: true \}/.test(arm) && /'touchmove'[\s\S]*\{ passive: true \}/.test(arm),
    'the touch listeners are passive — the page\'s own scroll is never delayed by them');
  assert.ok(/Math\.abs\(mx\) > 8 \|\| Math\.abs\(my\) > 8\) cancelHold\(\)/.test(arm), 'a press that moves is a scroll, not a hold');
  assert.ok(/if \(held\) \{ held = false; e\.preventDefault\(\); e\.stopImmediatePropagation\(\); \}/.test(arm),
    'the click that follows a hold must not also follow a link under the finger — nor reach the surface\'s own tap-to-close');
  assert.ok(/touch-action:pan-y pinch-zoom/.test(dmCss), 'bubbles keep vertical panning and pinch-zoom for the browser');
  assert.ok(/@media \(hover:none\)\{[^}]*\.dm-more\{display:none\}/.test(dmCss), 'the hover ⌄ is the pointer\'s road only');
});

test('the bubble is the mount the pill and the ⌄ hang from', () => {
  assert.ok(/\.dm-msg \{\s*position: relative;/.test(mainCss), 'main.css .dm-msg must be position: relative');
  assert.ok(/\.dm-react-pill\{position:absolute/.test(dmCss) && /\.dm-more\{position:absolute/.test(dmCss));
  assert.ok(/\.dm-msg\.dm-has-react\{margin-bottom/.test(dmCss), 'a bubble with a pill leaves room for it below');
  /* The saved mark is quiet (the owner's second look, 2026-09-11): a small
     star in the meta's own ink — never a ring, never a second color. */
  assert.ok(!/\.dm-msg\.dm-saved\{[^}]*box-shadow/.test(dmCss), 'a saved bubble carries no ring');
  assert.ok(/\.dm-savedmark\{color:var\(--dm-saved\)/.test(dmCss), 'the saved star is gold');
  assert.ok(/\.dm-msg\.dm-saved\{border-color:color-mix\(in srgb,var\(--dm-saved\)/.test(dmCss), 'and the bubble\'s own border takes the tint');
});

test('a downward swipe over the page dismisses the keyboard; the thread names Online or Offline; a profile shows presence', () => {
  const helper = src.slice(src.indexOf('function swipeDismissesKeyboard('), src.indexOf('function dmArmGestures('));
  assert.ok(/document\.addEventListener\('touchstart'[\s\S]*\{ passive: true, signal: bootSig \}\)/.test(helper)
    && /document\.addEventListener\('touchmove'[\s\S]*\{ passive: true, signal: bootSig \}\)/.test(helper),
    'the document listeners are passive and die with the boot');
  assert.ok(/document\.activeElement !== ta/.test(helper), 'live only while the field has the keyboard');
  assert.ok(/composer\.contains\(t\)\) \? -1 :/.test(helper), 'a swipe that starts inside the composer is left alone');
  assert.ok(/clientY - y0 > 48\) \{ y0 = -1; try \{ ta\.blur\(\); \}/.test(helper), '48px downward blurs the field once');
  const view = src.slice(src.indexOf('function viewDm('), src.indexOf('\n  function ', src.indexOf('function viewDm(') + 10));
  assert.ok(/swipeDismissesKeyboard\(ta, form\);/.test(view), 'the DM composer takes it');
  assert.ok(/swipeDismissesKeyboard\(q, form\);/.test(src.slice(src.indexOf('function viewMerecat('))), 'so does the merecat ask box');
  assert.ok(/if \(presOn === false\) \{[\s\S]*?seenAt \? 'Last seen ' \+ dmSeenLabel\(seenAt\) : 'Offline'/.test(view),
    'the thread header says Last seen … (the hub\'s stamp) or Offline once the hub has answered, the lock only while unknown');
  assert.ok(/var seenAt: number = Number\(\(d\.other && d\.other\.last_seen\) \|\| 0\);/.test(view), 'the stamp arrives with the thread');
  assert.ok(/if \(presOn === true && !on && seenAt !== -1\) seenAt = Math\.floor\(Date\.now\(\) \/ 1000\);/.test(view), 'an offline seen live is "just now"');
  assert.ok(/bootSig\.addEventListener\('abort', function \(\) \{ clearInterval\(seenTick\); \}, \{ once: true \}\);/.test(view), 'the minute repaint dies with the boot');
  const label = fn('dmSeenLabel');
  for (const step of ["'just now'", "' min ago'", "'today at '", "'yesterday at '", "' at ' + time", "month: 'short', day: 'numeric', year: 'numeric'"]) {
    assert.ok(label.includes(step), 'the last-seen ladder has ' + step);
  }
  const prof = src.slice(src.indexOf('function profilePresenceInto('), src.indexOf('function renderProfile('));
  assert.ok(/hash === state\.myHash \|\| hash === MERECAT_BOT_HASH/.test(prof), 'not for yourself, not for the bot');
  assert.ok(/API \+ '\/dm\/presence'/.test(prof) && /board\.sub\(\['presence:' \+ hash\]\)/.test(prof), 'one keyed read, then the live frames');
  assert.ok(/seenAt = Number\(\(d\.seen && d\.seen\[hash\]\) \|\| 0\);/.test(prof) && /'Last seen ' \+ dmSeenLabel\(seenAt\) : 'Offline'/.test(prof),
    'the profile line reads Last seen … from the presence read, Offline without a stamp');
  assert.ok(/if \(state\.profilePresence\) state\.profilePresence\(m\.hash, !!m\.online\);/.test(src), 'the live frame reaches the open profile');
  /* The inbox rows carry the same line (the owner's ninth look). */
  const inbox = readFileSync(join(root, 'app', 'views', 'profile.ts'), 'utf8');
  const cls = inbox.slice(inbox.indexOf('class McInbox'), inbox.indexOf("customElements.define('mc-inbox'"));
  assert.ok(/kit\.API \+ '\/dm\/presence'/.test(cls), 'the inbox reads presence for the page\'s members once the threads arrive');
  assert.ok(/kit\.state\.inboxPresence = /.test(cls), 'and takes the live frames');
  /* The hub seeds "offline" on subscribe for a member never online here; only
     a transition may stamp "just now" over the read's real last-seen. */
  assert.ok(/const wasOn = !!online\[h\];\s*if \(on\) online\[h\] = true; else \{ delete online\[h\]; if \(wasOn\) seen\[h\] = Math\.floor/.test(cls),
    'the inbox stamps "just now" only on an online → offline transition');
  const classic = src.slice(src.indexOf('var presDots: Record<string, any> = {};'), src.indexOf("function inboxHref(i: any)"));
  assert.ok(/if \(!on && was\) seenMap\[h\] = Math\.floor\(Date\.now\(\) \/ 1000\);/.test(classic), 'so does the classic fallback');
  const profile = src.slice(src.indexOf('function profilePresenceInto('), src.indexOf('function renderProfile('));
  assert.ok(/if \(wasOn === true && !on\) seenAt = Math\.floor/.test(profile), 'and the profile line');
  assert.ok(/\.slice\(0, 5\)\.map\(\(h: string\) => 'presence:' \+ h\)/.test(cls), 'watches the first five rows live (the socket\'s scope cap)');
  assert.ok(/dm-row-pres/.test(cls) && /kit\.dmSeenLabel\(/.test(cls), 'renders Online / Last seen … / Offline under the name');
  assert.ok(/dmSeenLabel: dmSeenLabel,/.test(src), 'the label rides the kit');
});

test('the picker and the keyboard never share a phone screen', () => {
  const panel = src.slice(src.indexOf('function buildEmojiPanel('), src.indexOf('function loadKjv('));
  assert.ok(/if \(onPick\) return;\s*try \{ if \(window\.matchMedia && window\.matchMedia\('\(hover: none\)'\)\.matches\) search\.focus\(\);/.test(panel),
    'the search takes focus on touch only for the toolbar\'s own picker — a caller with onPick owns the keyboard');
  const view = src.slice(src.indexOf('function viewDm('), src.indexOf('\n  function ', src.indexOf('function viewDm(') + 10));
  assert.ok(/function openPicker\(\) \{ if \(touchUi\) ta\.blur\(\); emojiPanel\.openPanel\(\); setEmojiFace\(true\); \}/.test(view), 'opening the picker dismisses the keyboard');
  assert.ok(/insertEmojiItem\(ta, it\);\s*if \(touchUi\) closePicker\(\);\s*ta\.focus\(\);/.test(view), 'a pick inserts, closes the picker on touch, and hands the keyboard back');
  assert.ok(/ta\.addEventListener\('focus', function \(\) \{ if \(touchUi && !emojiPanel\.hidden\) closePicker\(\); \}\)/.test(view), 'a tap into the field closes the picker');
  assert.ok(/mcIcon\(open \? 'keyboard' : 'smile'\)/.test(view), 'the button shows its other face while the picker stands');
});

test('an element toggled by its hidden attribute stays hidden', () => {
  /* The reply strip once leaked as an empty box above the field: its
     display:flex rule beat the UA's [hidden]. Same class for the bar and the
     menu behind the picker, the mic/send swap, the attach chip. */
  assert.ok(/\.dm-reply-bar\[hidden\],\.dm-act-bar\[hidden\],\.dm-act-menu\[hidden\],\.dm-c-btn\[hidden\],\.dm-c-send\[hidden\],\.dm-attach-chip\[hidden\]\{display:none!important\}/.test(dmCss));
});

test('the conversation is a chat screen: the header sticks, the composer is fixed above the tab bar and rides the keyboard', () => {
  assert.ok(/\.dm-head\{position:sticky;top:0/.test(dmCss), 'the header is sticky');
  assert.ok(/body\.mc-app \.dm-head\{top:var\(--mc-deskbar-h/.test(dmCss), 'under the desktop bar');
  assert.ok(/body\.mc-app \.dm-head\{top:calc\(var\(--mc-appbar-h/.test(dmCss), 'under the phone app bar');
  /* Fixed, never sticky: a thread opens at the document's end, where a sticky
     bar sits in its natural place above the tab-bar reservation and the footer
     and floats a gap over the tab bar until a scroll re-sticks it. */
  assert.ok(/\.dm-composer\{position:fixed;left:0;right:0;bottom:0/.test(dmCss), 'the composer is fixed');
  assert.ok(!/\.dm-composer\{position:sticky/.test(dmCss), 'never sticky');
  const view0 = src.slice(src.indexOf('function viewDm('), src.indexOf('\n  function ', src.indexOf('function viewDm(') + 10));
  assert.ok(/spacer\.style\.height = \(form\.offsetHeight \+ 8\) \+ 'px'/.test(view0), 'a spacer reserves the bar\'s height under the last bubble');
  assert.ok(/ro\.observe\(form\); ro\.observe\(section\);/.test(view0), 'remeasured as the bar or the column changes');
  assert.ok(/form\.style\.left = Math\.round\(r\.left\)/.test(view0), 'on desktop the bar is aligned to the content column');
  /* Chrome resets the scroll position at the load event; a thread rendered
     before load (a real network) must re-land its foot after it. */
  assert.ok(/if \(document\.readyState !== 'complete'\) \{\s*window\.addEventListener\('load', function \(\) \{[\s\S]*?landing\(\);[\s\S]*?\}, \{ once: true, signal: bootSig \}\);/.test(view0),
    'the thread re-lands its end after the load event, with a listener that dies with the boot');
  assert.ok(/body\.mc-app \.dm-composer\{bottom:calc\(var\(--mc-tabbar-h/.test(dmCss), 'above the phone tab bar');
  assert.ok(/body\.mc-app\.mc-kb-open \.dm-composer\{bottom:var\(--mc-kb,0px\)/.test(dmCss), 'and above the soft keyboard, as the merecat composer does');
  const view = src.slice(src.indexOf('function viewDm('), src.indexOf('\n  function ', src.indexOf('function viewDm(') + 10));
  assert.ok(/warmOnFocus\(ta\)/.test(view), 'the composer is under the Turnstile focus net by hand (it is not wrapped by mdEditor)');
  assert.ok(/form\.appendChild\(el\('div', 'ts-slot'\)\)/.test(view), 'and carries the widget\'s mount point');
  assert.ok(/if \(mic\) \{ mic\.hidden = has; send\.hidden = !has; \}/.test(view), 'mic while empty, Send once there is something to send');
  assert.ok(/!finePointer\) return;\s*e\.preventDefault\(\);\s*send\.click\(\);/.test(view), 'Enter sends only where there is a pointer and a keyboard');
});

test('the reply envelope: sentinel + JSON round-trips, and plain text is itself', () => {
  /* Evaluate the four envelope functions out of the client with the kernel
     stubbed, so the wire grammar is proven, not described. */
  const names = ['dmReplySentinel', 'dmWrapText', 'dmReplyClean', 'dmParseText'];
  /* The client is TypeScript; these four carry only `: any` annotations. */
  const body = names.map((n) => fn(n)).join('\n').replace(/: any\b/g, '');
  const factory = new Function('window', body + '\nreturn { dmWrapText, dmReplyClean, dmParseText };');
  const env = factory({ mcCore: { dmReplySentinel: '\u0001' } });
  const from = 'a'.repeat(64);
  const wrapped = env.dmWrapText('hello\nworld', { id: 42, from, kind: 'text', text: 'what was said' });
  assert.equal(wrapped.charAt(0), '\u0001', 'an envelope opens with the sentinel');
  const back = env.dmParseText(wrapped);
  assert.equal(back.text, 'hello\nworld');
  assert.deepEqual(back.reply, { id: 42, from, kind: 'text', text: 'what was said' });
  assert.deepEqual(env.dmParseText('just words'), { text: 'just words', reply: null }, 'older plaintext reads as itself');
  assert.deepEqual(env.dmParseText('{"v":1,"text":"x"}'), { text: '{"v":1,"text":"x"}', reply: null },
    'JSON a member typed is their message, not an envelope');
  assert.equal(env.dmWrapText('plain', null), 'plain', 'no reply, no envelope');
  /* A malformed reply reference is dropped, never trusted. */
  assert.equal(env.dmReplyClean({ id: 0, from }), null);
  assert.equal(env.dmReplyClean({ id: 1, from: 'nope' }), null);
  assert.equal(env.dmReplyClean({ id: 1, from, kind: 'exe', text: 'x' }).kind, 'text', 'an unknown kind is text');
  assert.equal(env.dmReplyClean({ id: 1, from, text: 'y'.repeat(1000) }).text.length, 400, 'the quote is capped on arrival too');
  const torn = env.dmParseText('{not json');
  assert.deepEqual(torn, { text: '{not json', reply: null }, 'a torn envelope shows its text, never throws');
});

test('a reply rides inside the ciphertext, and the media envelope carries its own', () => {
  const view = src.slice(src.indexOf('function viewDm('), src.indexOf('\n  function ', src.indexOf('function viewDm(') + 10));
  assert.ok(/dmEncrypt\(dmWrapText\(body, replyAt\), otherPub\)/.test(view), 'the text send wraps the quote INSIDE the E2E plaintext');
  assert.ok(/if \(replyAt\) mm\.env\.reply = replyAt;/.test(view), 'a media reply rides in the (encrypted) media envelope');
  assert.ok(!/reply_to/.test(src), 'the server never learns what answers what');
  const edit = fn('dmStartEdit', 'dmMarkEdited');
  assert.ok(/dmEncrypt\(dmWrapText\(nv, m\.reply\), ctx\.otherPub\)/.test(edit), 'an edit keeps the quote it answered');
});

test('on a phone a hold picks a message, never a word: the screen is not selectable text, the surface never is, and opening drops any selection', () => {
  /* iOS starts its own selection under a long press and, when the bubble is
     not selectable, anchors it in the nearest selectable text (the presence
     line, a day chip, the spacer) — so the bubble rule alone was not enough. */
  assert.ok(/@media \(hover:none\)\{[^@]*\.dm-screen\{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none\}/.test(dmCss),
    'the whole chat screen is not selectable text under (hover:none)');
  assert.ok(/\.dm-screen textarea,\.dm-screen input\{-webkit-user-select:text;user-select:text\}/.test(dmCss), 'the fields stay selectable');
  assert.ok(/\.dm-act\{[^}]*-webkit-touch-callout:none;-webkit-user-select:none;user-select:none\}/.test(dmCss), 'the surface is never text, on any device');
  assert.ok(/section\.classList\.add\('dm-screen'\)/.test(src) &&
    /bootSig\.addEventListener\('abort', function \(\) \{ section\.classList\.remove\('dm-screen'\); \}, \{ once: true \}\)/.test(src),
    'the thread stamps the screen class on its section and takes it away with the boot');
  const open = fn('openActs', 'armHold');
  assert.ok(/if \(phone\) clearSelection\(\);/.test(open), 'the phone surface drops the selection the hold may have started');
  assert.ok(/function clearSelection\(\) \{\s*try \{ var s = window\.getSelection\(\); if \(s && s\.rangeCount\) s\.removeAllRanges\(\); \}/.test(src));
  assert.ok(/@media \(hover: none\) \{\s*\.mc-appbar, mc-tabbar, \.mc-tabbar \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/.test(mainCss),
    'the phone chrome (app bar, tab bar) is never text to select either — a stray selection cannot seed there');
});
