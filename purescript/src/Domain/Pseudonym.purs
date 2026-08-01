-- | The pseudonym a hashed identity is shown under when it has no nickname:
-- | "Adjective-Noun xxxx", derived deterministically from the identity hash.
-- | The two 40-word lists and the derivation are the canonical "wordlists in two
-- | files" hazard — duplicated verbatim in comments.js AND the worker; this is
-- | the single typed source (the worker single-sources here in Phase 6).
-- |
-- | Derivation (verbatim from comments.js:126): bytes 4|5 of the hash pick the
-- | adjective, bytes 6|7 the noun (each `(hi<<8|lo) mod 40`), then the first four
-- | hex chars are appended.
module Domain.Pseudonym (displayName) where

import Prelude
import Data.Array (length, (!!))
import Data.Int (fromStringAs, hexadecimal)
import Data.Maybe (fromMaybe)
import Data.String (drop, take)

adjs :: Array String
adjs =
  [ "Patient", "Quiet", "Steadfast", "Humble", "Gentle", "Sober", "Watchful", "Earnest"
  , "Merry", "Plain", "Hidden", "Upright", "Ancient", "Early", "Golden", "Green"
  , "Grey", "Amber", "Ivory", "Deep", "Broad", "High", "Still", "Bright"
  , "Clear", "Kind", "Mild", "Firm", "True", "Swift", "Careful", "Cheerful"
  , "Constant", "Modest", "Peaceful", "Prudent", "Silent", "Simple", "Sturdy", "Temperate"
  ]

nouns :: Array String
nouns =
  [ "Cedar", "Harbor", "Meadow", "River", "Garden", "Orchard", "Bridge", "Lantern"
  , "Anchor", "Well", "Spring", "Stone", "Oak", "Olive", "Vine", "Wheat"
  , "Barley", "Dove", "Sparrow", "Heron", "Candle", "Bell", "Tower", "Gate"
  , "Path", "Field", "Hill", "Valley", "Brook", "Shore", "Island", "Harvest"
  , "Vineyard", "Cypress", "Juniper", "Almond", "Fig", "Palm", "Elm", "Ash"
  ]

-- | The hex byte at position `i` (chars i*2, i*2+1), or 0 if unparseable.
byteAt :: String -> Int -> Int
byteAt hash i = fromMaybe 0 (fromStringAs hexadecimal (take 2 (drop (i * 2) hash)))

displayName :: String -> String
displayName hash =
  let
    a = ((byteAt hash 4) * 256 + (byteAt hash 5)) `mod` length adjs
    n = ((byteAt hash 6) * 256 + (byteAt hash 7)) `mod` length nouns
  in
    fromMaybe "" (adjs !! a) <> "-" <> fromMaybe "" (nouns !! n) <> " " <> take 4 hash
