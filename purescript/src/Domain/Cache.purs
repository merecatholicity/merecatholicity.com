-- | What the client may keep on disk, and for how long.
-- |
-- | The store (`app/store.ts`) has always memoised reads for the life of a tab.
-- | Persisting them changes two things that are not caching questions at all,
-- | which is why the rules live here rather than in the imperative layer:
-- |
-- |   1. PRIVACY. Direct messages are end-to-end encrypted precisely so the
-- |      operator holds only ciphertext. Writing decrypted threads to
-- |      localStorage would put plaintext on the device for any later script or
-- |      any other person holding the phone — undoing the guarantee at the one
-- |      point where it is easy to undo. `persistable` refuses every DM read by
-- |      construction, so no future call site can opt one in by accident.
-- |
-- |   2. HONESTY ABOUT AGE. Painting last visit's content instantly is only
-- |      kind while "last visit" was recent. Past `staleMaxMs` a placeholder is
-- |      the truthful thing to show, because week-old rows presented as current
-- |      are worse than a moment's wait.
-- |
-- | The freshness ladder has three rungs, not two: FRESH (serve, ask nothing),
-- | STALE (serve AND revalidate — the whole point of the feature), and EXPIRED
-- | (do not serve). `classify` is that decision as one total function.
module Domain.Cache
  ( Freshness(..)
  , classify
  , freshnessTag
  , persistable
  , staleMaxMs
  , maxBytes
  , schema
  ) where

import Prelude
import Data.Foldable (any)
import Data.String (Pattern(..), contains)

-- | How a stored entry stands relative to now.
data Freshness
  = Fresh      -- ^ inside its own TTL: serve it, ask nothing
  | Stale      -- ^ past TTL but worth showing: serve it AND refresh behind it
  | Expired    -- ^ too old to stand in for the truth: show a placeholder

derive instance eqFreshness :: Eq Freshness

-- | How long a stored answer may still be shown while it refreshes. A day: long
-- | enough that a reader returning tomorrow gets an instant page, short enough
-- | that nothing on screen is ever mysteriously ancient.
staleMaxMs :: Number
staleMaxMs = 86400000.0

-- | `age` and `ttl` in milliseconds. A negative age (a clock moved backwards
-- | between visits — it happens) reads as Fresh rather than as Expired: the
-- | entry is not evidence of anything wrong, and refusing to show it would
-- | punish the reader for their clock.
classify :: Number -> Number -> Freshness
classify age ttl
  | age < ttl = Fresh
  | age < staleMaxMs = Stale
  | otherwise = Expired

-- | The membrane wants a string, not an ADT (see app/core.ts).
freshnessTag :: Freshness -> String
freshnessTag Fresh = "fresh"
freshnessTag Stale = "stale"
freshnessTag Expired = "expired"

-- | May this read be written to disk?
-- |
-- | Public, re-fetchable content only. The DM refusal is the load-bearing line
-- | and it is a REFUSAL BY PREFIX, not an allowlist omission: every `/dm/`
-- | route — thread, threads, directory, pubkey, media — is excluded together, so
-- | a DM endpoint added tomorrow is excluded the day it is written rather than
-- | the day someone remembers.
-- |
-- | `key` is the store's own cache key, which begins with the request URL.
persistable :: String -> Boolean
persistable key = not (any (\p -> contains (Pattern p) key) forbidden)
  where
  forbidden =
    [ "/dm/"          -- end-to-end encrypted; plaintext must never reach disk
    , "/merecat/"     -- private conversations with the librarian
    , "/admin"        -- moderation surfaces: never cached on a shared device
    , "/meta"         -- the admin identity drawer (IP history)
    , "/rdns"         -- reverse DNS of a member's addresses
    ]

-- | A ceiling for the whole persisted store. Generous enough for the pages a
-- | reader actually revisits, small enough that it can never crowd a device's
-- | storage or slow the synchronous read that hydrates it at boot.
maxBytes :: Int
maxBytes = 524288

-- | Bumped whenever the stored shape changes, so a deploy discards what it can
-- | no longer read instead of trying to interpret it.
schema :: Int
schema = 1
