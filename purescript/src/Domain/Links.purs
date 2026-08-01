-- | Offsite profile links — a member's website + X / Facebook / Instagram / TikTok.
-- | Each stored value becomes an `href` on the profile, so the ONLY thing that
-- | matters for safety is that it can never be a `javascript:`/`data:`/other
-- | scheme — this module is that gate, single-sourced by the client editor and
-- | the worker (mirrors Domain.Handle). A raw value is either an explicit
-- | http(s) URL (kept as-is) or a bare handle/domain we normalize to the
-- | platform's https URL; anything else is rejected.
module Domain.Links
  ( normalize
  , platforms
  , maxLen
  ) where

import Prelude
import Data.Foldable (all)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), drop, indexOf, take, toLower, trim)
import Data.String.CodeUnits (toCharArray, length)

maxLen :: Int
maxLen = 200

-- | The recognized platforms; "website" is a plain URL, the rest take a handle.
platforms :: Array String
platforms = [ "website", "x", "facebook", "instagram", "tiktok" ]

isHandleChar :: Char -> Boolean
isHandleChar c =
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
    || c == '_' || c == '.' || c == '-'

isHttp :: String -> Boolean
isHttp s = let l = toLower s in take 7 l == "http://" || take 8 l == "https://"

hasColon :: String -> Boolean
hasColon s = case indexOf (Pattern ":") s of
  Just _ -> true
  Nothing -> false

stripAt :: String -> String
stripAt s = case take 1 s of
  "@" -> drop 1 s
  _ -> s

platformUrl :: String -> String -> String
platformUrl platform h = case platform of
  "x" -> "https://x.com/" <> h
  "facebook" -> "https://www.facebook.com/" <> h
  "instagram" -> "https://www.instagram.com/" <> h
  "tiktok" -> "https://www.tiktok.com/@" <> h
  _ -> ""

-- | Normalize one link for one platform to a safe https URL, or reject it.
-- | Returns a plain record (no ADTs) so the worker + client read it directly:
-- | `{ ok, url, error }`. Empty input is a valid "cleared" value (ok, url "").
normalize :: String -> String -> { ok :: Boolean, url :: String, error :: String }
normalize platform raw0 =
  let raw = trim raw0
  in
    if raw == "" then { ok: true, url: "", error: "" }
    else if length raw > maxLen then { ok: false, url: "", error: "too_long" }
    else if isHttp raw then { ok: true, url: raw, error: "" }   -- explicit http(s) URL: keep as-is
    else if hasColon raw then { ok: false, url: "", error: "bad_scheme" }   -- javascript:/data:/...
    else handleOrDomain platform raw

handleOrDomain :: String -> String -> { ok :: Boolean, url :: String, error :: String }
handleOrDomain platform raw =
  if platform == "website" then
    case indexOf (Pattern ".") raw of   -- a bare domain like example.com
      Just _ -> { ok: true, url: "https://" <> raw, error: "" }
      Nothing -> { ok: false, url: "", error: "bad_url" }
  else
    let h = stripAt raw
    in
      if h == "" || not (all isHandleChar (toCharArray h)) then { ok: false, url: "", error: "bad_handle" }
      else
        let u = platformUrl platform h
        in if u == "" then { ok: false, url: "", error: "bad_platform" } else { ok: true, url: u, error: "" }
