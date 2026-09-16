/* Forwarding (2026-09-13): a word goes to other conversations as a new word
 * of mine, sealed afresh for each one's members — the text, or the media
 * envelope with the SAME object (nothing uploaded again) — the quote it
 * answered dropped, and a small "Forwarded" mark inside the envelope, so the
 * server never learns a word was forwarded, nor from where.
 *
 * What would break silently: the mark riding the wire in the clear (or a
 * `reply_to` / `forward_of` column appearing); a forward carrying the quote
 * of a conversation its readers never saw; an attachment re-uploaded (a
 * second object where one should be shared); a forward that drifted from the
 * send's sealing; the act offered on a system line or an expired attachment. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientModule, clientAll, clientDm } from '../_support/client.mjs';

const src = clientDm();
const fn = (name, next) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = next ? src.indexOf(`function ${next}(`, i + 10) : src.indexOf('\n  function ', i + 10);
  return src.slice(i, j > i ? j : i + 8000);
};
/* The envelope functions and the forward's own, run out of the client. */
const names = ['dmReplySentinel', 'dmWrapText', 'dmReplyClean', 'dmParseText', 'dmForwardPlain'];
const body = names.map((n) => fn(n)).join('\n').replace(/\?: any\b/g, '').replace(/: any\b/g, '');
const SENTINEL = String.fromCharCode(1);
const env = new Function('window', body + '\nreturn { dmWrapText, dmParseText, dmForwardPlain };')({ mcCore: { dmReplySentinel: SENTINEL } });
const from = 'b'.repeat(64);

test('the mark rides inside the envelope: set on a forward, read back, absent from an ordinary word', () => {
  const w = env.dmWrapText('a word worth passing on', null, true);
  assert.equal(w.charAt(0), SENTINEL, 'an envelope, though there is no quote');
  assert.deepEqual(env.dmParseText(w), { text: 'a word worth passing on', reply: null, fwd: true });
  const both = env.dmParseText(env.dmWrapText('x', { id: 4, from, kind: 'text', text: 'q' }, true));
  assert.equal(both.fwd, true); assert.equal(both.reply.id, 4);
  assert.equal(env.dmWrapText('plain', null), 'plain', 'no reply, no mark: no envelope');
  assert.deepEqual(env.dmParseText(env.dmWrapText('hi', { id: 1, from, kind: 'text', text: 't' })), { text: 'hi', reply: { id: 1, from, kind: 'text', text: 't' } }, 'a reply without the mark carries none');
});

test('the copy carries the words or the media envelope with the SAME object, never the quote, always the mark', () => {
  const text = env.dmForwardPlain({ body: 'hello there', reply: { id: 9, from, kind: 'text', text: 'was' } });
  assert.equal(text.media_key, null);
  assert.deepEqual(env.dmParseText(text.plain), { text: 'hello there', reply: null, fwd: true }, 'the quote is dropped, the mark set');
  const media = env.dmForwardPlain({ media_key: 'dm/' + '1'.repeat(64), _env: { k: 'k', iv: 'iv', name: 'p.png', mime: 'image/png', size: 10, caption: 'look', reply: { id: 9, from, kind: 'text', text: 'was' } } });
  assert.equal(media.media_key, 'dm/' + '1'.repeat(64), 'the same object — nothing uploaded again');
  assert.deepEqual(JSON.parse(media.plain), { k: 'k', iv: 'iv', name: 'p.png', mime: 'image/png', size: 10, caption: 'look', fwd: 1 }, 'the file key, the caption, the mark; no quote');
});

test("the act, the picker, the batch: Forward on any word but a system line or an expired attachment; sealed for each target's roster; one /dm/forward", () => {
  const acts = fn('dmOpenActions');
  assert.ok(/if \(!sys && !m\.media_expired\) items\.push\(\{ label: 'Forward', icon: '↪', fn: function \(\) \{ dmForwardPicker\(m, ctx\); \} \}\);/.test(acts), 'the act, after Reply');
  assert.ok(/if \(!m \|\| !m\.id \|\| m\.redacted \|\| node\.mcDead \|\| !node\.isConnected\) \{ closeActs\(\); return; \}/.test(acts), 'a redacted bubble opens nothing');
  const fwd = fn('dmForwardTo');
  assert.ok(/API \+ '\/dm\/roster'/.test(fwd) && /var sealed = dmSealFor\(src\.plain, d\.members\);/.test(fwd), "each target's current members, read without a mark, sealed to as a send would");
  assert.ok(/if \(d\.members\.some\(function \(mm: any\) \{ return !mm\.pubkey; \}\)\) return null;/.test(fwd), 'a member without a key: nothing is sealed to them');
  assert.ok(/if \(src\.media_key\) item\.media_key = src\.media_key;/.test(fwd), 'the same object named again');
  assert.ok(/API \+ '\/dm\/forward'/.test(fwd) && /items: live/.test(fwd), 'one batch');
  const picker = fn('dmForwardPicker');
  assert.ok(/window\.mcSheet\.open\('Forward to…', box\)/.test(picker), 'a sheet in the shell');
  assert.ok(/if \(ctx && ctx\.threadId && Number\(t\.thread_id \|\| t\.id\) === ctx\.threadId\) return;/.test(picker), 'never back into this conversation');
  const bubble = fn('dmBubble');
  assert.ok(/if \(m\.fwd\) node\.appendChild\(el\('div', 'dm-fwd', '↪ ' \+ \(\(window\.mcCore && window\.mcCore\.dmForwardedLabel\) \|\| 'Forwarded'\)\)\);/.test(bubble), "the small line, the kernel's word");
  assert.ok(/'\.dm-fwd'\]\.forEach/.test(fn('dmMakeRedacted')), 'a redact strips the mark');
  const all = clientAll();
  assert.ok(!/reply_to|forward_of|forwarded_from/.test(all), 'the server never learns what answers what, nor what was forwarded from where');
});
