-- | Direct-message rules shared by the client and the worker.
-- |
-- | Three of them live here. The disappearing-message LIFETIMES (24h / 7d / 30d)
-- | — duplicated as `DM_TTLS` in comments.js AND the worker before this module;
-- | `ttlLabel` mirrors comments.js dmTtlLabel's thresholds, and the caller
-- | coerces a missing/zero value to `defaultTtl` first (the barrel does
-- | `Number(ttl) || defaultTtl`). The per-message REACTION grammar (2026-09-10,
-- | the WhatsApp press-and-hold picker): one emoji per side per message — one
-- | of the quick six, any single standard emoji, or one of our own custom-pack
-- | images by its `:code:` token — validated here by both the worker (the store)
-- | and the client (the picker), never by an inline regex in either. And the
-- | REPLY-QUOTE excerpt rule: a reply carries a short quote of what it answers
-- | inside the end-to-end-encrypted plaintext (the server never sees what
-- | answers what), marked by an untypeable sentinel character; the excerpt's
-- | length and whitespace rule are decided here.
module Domain.Dm
  ( ttlOptions
  , ttlLabel
  , defaultTtl
  , mediaMaxSeconds
  , quickReactions
  , reactionMaxUnits
  , isCustomReaction
  , normalizeReaction
  , replySentinel
  , replyExcerptMax
  , replyExcerpt
  ) where

import Prelude

import Data.Array as Array
import Data.Char (fromCharCode)
import Data.Foldable (any)
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.String (toLower, trim)
import Data.String.CodePoints as CP
import Data.String.CodeUnits as CU
import Data.String.Regex (Regex, replace, test)
import Data.String.Regex.Flags (global, noFlags, unicode)
import Data.String.Regex.Unsafe (unsafeRegex)
import Domain.Emoji as Emoji

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

-- | The reaction bar's quick six, in order — the ones a press-and-hold offers
-- | before the "+" that opens the whole picker. ❤️ is among them: the
-- | 2026-08-03 heart (`liked_a`/`liked_b`) was carried forward as this reaction
-- | by migration 0012, so an old like and a new heart are the same thing.
quickReactions :: Array String
quickReactions = [ "👍", "❤️", "😂", "😮", "😢", "🙏" ]

-- | The longest reaction the store accepts, in UTF-16 code units. A single
-- | emoji is at most a handful of code points (a four-person family with a
-- | skin tone is 11 units; a subdivision flag 14); a custom token is at most
-- | 42 characters but every real code is far shorter. A belt under the grammar
-- | below, never the rule itself.
reactionMaxUnits :: Int
reactionMaxUnits = 32

-- | Exactly ONE emoji, in the shape Unicode's RGI grammar gives them: a pair of
-- | regional indicators (a flag), a keycap (digit + FE0F? + 20E3), or a
-- | pictographic base with its optional presentation selector / skin tone,
-- | an optional tag sequence (subdivision flags), and any number of ZWJ-joined
-- | further bases. Two emoji side by side are two reactions, and are refused.
-- | The `u` flag makes `\p{…}` and `\u{…}` mean what they say.
emojiRe :: Regex
emojiRe = unsafeRegex
  ( "^(?:\\p{Regional_Indicator}{2}"
  <> "|[0-9#*]\\uFE0F?\\u20E3"
  <> "|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}){0,2}(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?"
  <> "(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}){0,2})*)$"
  )
  unicode

-- | The custom-pack token grammar: the same `:code:` the composer inserts and the
-- | body renderer resolves (comments.js CUSTOM_EMOJI), compared case-insensitively.
customRe :: Regex
customRe = unsafeRegex "^:([a-z0-9][a-z0-9_+-]{0,39}):$" noFlags

-- | Every custom code the two packs hold — `[code, path]` pairs in Domain.Emoji.
customCodes :: Array String
customCodes = map (\e -> fromMaybe "" (Array.head e)) (Emoji.packs.memes <> Emoji.packs.pepe)

-- | A `:code:` token naming one of OUR pack images — the reaction WhatsApp
-- | cannot offer. Unknown codes are not reactions (nothing a member types
-- | becomes an arbitrary image source).
isCustomReaction :: String -> Boolean
isCustomReaction s =
  let low = toLower (trim s)
  in test customRe low && any (\c -> ":" <> c <> ":" == low) customCodes

-- | The ONE validator for a stored reaction. `Nothing` for anything that is
-- | not exactly one emoji or one known custom token (empty, prose, digits, two
-- | emoji, an unknown `:code:`, anything over the unit cap). A custom token
-- | comes back lower-cased; an emoji comes back as it was.
normalizeReaction :: String -> Maybe String
normalizeReaction raw =
  let s = trim raw
  in
    if s == "" then Nothing
    else if CU.length s > reactionMaxUnits then Nothing
    else if isCustomReaction s then Just (toLower s)
    else if test emojiRe s then Just s
    else Nothing

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
