-- | The scriptorium rank ladder: a member's standing by total live-forum posts.
-- |
-- | This is the single typed source of the ladder. It replaces the hand-kept
-- | `RANKS`/`rankFor`/`rankLine` in docs/comments.js (and, in Phase 6, the
-- | verbatim copy in comments-worker/src/index.js). A `Rank` is one of nine
-- | constructors — never a stray string — and the thresholds live in exactly
-- | one ascending table.
-- |
-- | Parity target (docs/comments.js:53-66):
-- |   rankFor(n): highest label whose threshold n has reached (Novice covers 0-)
-- |   rankLine(posts): "<label> · <n> post(s)"
-- | The app/core.js barrel erases the `Rank` ADT to the label string the
-- | classic JS path expects (mcCore.rankFor(n) : string).
module Domain.Rank
  ( Rank(..)
  , rankFor
  , rankLabel
  , rankLine
  ) where

import Prelude
import Data.Array (foldl)

data Rank
  = Novice
  | Apprentice
  | ScriptoriumHand
  | Copyist
  | Scribe
  | Illuminator
  | MasterScribe
  | KeeperOfScrolls
  | TreasuryOfWisdom

derive instance eqRank :: Eq Rank

-- | The one ascending threshold table. `min` is the inclusive post count at
-- | which the rank is reached.
ladder :: Array { min :: Int, rank :: Rank }
ladder =
  [ { min: 0, rank: Novice }
  , { min: 10, rank: Apprentice }
  , { min: 50, rank: ScriptoriumHand }
  , { min: 100, rank: Copyist }
  , { min: 250, rank: Scribe }
  , { min: 500, rank: Illuminator }
  , { min: 1000, rank: MasterScribe }
  , { min: 2500, rank: KeeperOfScrolls }
  , { min: 5000, rank: TreasuryOfWisdom }
  ]

-- | The highest rank whose threshold `n` has reached. The ladder ascends, so a
-- | left fold that keeps the last row satisfied returns that rank; counts below
-- | the first threshold (including negatives) stay `Novice` — matching the JS
-- | loop's `name = RANKS[0][1]` seed.
rankFor :: Int -> Rank
rankFor n = foldl (\acc row -> if n >= row.min then row.rank else acc) Novice ladder

rankLabel :: Rank -> String
rankLabel = case _ of
  Novice -> "Novice"
  Apprentice -> "Apprentice"
  ScriptoriumHand -> "Scriptorium Hand"
  Copyist -> "Copyist"
  Scribe -> "Scribe"
  Illuminator -> "Illuminator"
  MasterScribe -> "Master Scribe"
  KeeperOfScrolls -> "Keeper of Scrolls"
  TreasuryOfWisdom -> "Treasury of Wisdom"

-- | "<label> · <n> post(s)" — the muted rank line under an author. The middle
-- | dot is U+00B7, matching docs/comments.js:65.
rankLine :: Int -> String
rankLine posts =
  rankLabel (rankFor posts)
    <> " · "
    <> show posts
    <> " "
    <> (if posts == 1 then "post" else "posts")
