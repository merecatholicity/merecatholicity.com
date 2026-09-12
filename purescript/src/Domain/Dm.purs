-- | Direct-message rules shared by the client and the worker.
-- |
-- | The disappearing-message LIFETIMES (24h / 7d / 30d) — duplicated as
-- | `DM_TTLS` in comments.js AND the worker before this module; `ttlLabel`
-- | mirrors comments.js dmTtlLabel's thresholds, and the caller coerces a
-- | missing/zero value to `defaultTtl` first (the barrel does
-- | `Number(ttl) || defaultTtl`). The REPLY-QUOTE excerpt rule: a reply carries
-- | a short quote of what it answers inside the end-to-end-encrypted plaintext
-- | (the server never sees what answers what), marked by an untypeable sentinel
-- | character; the excerpt's length and whitespace rule are decided here. The
-- | per-message REACTION grammar (2026-09-10, the WhatsApp press-and-hold
-- | picker) was born here and moved to Domain.Reaction on 2026-09-12 when the
-- | board and the feed gained the same picker; it is re-exported from here so
-- | every DM reader still finds it where it always was.
module Domain.Dm
  ( ttlOptions
  , ttlLabel
  , defaultTtl
  , mediaMaxSeconds
  , module Domain.Reaction
  , replySentinel
  , replyExcerptMax
  , replyExcerpt
  ) where

import Prelude

import Data.Char (fromCharCode)
import Data.Maybe (maybe)
import Data.String (trim)
import Data.String.CodePoints as CP
import Data.String.CodeUnits as CU
import Data.String.Regex (Regex, replace)
import Data.String.Regex.Flags (global)
import Data.String.Regex.Unsafe (unsafeRegex)
import Domain.Reaction (quickReactions, reactionMaxUnits, isCustomReaction, normalizeReaction)

-- | The three chooser options in order: 24h / 7d / 30d.
ttlOptions :: Array { secs :: Int, label :: String }
ttlOptions =
  [ { secs: 86400, label: "24 hours" }
  , { secs: 604800, label: "7 days" }
  , { secs: 2592000, label: "30 days" }
  ]

-- | The default lifetime for a conversation with no explicit TTL set: 30 days.
-- | Single-sourced into the worker's `dm_default_ttl` app-setting default and the
-- | client's dmTtlLabel coercion, so "the default" lives in exactly one place.
defaultTtl :: Int
defaultTtl = 2592000

-- | The HARD cap on how long any DM media attachment may persist — 30 days from
-- | upload — enforced by the sweep even for SAVED messages (you can keep the text
-- | forever, but the media is gone within 30 days). Independent of `ttlOptions`.
mediaMaxSeconds :: Int
mediaMaxSeconds = 2592000

-- | The label for a lifetime in seconds: <= 24h → "24 hours", >= 30d → "30 days",
-- | anything between → "7 days".
ttlLabel :: Int -> String
ttlLabel secs
  | secs <= 86400 = "24 hours"
  | secs >= 2592000 = "30 days"
  | otherwise = "7 days"

-- | The character that opens a reply envelope inside the E2E plaintext:
-- | U+0001, which no keyboard produces and the worker's CONTROL_RE refuses in
-- | any plaintext it can see. Plaintext that does not begin with it is the
-- | bare message it always was, so every older message still reads.
replySentinel :: String
replySentinel = maybe "" CU.singleton (fromCharCode 1)

-- | How much of the quoted message a reply carries, in code points.
replyExcerptMax :: Int
replyExcerptMax = 160

wsRe :: Regex
wsRe = unsafeRegex "\\s+" global

-- | The quote a reply keeps of what it answers: whitespace runs (line breaks
-- | included) folded to one space, trimmed, and cut to `replyExcerptMax` code
-- | points with an ellipsis when it was longer. Counted in code points, never
-- | UTF-16 units, so an emoji is never split in half.
replyExcerpt :: String -> String
replyExcerpt raw =
  let s = trim (replace wsRe " " raw)
  in
    if CP.length s <= replyExcerptMax then s
    else trim (CP.take replyExcerptMax s) <> "…"
