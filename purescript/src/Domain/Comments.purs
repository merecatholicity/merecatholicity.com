-- | Where a comments section may exist, and whether it is open. Two facts the
-- | worker and the client must agree on, so both read them here:
-- |
-- | 1. WHICH pages may carry a section at all: the site's own writings — the
-- |    books and the hand-written pages — and never a work merely hosted in the
-- |    library. `commentablePages` is that list, and it is DETECTED, not kept:
-- |    `scripts/writings.py` reads every page built from content/ (unless its
-- |    frontmatter opts out with `comments: false`) and every book the root
-- |    Makefile builds, and writes them as the generated `Domain.Writings`
-- |    module on every psbuild. It was the worker's hand-kept `PAGES`
-- |    whitelist; now a new article or book brings its own switch. The build
-- |    stamps the widget onto exactly these pages by the same rule, and a
-- |    parity test derives the set a second way and holds the kernel to it.
-- |
-- | 2. WHETHER each section is open, which is the admin's call at runtime:
-- |    `comments_pages` (a CSV of the enabled paths) and `comments_journal`
-- |    (one switch that gives every journal article its own section, keyed
-- |    `journal:<article id>`). Both default to OFF — an absent row opens
-- |    nothing. NOTE the polarity: this is the OPPOSITE of `Domain.Wall` and
-- |    `Domain.Turnstile`, where only a literal "0" turns a thing off. There the
-- |    default is the permissive one because getting it wrong darkens a feature
-- |    that was always on; here the sections were switched off by the owner's
-- |    word, and a fresh database must open no section until an admin does.
-- |    Only a literal "1" (or a path listed in the CSV) opens anything.
-- |
-- | A closed section is indistinguishable from a page that never had one: the
-- | worker answers exactly as it does for an unknown page. Nothing is deleted
-- | by a switch — the rows wait for the section to reopen.
module Domain.Comments
  ( commentablePages
  , commentablePaths
  , isCommentable
  , pagesEnabledDefault
  , parseEnabledPages
  , serializeEnabledPages
  , pageEnabled
  , journalEnabledDefault
  , journalEnabledFrom
  , journalKey
  , journalKeyId
  , pageHref
  , journalTeaser
  ) where

import Prelude
import Data.Array as Array
import Data.Foldable (all, elem)
import Data.Int as Int
import Data.Maybe (Maybe(..), maybe)
import Data.String (Pattern(..), joinWith, split, stripPrefix, trim)
import Data.String.CodeUnits (toCharArray)
import Data.String.CodeUnits as CU
import Data.String.Regex as Re
import Data.String.Regex.Flags (noFlags)
import Data.String.Regex.Unsafe (unsafeRegex)
import Domain.Writings as Writings

-- | One of the site's own writings: its served path (the comments `page` key),
-- | the title the admin console shows beside its switch, and its kind
-- | ("book" | "article") — the console groups by it.
type Page = { path :: String, title :: String, kind :: String }

-- | The site's own writings, in the order the console lists them (the books,
-- | then the articles by slug) — the generated `Domain.Writings`, detected
-- | from the sources by `scripts/writings.py`. The path IS the storage key of
-- | every comment on that page, so renaming a page's file orphans its rows.
commentablePages :: Array Page
commentablePages = Writings.writings

-- | The paths alone (the worker's whitelist, the client's eligible list).
commentablePaths :: Array String
commentablePaths = map _.path commentablePages

-- | May this path carry a section at all? A library work never can.
isCommentable :: String -> Boolean
isCommentable p = elem p commentablePaths

-- | The stored `comments_pages` value on a fresh database: no page is open.
pagesEnabledDefault :: String
pagesEnabledDefault = ""

-- | Parse a stored `comments_pages` CSV ("/credo.html, /book.html", …): split,
-- | trim, keep only commentable paths, deduped, in canonical order — the same
-- | idiom as `Domain.Media.parseKinds`. Garbage in the list is dropped, never
-- | stored back, so the CSV can only ever name the site's own writings.
parseEnabledPages :: String -> Array String
parseEnabledPages s =
  let toks = map trim (split (Pattern ",") s)
  in Array.filter (\p -> elem p toks) commentablePaths

-- | The inverse: the canonical stored form of a set of enabled paths.
serializeEnabledPages :: Array String -> String
serializeEnabledPages ps = joinWith "," (Array.filter (\p -> elem p ps) commentablePaths)

-- | Is this page's section open, given the stored CSV? An absent row ("") opens
-- | nothing; an unknown path is never open.
pageEnabled :: String -> String -> Boolean
pageEnabled csv p = elem p (parseEnabledPages csv)

-- | The journal switch ships OFF (see the module note on polarity).
journalEnabledDefault :: Boolean
journalEnabledDefault = false

-- | The stored `comments_journal` value as the rule: only a literal "1" opens
-- | the journal's sections. "true", "on", "yes" and an absent row all read as
-- | off — the admin console writes "1"/"0" and nothing else is trusted.
journalEnabledFrom :: String -> Boolean
journalEnabledFrom v = v == "1"

