-- | The librarian's dials: how deeply merecat may reason, how warm its
-- | sampling runs, and how the nine bands of the shelf are weighted when the
-- | search leg ranks them. One rule each, single-sourced into the worker (the
-- | ChatRoom, the mention reply, the retrieval leg, the config endpoint) and
-- | the client (the reader's reasoning selector, the admin dials) through the
-- | `app/core` membrane.
-- |
-- | Reasoning (2026-09-10). The GPU backend the site retired that day carried
-- | the only reasoning dial: a six-step ladder whose value became a plain
-- | directive appended to the system prompt. Workers AI's Qwen3 reasons too —
-- | it is told whether it may by the prompt's closing token (`/think` or
-- | `/no_think`) and its thinking streams inside `<think>` spans the worker
-- | strips — so the same ladder drives it: the level chooses the closing
-- | token, the directive, and how much output headroom the thinking may
-- | spend. The ADMIN holds three dials over every reader's choice: a kill
-- | switch (`reasoning_on`, off by default: today's behaviour), the level a
-- | reader gets before choosing (`reasoning_default`) and the highest level
-- | any reader may pick (`reasoning_max`), plus the level a thread mention
-- | reasons at (`mention_effort`). The server clamps; the client's selector
-- | is a courtesy copy of the same rule.
-- |
-- | Values are the plain strings the config table stores; an unknown one
-- | reads as a caller-supplied fallback, never as an error, because a dial
-- | that cannot be read must not stop the librarian from answering.
module Domain.Merecat
  ( effortLadder
  , effortIndex
  , effortParse
  , effortClamp
  , effortThinks
  , effortDirective
  , effortHeadroom
  , effortLabel
  , reasoningOnFrom
  , reasoningDefaults
  , temperatureDefault
  , temperatureFrom
  , bandWeightsDefault
  , bandWeightsFrom
  , bandWeightsCsv
  , bandCaseSql
  , parseDecimal
  ) where

import Prelude

import Data.Array (elemIndex, length, mapWithIndex)
import Data.Int (fromString, pow, toNumber) as Int
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (Pattern(..), joinWith, length, split, toLower, trim) as S
import Data.Traversable (traverse)

-- | The six steps, in order. `off` sends `/no_think`; everything above it
-- | sends `/think` with a directive.
effortLadder :: Array String
effortLadder = [ "off", "low", "medium", "high", "xhigh", "max" ]

-- | Position on the ladder, -1 for a value that is not on it.
effortIndex :: String -> Int
effortIndex v = fromMaybe (-1) (elemIndex v effortLadder)

-- | Read a stored or offered level: trimmed, lower-cased, the retired
-- | `instant` (the GPU era's "skip the queue, no reasoning") folded into
-- | `off`, anything unknown replaced by the fallback — which is itself read
-- | the same way, so a bad fallback still yields a level.
effortParse :: String -> String -> String
effortParse fallback v =
  let norm x = let t = S.toLower (S.trim x) in if t == "instant" then "off" else t
      n = norm v
  in if effortIndex n >= 0 then n
     else let f = norm fallback in if effortIndex f >= 0 then f else "off"

-- | The lower of a level and a cap, on the ladder. Both are parsed first, so
-- | a cap nobody ever set caps at `off` — the safe side.
effortClamp :: String -> String -> String
effortClamp cap level =
  let c = effortParse "off" cap
      l = effortParse "off" level
  in if effortIndex l > effortIndex c then c else l

-- | Whether the model is allowed to think at all at this level.
effortThinks :: String -> Boolean
effortThinks level = effortParse "off" level /= "off"

-- | What the system prompt asks for at each level, in plain English. `medium`
-- | is the model's own default and adds nothing; `off` never reaches the
-- | prompt (the closing token says it all).
effortDirective :: String -> String
effortDirective level = case effortParse "off" level of
  "low" -> "Think briefly before you answer."
  "high" -> "Think carefully and thoroughly before you answer."
  "xhigh" -> "Reason at length, weighing several angles and objections, before you answer."
  "max" -> "Reason exhaustively, working through objections and counter-arguments from the sources, before you answer."
  _ -> ""

-- | Extra output tokens the thinking may spend beyond the answer's own
-- | ceiling. Thinking and answer share one `max_tokens`; without headroom a
-- | long think would truncate the answer it was meant to improve.
effortHeadroom :: String -> Int
effortHeadroom level = case effortParse "off" level of
  "low" -> 512
  "medium" -> 1024
  "high" -> 2048
  "xhigh" -> 4096
  "max" -> 8192
  _ -> 0

-- | The word the reader sees for each level.
effortLabel :: String -> String
effortLabel level = case effortParse "off" level of
  "low" -> "Low"
  "medium" -> "Medium"
  "high" -> "High"
  "xhigh" -> "Extra high"
  "max" -> "Max"
  _ -> "Off"

-- | The kill switch (config `reasoning_on`). Default-OFF polarity: only a
-- | literal "1" turns reasoning on, because on is the expensive side and an
-- | absent row must mean what the site did before the dial existed.
reasoningOnFrom :: String -> Boolean
reasoningOnFrom v = S.trim v == "1"

-- | The dials' resting values: reasoning off; when it is on, a reader starts
-- | at `low` and may climb to `high`; a thread mention reasons at `high`.
reasoningDefaults :: { on :: Boolean, deflt :: String, max :: String, mention :: String }
reasoningDefaults = { on: false, deflt: "low", max: "high", mention: "high" }

-- | Sampling temperature for answers and mentions. The value the worker had
-- | hardcoded for a year; the fold (the conversation summary) keeps its own
-- | colder constant.
temperatureDefault :: Number
temperatureDefault = 0.35

-- | Read a stored temperature: a decimal in 0..1, anything else the default.
temperatureFrom :: String -> Number
temperatureFrom v = case parseDecimal v of
  Just t -> if t < 0.0 then 0.0 else if t > 1.0 then 1.0 else t
  Nothing -> temperatureDefault

-- | The owner's ladder for the weighted search leg, bands 1 to 9 (index 0 is
-- | band 1): the site's own works highest, then the Scriptures with Newman just
-- | beneath them, the named Fathers, the councils, the worldview shelf, the
-- | scholars, the deep shelf level, and the Roman world at the very bottom.
-- | bm25 is negative-better, so a bigger multiplier boosts a band.
bandWeightsDefault :: Array Number
bandWeightsDefault = [ 1.6, 1.45, 1.35, 1.25, 1.0, 1.4, 0.9, 1.55, 1.3 ]

-- | Read a stored ladder: nine decimals, comma-separated, each clamped to
-- | 0.1..3.0 (a zero would erase a band; past 3 the boost drowns the score).
-- | The wrong count or one unreadable entry yields the default ladder whole —
-- | a half-read ladder would silently re-rank the shelf.
bandWeightsFrom :: String -> Array Number
bandWeightsFrom v =
  let parts = map S.trim (S.split (S.Pattern ",") (S.trim v))
  in if length parts /= 9 then bandWeightsDefault
     else case traverse parseDecimal parts of
       Just ws -> map clampWeight ws
       Nothing -> bandWeightsDefault
  where
  clampWeight w = if w < 0.1 then 0.1 else if w > 3.0 then 3.0 else w

-- | The stored form: the same nine decimals, comma-separated.
bandWeightsCsv :: Array Number -> String
bandWeightsCsv ws = S.joinWith "," (map show ws)

-- | The SQL expression the weighted leg multiplies bm25 by, from a ladder.
bandCaseSql :: Array Number -> String
bandCaseSql ws =
  let ladder = if length ws == 9 then ws else bandWeightsDefault
      arm i w = "WHEN " <> show (i + 1) <> " THEN " <> show w
  in "(CASE w.tier " <> S.joinWith " " (mapWithIndex arm ladder) <> " ELSE 1.0 END)"

-- | A non-negative decimal ("1", "1.6", ".5", "0.35") as a Number; anything
-- | else Nothing. Written by hand because the kernel carries no `numbers`
-- | package and needs nothing more than this.
parseDecimal :: String -> Maybe Number
parseDecimal s = case S.split (S.Pattern ".") (S.trim s) of
  [ i ] -> if i == "" then Nothing else Int.toNumber <$> Int.fromString i
  [ i, f ] -> do
    if i == "" && f == "" then Nothing else pure unit
    ip <- if i == "" then Just 0 else Int.fromString i
    fp <- if f == "" then Just 0 else Int.fromString f
    let n = S.length f
    if fp < 0 then Nothing
      else pure (Int.toNumber ip + Int.toNumber fp / Int.toNumber (Int.pow 10 n))
  _ -> Nothing
