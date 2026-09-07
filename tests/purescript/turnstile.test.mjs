/* Domain.Turnstile — when a member must solve a challenge.
 *
 * The rule exists because a challenge that cannot run is not a gate but an
 * outage: in the installed iOS app, mounting the Turnstile widget reliably
 * destroyed the document (a fresh load of the URL already on screen, with no
 * pagehide and no error). Six fixes moved when and where it ran; none stopped
 * it. So the gate moved to where it does its work — once, to establish that a
 * person is there — and the continuous work stays with the identity key, the
 * block gates, the rate limits and the AI screen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../purescript/output/Domain.Turnstile/index.js';

test('the polarity is generous, and only a literal 0 turns it off', () => {
  /* Same shape as Domain.Wall.enabledFrom, and load-bearing for the same
     reason: an absent row must read as the default. Reading this backwards
     would put every phone back in front of the challenge. */
  assert.equal(T.skipFrom('0'), false);
  assert.equal(T.skipFrom('1'), true);
  assert.equal(T.skipFrom(''), true, 'an absent setting is the default, not off');
  assert.equal(T.skipFrom('true'), true);
  assert.equal(T.skipFrom('nonsense'), true, 'garbage reads as the default');
  assert.equal(T.skipEstablishedDefault, true);
});

test('an established identity is spared; a new one is not', () => {
  const req = (established, skipEstablished) => T.required({ established, skipEstablished });
  assert.equal(req(true, true), false, 'already passed one: not asked again');
  assert.equal(req(false, true), true, 'brand new: must answer');
  assert.equal(req(true, false), true, 'admin demanded it of everyone');
  assert.equal(req(false, false), true);
});

test('the rule depends on nothing a client could claim about itself', () => {
  /* Two booleans, neither describing the device or the browser. There is no
     "I am the installed app" input, deliberately: the exemption is earned by
     having posted before, which only the server can know. */
  const both = [true, false];
  for (const established of both) {
    for (const skipEstablished of both) {
      assert.equal(T.required({ established, skipEstablished }),
        !(skipEstablished && established),
        `required is exactly not(skip and established) — ${established}/${skipEstablished}`);
    }
  }
});