-- | The `page` key of the comments on one journal article (a forum post id).
journalKey :: Int -> String
journalKey n = "journal:" <> show n

-- | Parse a `journal:<id>` key back to its article id, strictly: digits only,
-- | positive, and CANONICAL (no leading zeros, no sign, no whitespace), so one
-- | article has exactly one key string in the database. Anything else is not a
-- | journal key — a plain page path, a board key, or garbage.
journalKeyId :: String -> Maybe Int
journalKeyId s = case stripPrefix (Pattern "journal:") s of
  Just digits | digits /= "" && all isDigit (toCharArray digits) ->
    case Int.fromString digits of
      Just n | n > 0 && show n == digits -> Just n
      _ -> Nothing
  _ -> Nothing
  where
  isDigit c = c >= '0' && c <= '9'

-- | Where a comment lives, as a site path with query: a page comment on its
-- | page, a journal comment on the article's permalink. Used for permalinks,
-- | feed links and the audit's jump links; a board key passes through untouched
-- | (its callers branch on `board:` first).
pageHref :: String -> String
pageHref p = case journalKeyId p of
  Just n -> "/journal.html?a=" <> show n
  Nothing -> p

-- | The journal's overview shows each entry as a teaser and the entry's own page
-- | shows it whole (2026-11-11, the owner: "I was expecting only excerpts unless
-- | I click in"). A body is markdown whose paragraphs are blank-line separated,
-- | so the teaser is whole paragraphs from the top while they fit `limit`
-- | characters. A first paragraph longer than a third again over the limit is
-- | cut instead: at the last sentence end past half the limit, else the last
-- | space, and never inside a link (`[text](url)`, `<https://…>`) or a `**` run,
-- | which would show its markup raw. Whole paragraphs that come to less than half
-- | the limit (a one-line opening) are followed by the next one, cut the same way.
-- | `more` says the teaser is not the whole
-- | body, so the overview offers "Continue reading".
journalTeaser :: Int -> String -> { text :: String, more :: Boolean }
journalTeaser limit body =
  let
    paras = Array.filter (_ /= "") (map trim (Re.split paraRe (trim body)))
    whole = joinWith "\n\n" paras
  in
    case Array.uncons paras of
      Nothing -> { text: "", more: false }
      Just { head, tail }
        | CU.length head > limit + limit / 3 -> { text: cutProse limit head, more: true }
        | otherwise ->
            let
              kept = keepParas limit [ head ] tail
              text = joinWith "\n\n" kept
              used = CU.length text
            in
              case Array.index paras (Array.length kept) of
                Just next | used < limit / 2 -> { text: text <> "\n\n" <> cutProse (limit - used - 2) next, more: true }
                _ -> { text, more: text /= whole }

paraRe :: Re.Regex
paraRe = unsafeRegex "\\n[ \\t]*\\n\\s*" noFlags

keepParas :: Int -> Array String -> Array String -> Array String
keepParas limit acc rest = case Array.uncons rest of
  Just { head, tail }
    | CU.length (joinWith "\n\n" (Array.snoc acc head)) <= limit -> keepParas limit (Array.snoc acc head) tail
  _ -> acc

-- | One long paragraph cut near `n`. A cut at a sentence end stands as it is; a
-- | cut mid-sentence takes an ellipsis.
cutProse :: Int -> String -> String
cutProse n s =
  let
    c = CU.take n s
    stop = Array.foldl max (-1) (map (\p -> maybe (-1) (_ + 1) (CU.lastIndexOf (Pattern p) c)) [ ". ", "? ", "! ", ".\n", "?\n", "!\n" ])
    sp = maybe (-1) identity (CU.lastIndexOf (Pattern " ") c)
    at = if stop > n / 2 then stop else if sp > (n * 3) / 5 then sp else n
    cut = trimEnd (unopened (CU.take at c))
  in
    if stop > n / 2 && CU.length cut >= stop - 1 then cut else Re.replace trailRe "" cut <> "…"

-- | Back off to before whatever markup the cut left open.
unopened :: String -> String
unopened s =
  let
    link = case CU.lastIndexOf (Pattern "[") s of
      Just i | not (Re.test linkRe (CU.drop i s)) -> CU.take i s
      _ -> s
    angle = case CU.lastIndexOf (Pattern "<") link of
      Just i | CU.indexOf (Pattern ">") (CU.drop i link) == Nothing -> CU.take i link
      _ -> link
    stars = Array.length (split (Pattern "**") angle) - 1
  in
    if stars `mod` 2 == 1 then maybe angle (\i -> CU.take i angle) (CU.lastIndexOf (Pattern "**") angle) else angle

linkRe :: Re.Regex
linkRe = unsafeRegex "^\\[[^\\]]*\\]\\([^)]*\\)" noFlags

trimEnd :: String -> String
trimEnd = Re.replace (unsafeRegex "\\s+$" noFlags) ""

trailRe :: Re.Regex
trailRe = unsafeRegex "[\\s,;:\\u2014\\u2013-]+$" noFlags
