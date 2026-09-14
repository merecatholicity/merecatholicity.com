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
  , idleDefaultSecs
  , idleClampSecs
  , voiceFloor
  , glareWins
  , stateTag
  , endReason
  , endReasons
  , callOutcome
  , CallLine(..)
  , missedCallLine
  , declinedCallLine
  , answeredCallLine
  , parseCallLine
  , callLineTag
  , callLineSecs
  , callLineText
  , callLineMissedFor
  , durationLabel
  ) where

import Prelude

import Data.Int (fromString)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), stripPrefix)

-- | The call lifecycle. Ended carries the reason tag the UI speaks from:
-- | "hangup" | "declined" | "busy" | "canceled" | "noanswer" | "missed"
-- | | "taken" | "failed" | "idle".
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
  | IdleHangUp     -- the silence watch: nobody spoke for the admin-set window

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
    IdleHangUp -> Ended "idle"      -- the silence watch — legal ONLY here
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

-- | The ring: 45 s (2026-09-12; 30 before). A callee whose app is closed is
-- | reached by a push and needs the seconds to unlock, open and answer — the
-- | window WhatsApp gives (~60 s) less the caller's patience. Both sides run
-- | it: the caller's ringback ends with "no answer", the callee's panel with
-- | "missed", the same instant.
ringTimeoutSecs :: Int
ringTimeoutSecs = 45

-- | How long Connecting may take before the watchdog calls it failed.
setupTimeoutSecs :: Int
setupTimeoutSecs = 20

-- | The silence auto-hangup window when the admin has not set one, and the
-- | clamp both the worker (settings save + /config) and the client apply to
-- | whatever is stored — one rule, one source.
idleDefaultSecs :: Int
idleDefaultSecs = 60

idleClampSecs :: Int -> Int
idleClampSecs n = max 15 (min 600 n)

-- | The WebRTC stats audioLevel (0..1) above which a sample counts as a
-- | voice. Background hum and comfort noise sit well under 0.01; speech
-- | registers an order of magnitude above it. Either side clearing this
-- | floor resets the silence clock on both ends.
voiceFloor :: Number
voiceFloor = 0.01

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

-- | The call log (2026-09-13). Every major chat app writes a call's outcome
-- | into the conversation as a muted event line — WhatsApp's "Voice call ·
-- | 12 min", Signal's "Missed voice call", FaceTime's "Canceled" — and this
-- | is that grammar: what the worker records once per call, and what both
-- | readers draw by side. The line is a plaintext system word (`enc` 2) in
-- | the thread, written from the CALLER to the callee, so "mine" below means
-- | "I placed the call". It expires with the conversation like any word.
-- |
-- |   * "call:missed"           — nobody answered: the caller's timer ran out,
-- |                               the caller hung up while ringing, or the
-- |                               callee was on another call (busy).
-- |   * "call:declined"         — the callee pressed Decline. The CALLER reads
-- |                               it as "No answer": a decline is the callee's
-- |                               private act (the same indistinguishability
-- |                               a block or the calls-off switch enjoys).
-- |   * "call:answered:<secs>"  — the call connected and lasted this long,
-- |                               measured by the server between the answer
-- |                               and the first hang-up it heard.
-- |
-- | A failed setup records nothing: no app writes "couldn't connect" into
-- | the chat, and the caller's panel already said so.
data CallLine
  = CallMissed
  | CallDeclined
  | CallAnswered Int

derive instance eqCallLine :: Eq CallLine

missedCallLine :: String
missedCallLine = "call:missed"

declinedCallLine :: String
declinedCallLine = "call:declined"

answeredPrefix :: String
answeredPrefix = "call:answered:"

-- | "call:answered:<secs>", the seconds clamped to a day and never negative.
answeredCallLine :: Int -> String
answeredCallLine secs = answeredPrefix <> show (clampSecs secs)

clampSecs :: Int -> Int
clampSecs n = max 0 (min 86400 n)

