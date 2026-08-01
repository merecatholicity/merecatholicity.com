-- | Moderation-block outcomes: the closed set of reason codes a keyed call can
-- | return (`blocked: 'locked' | 'ipban' | 'banned'` from the worker's
-- | blockedReason). `Blocked` makes the set explicit; `messageFor` is the single
-- | source of the two flash-banner strings the classic blockedOut selected inline
-- | (only an IP ban gets the network-banned wording; a locked/banned identity —
-- | and any unrecognized non-empty code, matching the classic else branch — gets
-- | the identity-locked wording). The logout/redirect effects stay in comments.js.
module Domain.Blocked (Blocked(..), parse, message, messageFor) where

import Prelude
import Data.Maybe (Maybe(..))

data Blocked = Locked | IpBan | Banned

parse :: String -> Maybe Blocked
parse s = case s of
  "locked" -> Just Locked
  "ipban" -> Just IpBan
  "banned" -> Just Banned
  _ -> Nothing

message :: Blocked -> String
message b = case b of
  IpBan -> "Your network is banned from merecatholicity.com for violating the terms and conditions."
  _ -> "This identity has been locked by the moderators for violating the terms and conditions."

-- | The flash message for a raw reason code — the exact classic mapping, where
-- | any non-"ipban" (including an unknown code) falls to the identity-locked line.
messageFor :: String -> String
messageFor s = case parse s of
  Just b -> message b
  Nothing -> message Locked
