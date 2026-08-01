-- | Scripture references: the single typed source of the book→slug table and
-- | the autolink regex fragment. Replaces the hand-kept `BIBLE` copies (Phase 1a
-- | retires the byte-verbatim one in app/richtext.js; the docs/comments.js
-- | fallback and the two worker copies follow in 1b / Phase 6).
-- |
-- | `bibleSrc` MUST stay byte-identical to the former richtext.js `BIBLE.src`
-- | (the golden fixture in purescript/test/run.mjs) — it is spliced into the
-- | inline-markdown regex, so any drift changes matching and the bundle bytes.
-- | `bookSlug` takes an already-normalized key (lowercase, whitespace runs
-- | collapsed to single spaces — the boundary op richtext.js still does on the
-- | match) and returns the canonical KJV slug.
module Domain.Scripture
  ( bookSlug
  , bibleSrc
  , verseParts
  ) where

import Prelude
import Data.Array (concatMap, filter, find, sortBy)
import Data.Maybe (Maybe(..))
import Data.Nullable (Nullable, toMaybe, toNullable)
import Data.String (Pattern(..), Replacement(..), joinWith, length, replaceAll, split, trim)

-- | The one source: canonical KJV slug + its accepted spellings (pipe-joined),
-- | transcribed verbatim from the former richtext.js BIBLE spec. Two-letter
-- | forms that are common English words (is/am/so/re) are deliberately omitted.
spec :: Array { slug :: String, forms :: String }
spec =
  [ { slug: "genesis", forms: "genesis|gen|ge|gn" }
  , { slug: "exodus", forms: "exodus|exod|exo|ex" }
  , { slug: "leviticus", forms: "leviticus|lev|lv" }
  , { slug: "numbers", forms: "numbers|num|nm|nb" }
  , { slug: "deuteronomy", forms: "deuteronomy|deut|deu|dt" }
  , { slug: "joshua", forms: "joshua|josh|jos|jsh" }
  , { slug: "judges", forms: "judges|judg|jdg|jg" }
  , { slug: "ruth", forms: "ruth|rth|ru" }
  , { slug: "1-samuel", forms: "1 samuel|1samuel|1 sam|1sam|1 sa|i samuel|i sam|first samuel" }
  , { slug: "2-samuel", forms: "2 samuel|2samuel|2 sam|2sam|2 sa|ii samuel|ii sam|second samuel" }
  , { slug: "1-kings", forms: "1 kings|1kings|1 kgs|1kgs|1 ki|i kings|i kgs|first kings" }
  , { slug: "2-kings", forms: "2 kings|2kings|2 kgs|2kgs|2 ki|ii kings|ii kgs|second kings" }
  , { slug: "1-chronicles", forms: "1 chronicles|1 chron|1 chr|1chr|1 ch|i chronicles|i chron|first chronicles" }
  , { slug: "2-chronicles", forms: "2 chronicles|2 chron|2 chr|2chr|2 ch|ii chronicles|ii chron|second chronicles" }
  , { slug: "ezra", forms: "ezra|ezr|ez" }
  , { slug: "nehemiah", forms: "nehemiah|neh|ne" }
  , { slug: "esther", forms: "esther|esth|est|es" }
  , { slug: "job", forms: "job|jb" }
  , { slug: "psalms", forms: "psalms|psalm|pslm|psa|ps|pss|psm" }
  , { slug: "proverbs", forms: "proverbs|prov|pro|prv|pr" }
  , { slug: "ecclesiastes", forms: "ecclesiastes|eccles|eccl|ecc|ec|qoh" }
  , { slug: "song-of-solomon", forms: "song of solomon|song of songs|song|sos|canticles|cant" }
  , { slug: "isaiah", forms: "isaiah|isa|isai" }
  , { slug: "jeremiah", forms: "jeremiah|jer|je|jr" }
  , { slug: "lamentations", forms: "lamentations|lam|la" }
  , { slug: "ezekiel", forms: "ezekiel|ezek|eze|ezk" }
  , { slug: "daniel", forms: "daniel|dan|da|dn" }
  , { slug: "hosea", forms: "hosea|hos|ho" }
  , { slug: "joel", forms: "joel|joe|jl" }
  , { slug: "amos", forms: "amos|amo" }
  , { slug: "obadiah", forms: "obadiah|obad|oba|ob" }
  , { slug: "jonah", forms: "jonah|jon|jnh" }
  , { slug: "micah", forms: "micah|mic|mc" }
  , { slug: "nahum", forms: "nahum|nah|na" }
  , { slug: "habakkuk", forms: "habakkuk|hab|hb" }
  , { slug: "zephaniah", forms: "zephaniah|zeph|zep|zp" }
  , { slug: "haggai", forms: "haggai|hag|hg" }
  , { slug: "zechariah", forms: "zechariah|zech|zec|zc" }
  , { slug: "malachi", forms: "malachi|mal|ml" }
  , { slug: "matthew", forms: "matthew|matt|mat|mt" }
  , { slug: "mark", forms: "mark|mrk|mar|mk|mr" }
  , { slug: "luke", forms: "luke|luk|lk" }
  , { slug: "john", forms: "john|jhn|joh|jn" }
  , { slug: "acts", forms: "acts|act|ac" }
  , { slug: "romans", forms: "romans|rom|ro|rm" }
  , { slug: "1-corinthians", forms: "1 corinthians|1 cor|1cor|1 co|i corinthians|i cor|first corinthians" }
  , { slug: "2-corinthians", forms: "2 corinthians|2 cor|2cor|2 co|ii corinthians|ii cor|second corinthians" }
  , { slug: "galatians", forms: "galatians|gal|ga" }
  , { slug: "ephesians", forms: "ephesians|ephes|eph" }
  , { slug: "philippians", forms: "philippians|phil|php|pp" }
  , { slug: "colossians", forms: "colossians|col" }
  , { slug: "1-thessalonians", forms: "1 thessalonians|1 thess|1thess|1 thes|1 th|i thessalonians|i thess|first thessalonians" }
  , { slug: "2-thessalonians", forms: "2 thessalonians|2 thess|2thess|2 thes|2 th|ii thessalonians|ii thess|second thessalonians" }
  , { slug: "1-timothy", forms: "1 timothy|1 tim|1tim|1 ti|i timothy|i tim|first timothy" }
  , { slug: "2-timothy", forms: "2 timothy|2 tim|2tim|2 ti|ii timothy|ii tim|second timothy" }
  , { slug: "titus", forms: "titus|tit|ti" }
  , { slug: "philemon", forms: "philemon|philem|phlm|phm|pm" }
  , { slug: "hebrews", forms: "hebrews|heb|hb" }
  , { slug: "james", forms: "james|jas|jm" }
  , { slug: "1-peter", forms: "1 peter|1 pet|1pet|1 pe|1 pt|i peter|i pet|first peter" }
  , { slug: "2-peter", forms: "2 peter|2 pet|2pet|2 pe|2 pt|ii peter|ii pet|second peter" }
  , { slug: "1-john", forms: "1 john|1 jhn|1 jn|1jn|i john|i jn|first john" }
  , { slug: "2-john", forms: "2 john|2 jhn|2 jn|2jn|ii john|ii jn|second john" }
  , { slug: "3-john", forms: "3 john|3 jhn|3 jn|3jn|iii john|iii jn|third john" }
  , { slug: "jude", forms: "jude|jud|jd" }
  , { slug: "revelation", forms: "revelation|revelations|rev|apocalypse|apoc" }
  ]