-- | The grammar read back; anything else is not a call's line.
parseCallLine :: String -> Maybe CallLine
parseCallLine s
  | s == missedCallLine = Just CallMissed
  | s == declinedCallLine = Just CallDeclined
  | otherwise = case stripPrefix (Pattern answeredPrefix) s of
      Just rest -> case fromString rest of
        Just n | n >= 0 -> Just (CallAnswered (clampSecs n))
        _ -> Nothing
      Nothing -> Nothing

-- | The tag the membrane speaks: "missed" | "declined" | "answered".
callLineTag :: CallLine -> String
callLineTag l = case l of
  CallMissed -> "missed"
  CallDeclined -> "declined"
  CallAnswered _ -> "answered"

-- | The duration an answered line carries, 0 otherwise.
callLineSecs :: CallLine -> Int
callLineSecs l = case l of
  CallAnswered n -> n
  _ -> 0

-- | The sentence each side reads, `mine` = I placed the call. The caller's
-- | side is WhatsApp's ("Voice call · No answer"), the callee's Signal's
-- | ("Missed voice call"), and an answered call names its direction and
-- | length on both ("Outgoing voice call · 12 min").
callLineText :: Boolean -> CallLine -> String
callLineText mine l = case l of
  CallMissed -> if mine then "Voice call · No answer" else "Missed voice call"
  CallDeclined -> if mine then "Voice call · No answer" else "Declined voice call"
  CallAnswered n ->
    let dir = if mine then "Outgoing voice call" else "Incoming voice call"
    in if n <= 0 then dir else dir <> " · " <> durationLabel n

-- | Whether the line is a miss FOR THIS READER — the callee's missed or
-- | declined call, drawn in the missed tint every app uses; the caller's
-- | "no answer" and every answered call are quiet.
callLineMissedFor :: Boolean -> CallLine -> Boolean
callLineMissedFor mine l = case l of
  CallAnswered _ -> false
  _ -> not mine

-- | A call's length as the apps say it: "45 sec" under a minute, "12 min"
-- | under an hour, then "1 hr 5 min" ("2 hr" on the hour).
durationLabel :: Int -> String
durationLabel secs
  | secs < 60 = show (max 0 secs) <> " sec"
  | secs < 3600 = show (secs / 60) <> " min"
  | otherwise =
      let h = secs / 3600
          m = (secs `mod` 3600) / 60
      in show h <> " hr" <> (if m > 0 then " " <> show m <> " min" else "")

-- | What a client may report to /call/end. `noanswer` and `canceled` are the
-- | caller's ring ending; `busy` the callee's auto-reply from another call;
-- | `declined` the callee's press (echoed by the caller); `hangup` any end
-- | after the answer; `failed` a setup that never connected.
endReasons :: Array String
endReasons = [ "noanswer", "canceled", "busy", "hangup", "declined", "failed" ]

-- | The server's one rule for what a report records, given who reports
-- | (`caller`), whether the call had been answered, and the reason:
-- |   Just "answered" — any end after the answer: the line carries the length
-- |   Just "missed"   — the CALLER's noanswer / canceled / busy, unanswered
-- |   Just "declined" — either side's declined, unanswered
-- |   Just "failed"   — an unanswered setup that broke: stamped, no line
-- |   Nothing         — a word that records nothing (a callee cannot cancel)
-- | Recording once is the ledger's lock, not this rule's business.
callOutcome :: { caller :: Boolean, answered :: Boolean, reason :: String } -> Maybe String
callOutcome r
  | r.answered = if r.reason == "hangup" || r.reason == "failed" then Just "answered" else Nothing
  | r.reason == "declined" = Just "declined"
  | r.caller && (r.reason == "noanswer" || r.reason == "canceled" || r.reason == "busy") = Just "missed"
  | r.reason == "hangup" || r.reason == "failed" = Just "failed"
  | otherwise = Nothing
