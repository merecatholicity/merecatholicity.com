/* Domain.Auth — the reader's identity/admin state as one typed decision, the
   single source for isAdmin() and the admin-page gate. Admin authority is the
   server's once the profile loads, else the server value OR the pre-load hint;
   the gate answers pass/deny/wait so an admin page shows a neutral wait rather
   than a false "not for you" while status is still loading. We sweep all 32
   signal combinations against the classic branch logic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Auth from '../../purescript/output/Domain.Auth/index.js';

// The classic isAdmin/gate branches, verbatim, as the oracle.
function cAdmin(hasKey, profileLoaded, myAdmin, hint) {
  if (!hasKey) return false;
  if (profileLoaded) return myAdmin;
  return myAdmin || hint;
}
function cGate(hasKey, profileLoaded, myAdmin, hint) {
  if (cAdmin(hasKey, profileLoaded, myAdmin, hint)) return 'pass';
  if (!hasKey || profileLoaded) return 'deny';
  return 'wait';
}

test('isAdmin / isMember / gate agree with the classic logic over all 32 combos', () => {
  let combos = 0;
  for (const hasKey of [false, true]) for (const hasHash of [false, true]) for (const profileLoaded of [false, true])
    for (const myAdmin of [false, true]) for (const hint of [false, true]) {
      combos++;
      const sig = { hasKey, hasHash, profileLoaded, myAdmin, hint };
      const j = JSON.stringify(sig);
      assert.equal(Auth.isAdmin(sig), cAdmin(hasKey, profileLoaded, myAdmin, hint), 'isAdmin ' + j);
      assert.equal(Auth.isMember(sig), !!(hasKey && hasHash), 'isMember ' + j);
      assert.equal(Auth.gate(sig), cGate(hasKey, profileLoaded, myAdmin, hint), 'gate ' + j);
    }
  assert.equal(combos, 32);
});

test('classify names the identity state (Anonymous -> Authenticating -> Pending -> Member -> Admin)', () => {
  const tag = (s) => Auth.stateTag(Auth.classify(s));
  const base = { hasKey: false, hasHash: false, profileLoaded: false, myAdmin: false, hint: false };
  assert.equal(tag(base), 'Anonymous');
  assert.equal(tag({ ...base, hasKey: true }), 'Authenticating');
  assert.equal(tag({ ...base, hasKey: true, hasHash: true }), 'Pending');
  assert.equal(tag({ ...base, hasKey: true, hasHash: true, profileLoaded: true }), 'Member');
  assert.equal(tag({ ...base, hasKey: true, hasHash: true, profileLoaded: true, myAdmin: true }), 'Admin');
  assert.equal(tag({ ...base, hasKey: true, hasHash: true, hint: true }), 'Admin', 'hint before load = Admin');
});

test('the identity key\'s shape (P2-9): the minted 43-char base64url key is generated, a long mixed pasted key strong, a short one weak', () => {
  const tag = (k) => Auth.keyStrengthTag(Auth.keyStrength(k));
  assert.equal(tag('mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0k'), 'generated', '32 random bytes as 43 base64url chars');
  assert.equal(tag('mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0'), 'strong', '42 chars: not the minted shape, but long and mixed');
  assert.equal(tag('correct horse battery staple 2026!'), 'strong', 'twenty or more, three classes');
  assert.equal(tag('correcthorsebatterystaple'), 'weak', 'one class, however long');
  assert.equal(tag('Password1'), 'weak', 'too short');
  assert.equal(tag(''), 'weak');
  assert.equal(tag('a'.repeat(43)), 'weak', 'the minted length alone is nothing');
});

/* The floor the 2026-09-17 review's P0 put under the key (layer two, 2026-09-18).
   Three functions and the difference between them is the whole design: the
   server REFUSES a weak key on a write, the client ASKS about one at sign-in,
   and both read the same predicate so the floor is stated once. What would
   break silently: a refusal wired into the sign-in road, which would lock an
   existing weak-key member out of their own history on a new device (there is
   no rotation road until layer three) — so the warning must stay a question. */
test('keyAcceptable is the one floor: anything but weak, and a generated key passes by construction', () => {
  assert.equal(Auth.keyAcceptable('mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0k'), true, 'generated');
  assert.equal(Auth.keyAcceptable('correct horse battery staple 2026!'), true, 'strong');
  assert.equal(Auth.keyAcceptable('Password1'), false);
  assert.equal(Auth.keyAcceptable('correcthorsebatterystaple'), false, 'one class, however long');
  assert.equal(Auth.keyAcceptable(''), false);
  /* the predicate and the tag can never disagree */
  for (const k of ['mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0k', 'correct horse battery staple 2026!', 'Password1', '', 'a'.repeat(43)]) {
    assert.equal(Auth.keyAcceptable(k), Auth.keyStrengthTag(Auth.keyStrength(k)) !== 'weak', JSON.stringify(k));
  }
});

test('a write from a weak key is refused in words that say what to do, and a fresh identity is told something different from one with history', () => {
  const fresh = Auth.keyRefusal(true), known = Auth.keyRefusal(false);
  assert.equal(fresh('mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0k'), '', 'a good key is never refused');
  assert.equal(known('correct horse battery staple 2026!'), '', 'nor a strong one');
  assert.match(fresh('Password1'), /Create an identity/, 'a new identity is sent to the generated key');
  assert.match(known('Password1'), /Create a new identity/, 'an existing one is told posting has stopped');
  assert.notEqual(fresh('Password1'), known('Password1'), 'the two cases do not read alike');
  for (const m of [fresh('Password1'), known('Password1')]) assert.ok(m.length > 40 && /guess/.test(m), 'it says why: ' + m);
});

test('the sign-in ASKS and never refuses: a weak key gets a question, a good one gets nothing at all', () => {
  assert.equal(Auth.keyWarning('mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0k'), '', 'silence for a generated key');
  assert.equal(Auth.keyWarning('correct horse battery staple 2026!'), '', 'and for a strong one');
  const w = Auth.keyWarning('Password1');
  assert.match(w, /\?$/, 'a QUESTION — refusing here would lock a weak-key member out of their own account');
  assert.match(w, /anyone who guesses it is you/, 'and it says what is actually at stake');
});
