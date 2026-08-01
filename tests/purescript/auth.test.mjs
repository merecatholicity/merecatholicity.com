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
