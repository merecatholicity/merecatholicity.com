-- | Full-text search query building — the WORKER's FTS5 sanitizer, single-sourced
-- | here (the client never builds a MATCH; it sends the raw query and the worker
-- | translates it, so there is no client copy to keep in step).
-- |
-- | This is the "make illegal states unrepresentable" slice: a `SafeMatch` has no
-- | public constructor, so the ONLY way to obtain one is `buildMatch`/`merecatMatch`,
-- | both of which double every embedded quote and wrap every token in quotes. The
-- | D1 binding only ever receives `unSafeMatch`'s output, so injecting an FTS5
-- | operator (`- * : ^ NEAR AND OR NOT ( )`) into the MATCH is unrepresentable —
-- | the guarantee lives in the type, not in a reviewer's vigilance.
-- |
-- | Tokenization runs the EXACT regexes the classic worker ran, through
-- | `Data.String.Regex` (a real JS RegExp underneath), so `\S`/`\s` and the
-- | `[A-Za-z0-9À-ɏ'’]` word class behave byte-for-byte as they did (a hand-rolled
-- | tokenizer could drift on an exotic Unicode space). It needed an FFI file until
-- | 2026-10-09; the kernel is PureScript alone now. Everything security-relevant —
-- | trimming, the stopword filter, dedup, the cap, and the quoting — is pure and
-- | lives here.
module Domain.Fts
  ( SafeMatch
  , unSafeMatch
  , buildMatch
  , merecatMatch
  ) where

import Prelude
import Data.Array (catMaybes, filter, take)
import Data.Array.NonEmpty (toArray) as NEA
import Data.Foldable (elem, foldl)
import Data.Maybe (maybe)
import Data.String (Pattern(..), Replacement(..), joinWith, replaceAll, split, toLower, trim)
import Data.String.CodeUnits (drop, dropRight, length, take, takeRight) as CU
import Data.String.Regex (Regex, match)
import Data.String.Regex.Flags (global)
import Data.String.Regex.Unsafe (unsafeRegex)

-- | Every whole match of a global regex, in order (`String.prototype.match` with
-- | the `g` flag: no capture groups, and `lastIndex` never leaks between calls).
matches :: Regex -> String -> Array String
matches re s = maybe [] (catMaybes <<< NEA.toArray) (match re s)

-- | The two quote marks around a phrase match come off; the capture is what is left.
unquote :: String -> String
unquote m = CU.drop 1 (CU.dropRight 1 m)

-- | Forum search: quoted phrases, or non-whitespace runs. The RAW tokens (what the
-- | capture would hold); `buildMatch` trims / filters / caps / quotes them. A whole
-- | match is the phrase alternative exactly when it opens AND closes with a quote:
-- | `\S+` reaches a `"` first only when no closing `"` follows anywhere, so its run
-- | holds no second quote.
buildMatchTokens :: String -> Array String
buildMatchTokens q = map raw (matches forumToken q)
  where
  raw m = if CU.length m >= 2 && CU.take 1 m == "\"" && CU.takeRight 1 m == "\"" then unquote m else m

forumToken :: Regex
forumToken = unsafeRegex "\"([^\"]*)\"|(\\S+)" global

-- | merecat retrieval: quoted phrases (kept verbatim) OR word runs (letters,
-- | digits, Latin-1/extended letters, apostrophes), each tagged phrase vs word so
-- | `merecatMatch` lower-cases and stopword-filters only the words. The word class
-- | holds no quote, so a match opening with one is the phrase alternative.
merecatTokens :: String -> Array { phrase :: Boolean, text :: String }
merecatTokens q = map tag (matches merecatToken q)
  where
  tag m = if CU.take 1 m == "\"" then { phrase: true, text: unquote m } else { phrase: false, text: m }

merecatToken :: Regex
merecatToken = unsafeRegex "\"([^\"]*)\"|([A-Za-z0-9À-ɏ'’]+)" global

-- | A query fragment proven safe to hand to FTS5 MATCH. Constructed only by the
-- | producers below; `unSafeMatch` is the only exit.
newtype SafeMatch = SafeMatch String

unSafeMatch :: SafeMatch -> String
unSafeMatch (SafeMatch s) = s

-- | Wrap a token as a single FTS5 literal term/phrase: double every embedded
-- | quote, then surround with quotes. After this, no operator can escape the term.
quoteTerm :: String -> String
quoteTerm t = "\"" <> replaceAll (Pattern "\"") (Replacement "\"\"") t <> "\""

-- | Forum search MATCH: pull "quoted phrases" and bare non-whitespace runs, trim,
-- | drop empties, cap at ten, quote each, space-join. Byte-identical to the former
-- | worker `buildMatch`.
buildMatch :: String -> SafeMatch
buildMatch q = SafeMatch (joinWith " " (map quoteTerm toks))
  where
  toks = take 10 (filter (_ /= "") (map trim (buildMatchTokens q)))

-- | merecat retrieval MATCH: user-quoted phrases kept verbatim; word runs
-- | lower-cased, apostrophes stripped, sub-2-char / stopword / duplicate words
-- | dropped; up to sixteen tokens OR-joined so bm25 ranks by how much of the
-- | question's meaning a chunk carries. Byte-identical to the former worker
-- | `merecatMatch`.
merecatMatch :: String -> SafeMatch
merecatMatch q = SafeMatch (joinWith " OR " (take 16 (foldl step { out: [], seen: [] } (merecatTokens q)).out))
  where
  step acc tok =
    if tok.phrase then
      let p = trim tok.text
      in if p == "" then acc else acc { out = acc.out <> [ quoteTerm p ] }
    else
      let w = stripApos (toLower tok.text)
      in if CU.length w < 2 || elem w stopwords || elem w acc.seen then acc
         else acc { out = acc.out <> [ quoteTerm w ], seen = acc.seen <> [ w ] }

-- | Strip both apostrophe forms (U+2019 and U+0027), matching the worker's
-- | `.replace(/[’']/g, '')`.
stripApos :: String -> String
stripApos =
  replaceAll (Pattern "'") (Replacement "")
    <<< replaceAll (Pattern "\x2019") (Replacement "")

-- | The stopword set, built by splitting the SAME concatenated string the worker
-- | split (`.split(' ')`) — transcribing the words separately would risk drift, so
-- | the string is copied verbatim and split identically.
stopwords :: Array String
stopwords = split (Pattern " ")
  ( "a about all an and any are as at be been but by can could did do does for from had has have "
      <> "he her his how i if in into is it its just like me my no not of on one or our out over say says said she should so some "
      <> "than that the their them then there these they this to under up us was we were what when where which who why will with "
      <> "would you your"
  )
