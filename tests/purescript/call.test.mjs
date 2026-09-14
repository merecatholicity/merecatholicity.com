/* Domain.Call — the 1v1 voice-call state machine: the total transition table
   both ends of a call run, the ring/setup timeouts, the glare tie-break, and
   the two hard safety rules (Ended is absorbing; Timeout is a NO-OP in Active
   so a stale ring timer can never kill a live call). The whole table is swept
   exhaustively against a verbatim JS oracle (the auth.test.mjs idiom). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Call from '../../purescript/output/Domain.Call/index.js';
import * as Maybe from '../../purescript/output/Data.Maybe/index.js';

const STATES = {
  Idle: Call.Idle.value,
  Outgoing: Call.Outgoing.value,
  Incoming: Call.Incoming.value,
  Connecting: Call.Connecting.value,
  Active: Call.Active.value,
};
const EVENTS = ['Place', 'Ring', 'Answer', 'RemoteAnswer', 'Connected', 'HangUp',
  'RemoteEnd', 'LocalDecline', 'RemoteDecline', 'RemoteBusy', 'Timeout', 'Failure', 'Taken',
  'IdleHangUp'];

const tagOf = (st) => [Call.stateTag(st), Call.endReason(st)].join('|');
const step = (evName, st) => tagOf(Call.step(Call[evName].value)(st));

/* The oracle: the transition table, verbatim from the module doc. Missing
   entry = stay put. Values are "Tag|reason". */
const TABLE = {
  Idle: { Place: 'Outgoing|', Ring: 'Incoming|' },
  Outgoing: {
    RemoteAnswer: 'Connecting|', RemoteDecline: 'Ended|declined', RemoteBusy: 'Ended|busy',
    HangUp: 'Ended|canceled', RemoteEnd: 'Ended|hangup', Timeout: 'Ended|noanswer', Failure: 'Ended|failed',
  },
  Incoming: {
    Answer: 'Connecting|', LocalDecline: 'Ended|declined', RemoteEnd: 'Ended|canceled',
    Timeout: 'Ended|missed', Taken: 'Ended|taken', Failure: 'Ended|failed',
  },
  Connecting: {
    Connected: 'Active|', HangUp: 'Ended|hangup', RemoteEnd: 'Ended|hangup',
    Timeout: 'Ended|failed', Failure: 'Ended|failed',
  },
  Active: { HangUp: 'Ended|hangup', RemoteEnd: 'Ended|hangup', Failure: 'Ended|failed',
    IdleHangUp: 'Ended|idle' },
};

test('step: the whole live-state table, exhaustively vs the oracle', () => {
  for (const [name, st] of Object.entries(STATES)) {
    for (const ev of EVENTS) {
      const expect = (TABLE[name] && TABLE[name][ev]) || (name + '|');
      assert.equal(step(ev, st), expect, `${name} × ${ev}`);
    }
  }
});

test('Ended is absorbing for EVERY event, keeping its reason', () => {
  for (const reason of ['hangup', 'declined', 'busy', 'missed', 'failed', 'weird']) {
    const ended = Call.Ended.create(reason);
    for (const ev of EVENTS) {
      assert.equal(step(ev, ended), 'Ended|' + reason, `Ended(${reason}) × ${ev}`);
    }
  }
});

test('Timeout in Active is a no-op — a stale ring timer cannot kill a live call', () => {
  assert.equal(step('Timeout', STATES.Active), 'Active|');
});

test('inCall: Outgoing/Incoming/Connecting/Active occupy the line; Idle/Ended do not', () => {
  const truth = { Idle: false, Outgoing: true, Incoming: true, Connecting: true, Active: true };
  for (const [name, st] of Object.entries(STATES)) assert.equal(Call.inCall(st), truth[name], name);
  assert.equal(Call.inCall(Call.Ended.create('hangup')), false, 'Ended');
});

test('timeouts: 45 s ring (a pushed callee needs the seconds to open and answer), 20 s setup watchdog', () => {
  assert.equal(Call.ringTimeoutSecs, 45);
  assert.equal(Call.setupTimeoutSecs, 20);
});

test('silence watch: 60 s default, clamp 15–600, voice floor under speech and over hum', () => {
  assert.equal(Call.idleDefaultSecs, 60);
  assert.equal(Call.idleClampSecs(60), 60);
  assert.equal(Call.idleClampSecs(1), 15, 'floor');
  assert.equal(Call.idleClampSecs(15), 15);
  assert.equal(Call.idleClampSecs(600), 600);
  assert.equal(Call.idleClampSecs(9999), 600, 'ceiling');
  /* audioLevel is 0..1: background hum reads well under the floor, speech an
     order of magnitude above it — both clients hang up only past the floor. */
  assert.ok(Call.voiceFloor > 0 && Call.voiceFloor < 0.05, 'floor sits between hum and speech');
});

test('glareWins: lower hash wins, antisymmetric, irreflexive', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  assert.equal(Call.glareWins(a)(b), true, 'lower wins');
  assert.equal(Call.glareWins(b)(a), false, 'antisymmetric');
  assert.equal(Call.glareWins(a)(a), false, 'irreflexive (self-call is refused upstream anyway)');
});

