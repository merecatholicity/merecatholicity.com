-- | The 1v1 voice-call state machine — the single typed source for what a
-- | call may do next. Both ends of a call run this same machine (the caller
-- | walks Idle → Outgoing → Connecting → Active, the callee Idle → Incoming →
-- | Connecting → Active); every UI change and every timer flows through
-- | `step`, so an impossible transition is unrepresentable rather than a
-- | client bug. Deliberate rules encoded here:
-- |   * `Ended` is absorbing — nothing revives a finished call.
-- |   * `Timeout` is the ring timer in Outgoing/Incoming and the setup
-- |     watchdog in Connecting, and a NO-OP in Active — a stale ring timer
-- |     firing late can never kill a live call.
-- |   * Call life is fed only by call events: there is no socket-close event
-- |     on purpose, because media is peer-to-peer and an Active call must
-- |     ride through the live layer's idle/hidden socket closes untouched.
-- | Consumed by the client through the app/core.ts membrane (string tags).
module Domain.Call
  ( CallState(..)
  , CallEvent(..)
  , step
  , inCall
  , ringTimeoutSecs
  , setupTimeoutSecs
  , glareWins
  , stateTag
  , endReason
  ) where

import Prelude

-- | The call lifecycle. Ended carries the reason tag the UI speaks from:
-- | "hangup" | "declined" | "busy" | "canceled" | "noanswer" | "missed"
-- | | "taken" | "failed".
data CallState
  = Idle
  | Outgoing
  | Incoming
  | Connecting
  | Active
  | Ended String

derive instance eqCallState :: Eq CallState

-- | Everything that can happen to a call, local or remote.
data CallEvent
  = Place          -- I start a call
  | Ring           -- an offer arrived for me
  | Answer         -- I tap Answer
  | RemoteAnswer   -- my offer was answered
  | Connected      -- the peer connection reached connected
  | HangUp         -- I end it (any phase)
  | RemoteEnd      -- the other side ended it
  | LocalDecline   -- I tap Decline
  | RemoteDecline  -- they declined my call
  | RemoteBusy     -- they were already on a call
  | Timeout        -- ring timer / setup watchdog fired
  | Failure        -- pc failed / mic refused / wire error
  | Taken          -- another of MY tabs answered this ring

derive instance eqCallEvent :: Eq CallEvent

-- | The total transition table. Unlisted pairs stay put.
step :: CallEvent -> CallState -> CallState
step ev st = case st of
  Ended r -> Ended r   -- absorbing: nothing revives a finished call
  Idle -> case ev of
    Place -> Outgoing
    Ring -> Incoming
    _ -> Idle
  Outgoing -> case ev of
    RemoteAnswer -> Connecting
    RemoteDecline -> Ended "declined"
    RemoteBusy -> Ended "busy"
    HangUp -> Ended "canceled"
    RemoteEnd -> Ended "hangup"
    Timeout -> Ended "noanswer"
    Failure -> Ended "failed"
    _ -> Outgoing
  Incoming -> case ev of
    Answer -> Connecting
    LocalDecline -> Ended "declined"
    RemoteEnd -> Ended "canceled"   -- the caller gave up ringing
    Timeout -> Ended "missed"
    Taken -> Ended "taken"
    Failure -> Ended "failed"
    _ -> Incoming
  Connecting -> case ev of
    Connected -> Active
    HangUp -> Ended "hangup"
    RemoteEnd -> Ended "hangup"
    Timeout -> Ended "failed"       -- the setup watchdog
    Failure -> Ended "failed"
    _ -> Connecting
  Active -> case ev of
    HangUp -> Ended "hangup"
    RemoteEnd -> Ended "hangup"
    Failure -> Ended "failed"
    _ -> Active                     -- Timeout is a NO-OP here, by design

-- | Whether a state occupies the line (drives auto-busy replies to a second
-- | ring and disables the Call button).
inCall :: CallState -> Boolean
inCall st = case st of
  Outgoing -> true
  Incoming -> true
  Connecting -> true
  Active -> true
  _ -> false

-- | How long an unanswered call rings, both sides.
ringTimeoutSecs :: Int
ringTimeoutSecs = 30

-- | How long Connecting may take before the watchdog calls it failed.
setupTimeoutSecs :: Int
setupTimeoutSecs = 20

-- | Glare: both members called each other at once. Deterministic tie-break —
-- | the LOWER hash's offer wins (hex strings order lexically); the other side
-- | yields its own offer and takes the ring. Both ends compute the same
-- | answer from the same two hashes.
glareWins :: String -> String -> Boolean
glareWins me other = me < other

-- | The string tag the JS membrane speaks (Ended collapses to "Ended";
-- | the reason travels separately via endReason).
stateTag :: CallState -> String
stateTag st = case st of
  Idle -> "Idle"
  Outgoing -> "Outgoing"
  Incoming -> "Incoming"
  Connecting -> "Connecting"
  Active -> "Active"
  Ended _ -> "Ended"

-- | The Ended reason, "" for a live state.
endReason :: CallState -> String
endReason st = case st of
  Ended r -> r
  _ -> ""
