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
-- | Tokenization runs through a thin FFI (Fts.js) that uses the EXACT JS regexes,
-- | so `\S`/`\s` and the `[A-Za-z0-9À-ɏ'’]` word class behave byte-for-byte as the
-- | classic worker did (a hand-rolled PureScript tokenizer could drift on an exotic
-- | Unicode space). Everything security-relevant — trimming, the stopword filter,
-- | dedup, the cap, and the quoting — is pure and lives here.
module Domain.Fts
  ( SafeMatch
  , unSafeMatch
  , buildMatch
  , merecatMatch
  ) where

import Prelude
import Data.Array (filter, take)
import Data.Foldable (elem, foldl)
import Data.String (Pattern(..), Replacement(..), joinWith, replaceAll, split, toLower, trim)
import Data.String.CodeUnits (length) as CU

foreign import buildMatchTokensImpl :: String -> Array String
foreign import merecatTokensImpl :: String -> Array { phrase :: Boolean, text :: String }

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
  toks = take 10 (filter (_ /= "") (map trim (buildMatchTokensImpl q)))

-- | merecat retrieval MATCH: user-quoted phrases kept verbatim; word runs
-- | lower-cased, apostrophes stripped, sub-2-char / stopword / duplicate words
-- | dropped; up to sixteen tokens OR-joined so bm25 ranks by how much of the
-- | question's meaning a chunk carries. Byte-identical to the former worker
-- | `merecatMatch`.
merecatMatch :: String -> SafeMatch
merecatMatch q = SafeMatch (joinWith " OR " (take 16 (foldl step { out: [], seen: [] } (merecatTokensImpl q)).out))
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
