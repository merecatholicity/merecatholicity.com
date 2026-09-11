-- | Where a comments section may exist, and whether it is open. Two facts the
-- | worker and the client must agree on, so both read them here:
-- |
-- | 1. WHICH pages may carry a section at all: the site's own writings — the
-- |    book and the hand-written pages — and never a work merely hosted in the
-- |    library. `commentablePages` is that list; it was the worker's `PAGES`
-- |    whitelist, now single-sourced. The build stamps the widget onto exactly
-- |    these pages (content frontmatter `comments: true`, the book's tail
-- |    partial) and a parity test holds the two lists together.
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
  ) where

import Prelude
import Data.Array as Array
import Data.Foldable (all, elem)
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), joinWith, split, stripPrefix, trim)
import Data.String.CodeUnits (toCharArray)

-- | One of the site's own writings: its served path (the comments `page` key)
-- | and the title the admin console shows beside its switch.
type Page = { path :: String, title :: String }

-- | The site's own writings, in the order the console lists them. The path IS
-- | the storage key of every comment on that page, so a rename here orphans
-- | rows — add, never rename. Adding one also means giving the page its widget
-- | (content frontmatter `comments: true`); the parity test refuses a mismatch.
commentablePages :: Array Page
commentablePages =
  [ { path: "/book.html", title: "Mere Catholicity (the book)" }
  , { path: "/charting-communions.html", title: "Charting mere catholicity: the historic communions" }
  , { path: "/free-churches.html", title: "Charting the free churches" }
  , { path: "/objections.html", title: "Fifty objections, answered" }
  , { path: "/credo.html", title: "Credo" }
  , { path: "/lex-orandi.html", title: "Lex orandi, lex credendi" }
  , { path: "/about.html", title: "About" }
  ]

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
