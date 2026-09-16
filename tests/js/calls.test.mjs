/* The answerable ring, the recorded miss, and the buzz (2026-09-12).
 *
 * What would break silently: the engine no longer asking for the stored
 * offer when the push opens the app (the ring's push would wake a callee to
 * nothing); the caller not re-sending its ICE candidates on a late answer (a
 * call answered from the push would connect to silence); the caller's
 * no-answer no longer reported (no line, no bell, no missed-call push until
 * the hour's sweep); a decline recorded as a miss; the ring's buzz not
 * stopped by a teardown; the service worker's ring notification losing its
 * tag (the miss would pile on the ring) or its Answer action; the thread
 * drawing the system word as a bubble with a surface; a haptic road that is
 * not the shell's one engine. Every check reads the sources. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientModule, clientDm } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const call = readFileSync(join(root, 'app', 'call.ts'), 'utf8');
const sw = readFileSync(join(root, 'docs', 'sw.js'), 'utf8');
const haptic = readFileSync(join(root, 'app', 'haptic.ts'), 'utf8');
const shell = readFileSync(join(root, 'app', 'shell.ts'), 'utf8');
const ptr = readFileSync(join(root, 'app', 'ptr.ts'), 'utf8');
const dm = clientDm();
const surface = clientModule('surface');
const fn = (src, name, next) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = next ? src.indexOf(`function ${next}(`, i + 10) : src.indexOf('\n  function ', i + 10);
  return src.slice(i, j > i ? j : i + 6000);
};

test('the push wakes an answerable ring: the stored offer is fetched and rung, marked late; taken elsewhere says so', () => {
  const wake = fn(call, 'wake');
  assert.ok(/const call = String\(q\.get\('call'\) \|\| ''\);/.test(wake) && /post\('\/call\/pending', \{ key: myKey, call \}\)/.test(wake));
  assert.ok(/if \(d\.pending && d\.from && d\.sdp\) \{ onOffer\(\{ from: d\.from, call, sdp: d\.sdp, late: true \}\); return; \}/.test(wake), 'the stored offer rings the same panel a live one does');
  assert.ok(/if \(d\.answered && CALL\.state === 'Idle'\)/.test(wake) && /CALL\.reason = 'taken'/.test(wake), 'answered on another device meanwhile: the word');
  assert.ok(/if \(myKey\) wake\(\); else setTimeout\(\(\) => \{ ensureMember\(\); wake\(\); \}, 300\);/.test(call), 'asked once the key is read');
  assert.ok(/late: CALL\.late \? 1 : 0/.test(fn(call, 'answer', 'onOffer')), 'the answer says it came from the store');
});

test('a late answer re-sends every candidate the caller gathered; the ring buzzes and every teardown stops it', () => {
  assert.ok(/CALL\.iceAll\.push\(c\);/.test(fn(call, 'makePc', 'startIdleWatch')), 'every candidate is kept');
  const ans = fn(call, 'onAnswer', 'onSig');
  assert.ok(/if \(m\.late\) \{ CALL\.iceOut = CALL\.iceAll\.slice\(\); flushIce\(\); \}/.test(ans), 'the callee the push woke never saw them');
  assert.ok(/if \(window\.mcHaptic\) window\.mcHaptic\.ringStart\(\);/.test(fn(call, 'onOffer', 'onAnswer')), 'the phone buzzes like one');
  assert.ok(/if \(window\.mcHaptic\) window\.mcHaptic\.ringStop\(\);/.test(fn(call, 'cleanup', 'report')), 'stopped by the one teardown every exit takes');
});

test('the outcome is reported: the caller\'s no-answer, cancel or busy is the miss, a decline a decline, a hangup after the answer a hangup, a broken setup a failure', () => {
  const end = fn(call, 'end', 'makePc');
  assert.ok(/if \(CALL\.dir === 'out' && was === 'Outgoing'\) report\(ev === 'Timeout' \? 'noanswer' : ev === 'HangUp' \? 'canceled' : ev === 'RemoteDecline' \? 'declined' : ev === 'RemoteBusy' \? 'busy' : 'failed'\);/.test(end));
  assert.ok(/else if \(ev === 'LocalDecline'\) report\('declined'\);/.test(end) && /else if \(sendEnd && was === 'Active'\) report\('hangup'\);/.test(end));
  assert.ok(/else if \(sendEnd && was === 'Connecting'\) report\(ev === 'HangUp' \? 'hangup' : 'failed'\);/.test(end), 'the setup watchdog is not a call that happened');
  assert.ok(/post\('\/call\/end', \{ key: myKey, call: CALL\.id, to: CALL\.peer, reason \}\)/.test(fn(call, 'report', 'end')));
});

test('the service worker rings: the call notification stands, buzzes, offers Answer, and is replaced by the miss through its tag', () => {
  assert.ok(/renotify: !!d\.tag,/.test(sw), 'a replacement is heard again');
  assert.ok(/if \(d\.kind === 'call'\) \{\s*opts\.requireInteraction = true;\s*opts\.vibrate = \[300, 150, 300, 150, 300\];\s*opts\.actions = \[\{ action: 'answer', title: 'Answer' \}\];/.test(sw));
  assert.ok(/else if \(d\.kind === 'call-missed'\) \{\s*opts\.vibrate = \[200\];/.test(sw));
  assert.ok(/if \(event\.action === 'answer'\) url \+= \(url\.indexOf\('\?'\) === -1 \? '\?' : '&'\) \+ 'answer=1';/.test(sw), 'Answer opens the same deep link, marked');
});

test('the thread draws every call line by side through the membrane, muted, never a bubble', () => {
  assert.ok(/else if \(e === 2 && window\.mcCore && window\.mcCore\.callLine && window\.mcCore\.callLine\(String\(m\.body \|\| ''\)\)\) \{[\s\S]*?return dmCallLine\(m\);/.test(dm), 'the grammar is Domain.Call\'s, before the bubble road — no surface, no pill');
  const render = fn(dm, 'dmRenderMsg', 'dmCallLine');
  assert.ok(render.indexOf('window.mcCore.callLine(') < render.indexOf('window.mcCore.dmSysLine('), 'the call grammar is asked before the sys-line grammar (which once said "Missed voice call" to the caller, 2026-09-14)');
  const line = fn(dm, 'dmCallLine');
  assert.ok(/core\.callLineText\(body, mine\)/.test(line) && /core\.callLineMissed\(body, mine\) \? ' dm-call-missed' : ''/.test(line), 'the sentence and the tint are the kernel\'s, by side');
  assert.ok(!/'Missed voice call'|'No answer'/.test(line), 'no sentence inlined in the client');
  assert.ok(/'\.dm-call-line\{display:flex;width:fit-content/.test(dm), 'centred by its own width');
  const app = dm.slice(dm.indexOf('append: function (msg: any) {'), dm.indexOf('editMsg: function (msg: any) {'));
  assert.ok(/if \(String\(msg\.sender_hash\) === state\.myHash\) \{[\s\S]*?if \(Number\(msg\.enc \|\| 0\) !== 2\) return;[\s\S]*?placeMsg\(msg\);[\s\S]*?return;\s*\}/.test(app),
    'my own system line (my call\'s outcome) lands live where my echoed words are dropped; no seen ping, no unread count');
  assert.ok(!/dmSeenPing/.test(app.slice(0, app.indexOf('setTypist'))), 'never "seen" for my own line');
  assert.ok(/'\.dm-call-line \.dm-call-text\{color:var\(--faint\)\}'/.test(dm) && /'\.dm-call-line\.dm-call-missed \.dm-call-text\{color:var\(--maroon,#8b1a1a\)\}'/.test(dm), 'muted; a miss for this reader tinted');
});

test('one haptic engine, the shell\'s: installed first, used by the surface, the pull, the ring', () => {
  assert.ok(/export function haptic\(kind: string\): boolean/.test(haptic) && /tap: 6, pick: 6, arm: 8, hold: 12, ring: \[300, 150, 300\]/.test(haptic), 'the patterns, small');
  assert.ok(!/switch/.test(haptic.replace(/\/\*[\s\S]*?\*\//g, '')) && /if \(!canVibrate\(\)\) return false;/.test(haptic), 'the Vibration API alone — iOS has none, and the switch hack never fired for a programmatic toggle');
  assert.ok(/if \(ua && !ua\.hasBeenActive\) return false;/.test(haptic), 'never before the first real tap');
  assert.ok(/if \(!buzzed\) return;\s*buzzed = false;\s*try \{ if \(canVibrate\(\)\) navigator\.vibrate\(0\); \}/.test(haptic), 'nor the ring\'s cancel — Chrome logs an intervention for a vibrate(0) too');
  const at = shell.indexOf('installHaptic();'), live = shell.indexOf('installLive();');
  assert.ok(at > 0 && live > at, 'installed before anything that buzzes');
  assert.ok(/mcHaptic\.haptic\('arm'\)/.test(ptr), 'the pull crossing the line');
  const buzz = fn(surface, 'buzz', 'openActs');
  assert.ok(/if \(h && h\.haptic\) \{ h\.haptic\(kind\); return; \}/.test(buzz), 'the surface buzzes through the engine when it stands');
  assert.ok(/buzz\('hold'\);/.test(surface) && (surface.match(/buzz\('pick'\)/g) || []).length === 3 && /if \(arm && !node\.classList\.contains\('dm-swipe-armed'\)\) buzz\('arm'\);/.test(surface),
    'a hold, a pick (the bar, the picker, a chip), the swipe crossing the line — and no buzz at the swipe\'s release');
});
