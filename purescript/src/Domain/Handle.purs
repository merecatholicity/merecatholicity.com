-- | Custom profile handles — the "@handle" a member may claim for their profile
-- | URL (merecatholicity.com/@adam → profile.html?u=adam), distinct from the
-- | free-form, non-unique display `nick`. Uniqueness is enforced by the worker
-- | against the D1 store; the FORMAT rules — the "sane constraints" — live here
-- | as the single typed source shared by the client editor and the worker.
-- |
-- | A `Handle` has no public constructor, so an unvalidated handle is
-- | unrepresentable; `mkHandle` is the only producer and it lower-cases + trims
-- | first (handles are case-insensitive, stored lower-cased). `errorTag` gives
-- | the discriminant the barrel/membrane and the tests read.
module Domain.Handle
  ( Handle
  , unHandle
  , HandleError(..)
  , errorTag
  , minLen
  , maxLen
  , reserved
  , mkHandle
  , validate
  ) where

import Prelude
import Data.Array as Array
import Data.Either (Either(..))
import Data.Foldable (all, any, elem)
import Data.Maybe (Maybe(..))
import Data.String (toLower, trim)
import Data.String.CodeUnits (toCharArray)

minLen :: Int
minLen = 3

maxLen :: Int
maxLen = 30

-- | Names that must never resolve to a member (routes, roles, the bot). A claim
-- | on any of these is refused. Lower-case; compared against the normalized input.
reserved :: Array String
reserved =
  [ "merecat", "merecatholicity", "admin", "administrator", "root", "system"
  , "api", "www", "mail", "email", "support", "help", "staff", "mod", "moderator"
  , "official", "about", "contact", "terms", "privacy", "home", "index"
  , "community", "profile", "profiles", "message", "messages", "inbox", "dm"
  , "feed", "search", "settings", "notifications", "library", "sources"
  , "resources", "book", "credo", "bot", "me", "u", "null", "undefined"
  , "anonymous", "everyone", "new", "edit", "delete", "login", "logout"
  , "signup", "register"
  ]

data HandleError
  = TooShort
  | TooLong
  | BadChars
  | BadStart
  | BadUnderscore
  | Reserved

-- | The membrane/test discriminant for a rejection.
errorTag :: HandleError -> String
errorTag e = case e of
  TooShort -> "too_short"
  TooLong -> "too_long"
  BadChars -> "bad_chars"
  BadStart -> "bad_start"
  BadUnderscore -> "bad_underscore"
  Reserved -> "reserved"

newtype Handle = Handle String

unHandle :: Handle -> String
unHandle (Handle s) = s

isLowerAlpha :: Char -> Boolean
isLowerAlpha c = c >= 'a' && c <= 'z'

isDigit :: Char -> Boolean
isDigit c = c >= '0' && c <= '9'

isAllowed :: Char -> Boolean
isAllowed c = isLowerAlpha c || isDigit c || c == '_'

-- | Validate + normalize a claimed handle. Rules (in order, first failure wins):
-- | 3–30 chars; only [a-z0-9_]; must start with a letter; no trailing or doubled
-- | underscore (a leading one is caught by the start rule); not reserved.
mkHandle :: String -> Either HandleError Handle
mkHandle raw =
  let
    s = toLower (trim raw)
    cs = toCharArray s
    n = Array.length cs
  in
    if n < minLen then Left TooShort
    else if n > maxLen then Left TooLong
    else if not (all isAllowed cs) then Left BadChars
    else if not (startsAlpha cs) then Left BadStart
    else if edgeOrDoubleUnderscore cs then Left BadUnderscore
    else if elem s reserved then Left Reserved
    else Right (Handle s)

startsAlpha :: Array Char -> Boolean
startsAlpha cs = case Array.head cs of
  Just c -> isLowerAlpha c
  Nothing -> false

edgeOrDoubleUnderscore :: Array Char -> Boolean
edgeOrDoubleUnderscore cs = trailing || double
  where
  trailing = case Array.last cs of
    Just c -> c == '_'
    Nothing -> false
  double = any identity (Array.zipWith (\a b -> a == '_' && b == '_') cs (Array.drop 1 cs))

-- | JS-boundary form: `mkHandle` with the ADTs erased to a plain record, so the
-- | worker (which imports the raw compiled output) and the client barrel both
-- | read `{ ok, handle, error }` without touching PureScript Either/ADTs. `ok`
-- | true carries the normalized handle in `handle`; false carries the `errorTag`
-- | in `error`.
validate :: String -> { ok :: Boolean, handle :: String, error :: String }
validate raw = case mkHandle raw of
  Right h -> { ok: true, handle: unHandle h, error: "" }
  Left e -> { ok: false, handle: "", error: errorTag e }
