-- | The ONE reaction grammar (2026-09-12), shared by every surface a
-- | press-and-hold opens: a direct message (one reaction per side, on `dms`),
-- | a board post — a topic head, a reply, or an article-page comment, all rows
-- | of `comments` — a feed post and a feed comment (one reaction per member per
-- | target, in the `reactions` ledger). It began life inside Domain.Dm on
-- | 2026-09-10; the public surfaces gained reactions two days later and the
-- | grammar moved here so that a DM reaction and a post reaction can never
-- | drift apart. `normalizeReaction` is the ONE validator: the worker's stores
-- | and the client's pickers both run it, never an inline regex in either.
-- | `targets` names the public ledger's three targets, and `notifKind` the
-- | notification a reaction on each of them rings.
module Domain.Reaction
  ( quickReactions
  , reactionMaxUnits
  , isCustomReaction
  , normalizeReaction
  , targets
  , isTarget
  , notifKind
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (any, elem)
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (toLower, trim)
import Data.String.CodeUnits as CU
import Data.String.Regex (Regex, test)
import Data.String.Regex.Flags (noFlags, unicode)
import Data.String.Regex.Unsafe (unsafeRegex)
import Domain.Emoji as Emoji

-- | The reaction bar's quick six, in order — the ones a press-and-hold offers
-- | before the "+" that opens the whole picker. ❤️ is among them: the
-- | 2026-08-03 DM heart (`liked_a`/`liked_b`) was carried forward as this
-- | reaction by migration 0012, and the feed's ❤️ likes (`wall_likes`,
-- | `wall_comment_likes`) by migration 0014 — so an old like and a new heart
-- | are the same thing everywhere.
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

-- | The public ledger's targets, as the `reactions.target` CHECK spells them:
-- | `post` is any row of `comments` (a topic head, a reply, an article-page
-- | comment), `wall` a feed post, `wallc` a feed comment. A DM reaction is not
-- | a target: it lives on the message row itself (`react_a`/`react_b`), inside
-- | the pair's own thread, and never in a public ledger.
targets :: Array String
targets = [ "post", "wall", "wallc" ]

isTarget :: String -> Boolean
isTarget t = elem t targets

-- | The notification a reaction on a target rings for the author: a board post
-- | rings `react`, a feed post or comment `wall-react` (so the social switch can
-- | hide it with the rest of the wall's bells). Anything else is not a target.
notifKind :: String -> Maybe String
notifKind t = case t of
  "post" -> Just "react"
  "wall" -> Just "wall-react"
  "wallc" -> Just "wall-react"
  _ -> Nothing
