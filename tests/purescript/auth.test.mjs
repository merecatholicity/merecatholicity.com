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

test('the identity key\'s shape (P2-9): the minted 43-char base64url key is generated, a long mixed pasted key strong, a short one weak — and the client only ever warns', () => {
  const tag = (k) => Auth.keyStrengthTag(Auth.keyStrength(k));
  assert.equal(tag('mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0k'), 'generated', '32 random bytes as 43 base64url chars');
  assert.equal(tag('mQ3v-Zt8_kL0pR2sT4uV6wX8yZ1aB3cD5eF7gH9iJ0'), 'strong', '42 chars: not the minted shape, but long and mixed');
  assert.equal(tag('correct horse battery staple 2026!'), 'strong', 'twenty or more, three classes');
  assert.equal(tag('correcthorsebatterystaple'), 'weak', 'one class, however long');
  assert.equal(tag('Password1'), 'weak', 'too short');
  assert.equal(tag(''), 'weak');
  assert.equal(tag('a'.repeat(43)), 'weak', 'the minted length alone is nothing');
});
