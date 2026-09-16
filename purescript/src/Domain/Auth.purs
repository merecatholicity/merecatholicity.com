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
  , KeyStrength(..)
  , keyStrength
  , keyStrengthTag
  ) where

import Prelude

import Data.Array as A
import Data.String as S
import Data.String.CodeUnits (toCharArray)

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

-- | The identity key's shape (P2-9, 2026-09-16). The key IS the account: a
-- | guessable one is an account anyone can be. `makeKey` mints 32 random bytes
-- | as 43 base64url characters — `Generated`; a pasted key of twenty or more
-- | characters drawing on three character classes is `Strong`; anything else
-- | that the sign-in still accepts (sixteen characters or more) is `Weak`, and
-- | the client says so — a warning, never a refusal: custom keys exist and a
-- | refusal would lock their holders out.
data KeyStrength = Generated | Strong | Weak

derive instance eqKeyStrength :: Eq KeyStrength

keyStrength :: String -> KeyStrength
keyStrength k =
  let
    chars = toCharArray k
    n = A.length chars
    lower = A.any (\c -> c >= 'a' && c <= 'z') chars
    upper = A.any (\c -> c >= 'A' && c <= 'Z') chars
    digit = A.any (\c -> c >= '0' && c <= '9') chars
    other = A.any (\c -> not ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) chars
    classes = A.length (A.filter identity [ lower, upper, digit, other ])
    b64url = A.all (\c -> (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') chars
  in
    if n == 43 && b64url && classes >= 3 then Generated
    else if n >= 20 && classes >= 3 then Strong
    else Weak

keyStrengthTag :: KeyStrength -> String
keyStrengthTag Generated = "generated"
keyStrengthTag Strong = "strong"
keyStrengthTag Weak = "weak"
