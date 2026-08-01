-- | The reader's authentication state, as one typed classification over the raw
-- | identity signals — replacing the loosely-coupled mutable `state.key` /
-- | `state.myHash` / `state.myAdmin` / `state.profileLoaded` soup in comments.js.
-- |
-- | `AuthState` makes the illegal combinations unrepresentable: no hash without a
-- | key (Authenticating is the only key-without-hash state), and no confirmed
-- | Admin before the profile loads (a pre-load admin is only ever the built-in
-- | HINT, folded into Admin here exactly as the classic isAdmin did). The capstone
-- | slice promotes `state` to carry one `AuthState`; this slice single-sources the
-- | two decisions with real logic — `isAdmin` and the admin-page `gate`.
module Domain.Auth
  ( AuthState(..)
  , Signals
  , classify
  , isAdmin
  , isMember
  , gate
  , stateTag
  ) where

import Prelude

-- | The raw signals the classic code read off `state` (+ the built-in-admin hint
-- | = `ADMIN_HASHES.indexOf(myHash) !== -1`, which stays a client-only pre-load
-- | hint). The barrel coerces each to Boolean at the membrane.
type Signals =
  { hasKey :: Boolean
  , hasHash :: Boolean
  , profileLoaded :: Boolean
  , myAdmin :: Boolean
  , hint :: Boolean
  }

data AuthState
  = Anonymous       -- no key
  | Authenticating  -- key present, hash not yet derived (transient)
  | Pending         -- key + hash, profile not loaded (admin status still the hint)
  | Member          -- resting, profile loaded, not an admin
  | Admin           -- an admin (server-confirmed, or the hint before profile load)

-- | Admin authority: none without a key; the server (myAdmin) once the profile is
-- | loaded; server-or-hint before that. Byte-for-byte the classic isAdmin (581).
isAdmin :: Signals -> Boolean
isAdmin s =
  if not s.hasKey then false
  else if s.profileLoaded then s.myAdmin
  else s.myAdmin || s.hint

-- | A resolved, logged-in member (the `state.key && state.myHash` check).
isMember :: Signals -> Boolean
isMember s = s.hasKey && s.hasHash

classify :: Signals -> AuthState
classify s =
  if not s.hasKey then Anonymous
  else if not s.hasHash then Authenticating
  else if isAdmin s then Admin
  else if s.profileLoaded then Member
  else Pending

-- | The admin-only-view guard (adminGate, 596): "pass" renders the view, "deny"
-- | shows "This page is for the admins.", "wait" shows a neutral loading state
-- | until the profile lands (so a known admin never flashes a false refusal).
gate :: Signals -> String
gate s =
  if isAdmin s then "pass"
  else if (not s.hasKey) || s.profileLoaded then "deny"
  else "wait"

stateTag :: AuthState -> String
stateTag st = case st of
  Anonymous -> "Anonymous"
  Authenticating -> "Authenticating"
  Pending -> "Pending"
  Member -> "Member"
  Admin -> "Admin"
