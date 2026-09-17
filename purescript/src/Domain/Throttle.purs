-- | Whose request is it, for the rate limiter (2026-09-17). Every limit used
-- | to key on the address, so a parish on one Wi-Fi — or phones behind one
-- | carrier address — shared a single bucket. A request that names an
-- | identity now counts against that member's own bucket, and every request
-- | also counts against a far larger per-address backstop (the worker's
-- | `*_IP_LIMIT` bindings), because a key is only claimed at this point, not
-- | proven: rotating keys escapes a member bucket, never the backstop.
module Domain.Throttle
  ( emptyKeyHash
  , memberBucket
  ) where

import Prelude

import Data.Array as A
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits (toCharArray)

-- | sha256 of the empty string: what an absent key hashes to. It names nobody.
emptyKeyHash :: String
emptyKeyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

-- | The member bucket for an identity hash, or Nothing when the request is
-- | keyless (no hash, a malformed one, or the empty key's).
memberBucket :: String -> Maybe String
memberBucket h =
  let cs = toCharArray h
  in if A.length cs == 64 && A.all hex cs && h /= emptyKeyHash then Just ("m:" <> h) else Nothing
  where
  hex c = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')
