/* Domain.Call — the 1v1 voice-call state machine: the total transition table
   both ends of a call run, the ring/setup timeouts, the glare tie-break, and
   the two hard safety rules (Ended is absorbing; Timeout is a NO-OP in Active
   so a stale ring timer can never kill a live call). The whole table is swept
   exhaustively against a verbatim JS oracle (the auth.test.mjs idiom). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Call from '../../purescript/output/Domain.Call/index.js';

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

test('timeouts: 30 s ring, 20 s setup watchdog', () => {
  assert.equal(Call.ringTimeoutSecs, 30);
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
