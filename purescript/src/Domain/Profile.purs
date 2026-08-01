-- | Profile field limits + validators — the single typed source of the caps on
-- | a member's nick / bio / signature. Today the client profile editors read
-- | `limits` (retiring the drift where the admin editor capped bio at 1000 while
-- | the worker rejects anything over 500); in Phase 6 the worker's MAX_NICK /
-- | MAX_BIO / MAX_SIG read the same source, closing the duplication for good.
-- |
-- | The `Nick`/`Bio`/`Sig` newtypes can only be built through their smart
-- | constructors, so an over-length value is unrepresentable. (They are compiled
-- | but tree-shaken out of the client bundle until a consumer needs them — the
-- | Layer-1 tests exercise them directly.)
module Domain.Profile
  ( limits
  , Nick, Bio, Sig
  , ProfileError(..)
  , mkNick, mkBio, mkSig
  ) where

import Prelude
import Data.Either (Either(..))
import Data.String (length)

-- | The ONE source of the caps. Matches the worker's MAX_NICK/BIO/SIG (index.js).
limits :: { nick :: Int, bio :: Int, sig :: Int }
limits = { nick: 40, bio: 500, sig: 200 }

data ProfileError = TooLong Int Int -- actual length, the limit

newtype Nick = Nick String
newtype Bio = Bio String
newtype Sig = Sig String

mkBounded :: forall a. (String -> a) -> Int -> String -> Either ProfileError a
mkBounded wrap cap s =
  let n = length s
  in if n > cap then Left (TooLong n cap) else Right (wrap s)

mkNick :: String -> Either ProfileError Nick
mkNick = mkBounded Nick limits.nick

mkBio :: String -> Either ProfileError Bio
mkBio = mkBounded Bio limits.bio

mkSig :: String -> Either ProfileError Sig
mkSig = mkBounded Sig limits.sig