type FormRow = { form :: String, slug :: String }

-- | Every spelling in spec insertion order (each row's forms left to right),
-- | trimmed, empties dropped — the exact list the JS built before sorting.
formRows :: Array FormRow
formRows = concatMap
  (\r -> map (\f -> { form: f, slug: r.slug })
            (filter (\f -> f /= "") (map trim (split (Pattern "|") r.forms))))
  spec

-- | Look up a canonical slug from an already-normalized key (lowercase,
-- | whitespace collapsed). `Nothing` ⇒ not a book we host ⇒ the caller leaves
-- | the reference as plain text. The barrel erases this to `slug | null`.
bookSlug :: String -> Maybe String
bookSlug key = _.slug <$> find (\r -> r.form == key) formRows

-- | The autolink regex fragment, generated from the SAME spec: spellings
-- | longest-first (stable sort, so equal-length forms keep spec order), spaces
-- | → \s+, joined by | and wrapped with the chapter:verse tail. Byte-identical
-- | to the former richtext.js BIBLE.src (golden-tested).
bibleSrc :: String
bibleSrc = "(" <> alt <> ")\\.?[ \\t]+(\\d+):(\\d+)(?:[\\-\\u2013](\\d+))?"
  where
  sorted = sortBy (\a b -> compare (length b.form) (length a.form)) formRows
  alt = joinWith "|" (map (escape <<< _.form) sorted)
  -- spec forms are [a-z0-9 ] only, so the JS regex-char escape is a no-op here
  -- (asserted in run.mjs); only the space → \s+ rewrite applies.
  escape = replaceAll (Pattern " ") (Replacement "\\s+")

-- | A validated Scripture reference. It is constructed ONLY through mkVerseRef,
-- | so it can never hold a non-book, a chapter or verse below 1, or a backward
-- | range (end < start collapses to a single verse). This is where the illegal
-- | states become unrepresentable: richtext.js used to build the `kjv.html#`
-- | href by raw string concatenation of the regex groups, linking even
-- | nonsensical refs like "Rom 0:0".
newtype VerseRef = VerseRef { slug :: String, ch :: Int, v1 :: Int, v2 :: Int }

mkVerseRef :: String -> Int -> Int -> Maybe Int -> Maybe VerseRef
mkVerseRef bookKey chN v1N mEnd =
  if chN >= 1 && v1N >= 1
    then map (\slug -> VerseRef { slug, ch: chN, v1: v1N, v2: v2N }) (bookSlug bookKey)
    else Nothing
  where
  v2N = case mEnd of
    Just e | e >= v1N -> e
    _ -> v1N

-- | The kjv.html# fragment: a range points at its first verse (matching the
-- | former richtext.js `slug + '-' + ch + '-' + v1`).
anchor :: VerseRef -> String
anchor (VerseRef r) = r.slug <> "-" <> show r.ch <> "-" <> show r.v1

-- | The JS boundary: from a normalized book key + chapter + first verse +
-- | optional end verse, a plain record `{slug, ch, v1, v2, href}` or null. The
-- | record is produced only for a valid reference, so the caller renders a link
-- | exactly when one is warranted. `Nullable` maps straight to JS null/value, so
-- | the barrel passes the result through untouched.
verseParts
  :: String -> Int -> Int -> Nullable Int
  -> Nullable { slug :: String, ch :: Int, v1 :: Int, v2 :: Int, href :: String }
verseParts bookKey chN v1N mEndN =
  toNullable (map project (mkVerseRef bookKey chN v1N (toMaybe mEndN)))
  where
  project vr@(VerseRef r) = { slug: r.slug, ch: r.ch, v1: r.v1, v2: r.v2, href: anchor vr }
