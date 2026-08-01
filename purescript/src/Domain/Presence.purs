-- | Online-presence policy for direct messages. A member's presence mode is one
-- | of "auto" (report online while a live socket is held) or "off" (appear
-- | offline — never reported online, whatever their sockets). The mode lives on
-- | the profile (`profiles.presence_mode`) and rides each WebSocket auth frame so
-- | the BoardHub Durable Object can honour it without a DB read. This module is
-- | the single typed source for the mode set + the visibility rule; the DO's
-- | socket enumeration is the imperative half (an FFI-shaped effect).
module Domain.Presence (modes, normalizeMode, isVisible) where

import Prelude

-- | The two presence modes, in UI order.
modes :: Array String
modes = [ "auto", "off" ]

-- | Normalise an arbitrary stored/incoming value to a known mode. Only the exact
-- | string "off" is appear-offline; everything else (including "" / unknown) is
-- | the default "auto".
normalizeMode :: String -> String
normalizeMode m
  | m == "off" = "off"
  | otherwise = "auto"

-- | The visibility rule the DO applies: a member shows as online iff they hold a
-- | live socket AND their mode is not "off". Appear-offline wins even with an
-- | open connection.
isVisible :: String -> Boolean -> Boolean
isVisible mode hasSocket = hasSocket && normalizeMode mode /= "off"