test('stateTag/endReason totality', () => {
  for (const [name, st] of Object.entries(STATES)) {
    assert.equal(Call.stateTag(st), name);
    assert.equal(Call.endReason(st), '');
  }
  assert.equal(Call.stateTag(Call.Ended.create('busy')), 'Ended');
  assert.equal(Call.endReason(Call.Ended.create('busy')), 'busy');
});

/* The call log (2026-09-13): the event line a call leaves in the
   conversation, as every chat app writes one — the grammar round-trips, each
   side reads its own sentence, a decline reads as "no answer" to the caller
   (the callee's private act), and the server's one outcome rule. */
const orNull = (m) => (m instanceof Maybe.Just ? m.value0 : null);

test('call lines: the grammar round-trips, and anything else is a message', () => {
  assert.equal(Call.missedCallLine, 'call:missed', 'the 2026-09-12 line, unchanged');
  assert.equal(Call.declinedCallLine, 'call:declined');
  assert.equal(Call.answeredCallLine(754), 'call:answered:754');
  assert.equal(Call.answeredCallLine(-5), 'call:answered:0', 'never negative');
  assert.equal(Call.answeredCallLine(10 ** 9), 'call:answered:86400', 'clamped to a day');
  for (const [s, tag, secs] of [['call:missed', 'missed', 0], ['call:declined', 'declined', 0], ['call:answered:754', 'answered', 754], ['call:answered:0', 'answered', 0]]) {
    const l = orNull(Call.parseCallLine(s));
    assert.ok(l, s + ' parses');
    assert.equal(Call.callLineTag(l), tag);
    assert.equal(Call.callLineSecs(l), secs);
  }
  for (const s of ['', 'hello', 'call:', 'call:missed2', 'call:answered:', 'call:answered:-3', 'call:answered:12x', 'sys:leave', 'E1.abc']) {
    assert.equal(orNull(Call.parseCallLine(s)), null, JSON.stringify(s) + ' is not a call line');
  }
});

test('call lines: each side reads its own sentence; a decline is "no answer" to the caller; a miss is tinted for the callee only', () => {
  const text = (mine, s) => Call.callLineText(mine)(orNull(Call.parseCallLine(s)));
  const missed = (mine, s) => Call.callLineMissedFor(mine)(orNull(Call.parseCallLine(s)));
  assert.equal(text(true, 'call:missed'), 'Voice call · No answer');
  assert.equal(text(false, 'call:missed'), 'Missed voice call');
  assert.equal(text(true, 'call:declined'), 'Voice call · No answer', 'the callee\'s decline is private');
  assert.equal(text(false, 'call:declined'), 'Declined voice call');
  assert.equal(text(true, 'call:answered:754'), 'Outgoing voice call · 12 min');
  assert.equal(text(false, 'call:answered:754'), 'Incoming voice call · 12 min');
  assert.equal(text(true, 'call:answered:0'), 'Outgoing voice call', 'no length when none was measured');
  assert.equal(missed(false, 'call:missed'), true);
  assert.equal(missed(false, 'call:declined'), true);
  assert.equal(missed(true, 'call:missed'), false, 'the caller\'s "no answer" is quiet');
  assert.equal(missed(true, 'call:answered:5'), false);
  assert.equal(missed(false, 'call:answered:5'), false);
});

test('durationLabel: seconds under a minute, minutes under an hour, then hours and minutes', () => {
  assert.equal(Call.durationLabel(0), '0 sec');
  assert.equal(Call.durationLabel(45), '45 sec');
  assert.equal(Call.durationLabel(60), '1 min');
  assert.equal(Call.durationLabel(754), '12 min');
  assert.equal(Call.durationLabel(3599), '59 min');
  assert.equal(Call.durationLabel(3600), '1 hr');
  assert.equal(Call.durationLabel(3900), '1 hr 5 min');
  assert.equal(Call.durationLabel(7200), '2 hr');
});

test('callOutcome: the server\'s one rule for what a report records', () => {
  assert.deepEqual(Call.endReasons, ['noanswer', 'canceled', 'busy', 'hangup', 'declined', 'failed']);
  const out = (caller, answered, reason) => orNull(Call.callOutcome({ caller, answered, reason }));
  // unanswered: only the CALLER's ring ending is a miss
  for (const r of ['noanswer', 'canceled', 'busy']) {
    assert.equal(out(true, false, r), 'missed', 'caller ' + r);
    assert.equal(out(false, false, r), null, 'a callee cannot ' + r);
  }
  assert.equal(out(true, false, 'declined'), 'declined', 'echoed by the caller');
  assert.equal(out(false, false, 'declined'), 'declined', 'the callee\'s press');
  assert.equal(out(true, false, 'failed'), 'failed', 'stamped, no line');
  assert.equal(out(false, false, 'hangup'), 'failed', 'a callee whose answer never landed: stamped, never a miss');
  // answered: any end is the answered line; a stale ring word records nothing
  assert.equal(out(true, true, 'hangup'), 'answered');
  assert.equal(out(false, true, 'hangup'), 'answered');
  assert.equal(out(false, true, 'failed'), 'answered', 'a connection that broke mid-call still happened');
  for (const r of ['noanswer', 'canceled', 'busy', 'declined']) assert.equal(out(true, true, r), null, 'after the answer, ' + r + ' is stale');
  assert.equal(out(true, false, 'bogus'), null);
});
