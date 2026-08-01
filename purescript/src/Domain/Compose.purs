-- | Pure decisions for the composer write path. The Turnstile token flow, the
-- | fetch POST, and the DOM stay in comments.js; the input logic lives here.
-- |
-- | `mentionsIn` is the send-time mention resolution (collectMentions): of the
-- | @-picks the reader chose from the autocomplete, keep the hashes whose token
-- | still literally stands in the body, deduped, in pick order. (The worker
-- | independently re-validates the supplied hashes — 64-hex, cap 10 — so this is
-- | the client's "what to send", not the trust boundary.)
module Domain.Compose (mentionsIn) where

import Prelude
import Data.Array (elem, foldl, snoc)
import Data.String (Pattern(..), contains)

mentionsIn :: String -> Array { token :: String, hash :: String } -> Array String
mentionsIn text picks = foldl step [] picks
  where
  step out p =
    if contains (Pattern p.token) text && not (elem p.hash out) then snoc out p.hash
    else out
