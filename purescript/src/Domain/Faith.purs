-- | A member's faith declaration: a closed set of three, chosen at signup and
-- | shown under the author's name. The single typed source of the code ↔ label
-- | map AND the display order — retiring the `FAITH`/`FAITH_ORDER` copy in
-- | comments.js (the worker's `FAITHS`/`FAITH_LABELS` single-source here in
-- | Phase 6). `faithList` is the ordered [{code,label}] the radios render; a
-- | code off the list has no label (unknown ⇒ not shown).
module Domain.Faith
  ( Faith(..)
  , faithList
  , labelForCode
  ) where

import Prelude
import Data.Maybe (Maybe(..))

data Faith = Nicene | IndoEuropean | Seeker

derive instance eqFaith :: Eq Faith

-- | Display order (radios + the served /config `faiths`).
allFaiths :: Array Faith
allFaiths = [ Nicene, IndoEuropean, Seeker ]

faithCode :: Faith -> String
faithCode = case _ of
  Nicene -> "nicene"
  IndoEuropean -> "indo-european"
  Seeker -> "seeker"

faithLabel :: Faith -> String
faithLabel = case _ of
  Nicene -> "Nicene"
  IndoEuropean -> "pre-Christian Indo European"
  Seeker -> "Seeker"

-- | The ordered code/label pairs — the one source the client radios and the
-- | author faith-line both read.
faithList :: Array { code :: String, label :: String }
faithList = map (\f -> { code: faithCode f, label: faithLabel f }) allFaiths

fromCode :: String -> Maybe Faith
fromCode = case _ of
  "nicene" -> Just Nicene
  "indo-european" -> Just IndoEuropean
  "seeker" -> Just Seeker
  _ -> Nothing

-- | The label for a stored code, or Nothing for an unrecognized one.
labelForCode :: String -> Maybe String
labelForCode c = faithLabel <$> fromCode c
