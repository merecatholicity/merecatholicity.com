-- | The media platform settings — the single typed source for what the DM /
-- | wall / board attachment system permits: the three media kinds, the default
-- | per-kind size limits and storage caps, the admin-setting clamps, the
-- | kinds-mask parsing, the R2 object-key kind parser (security-relevant: the
-- | claim-time mask enforcement reads a key's kind from here), and the exact
-- | MIME whitelists. Consumed by the worker (raw compiled output) and the
-- | client (app/core.ts membrane → window.mcCore). Pure data + parsing only.
module Domain.Media
  ( Kind(..)
  , parseKind
  , printKind
  , kindNames
  , defaults
  , clampKindBytes
  , clampAudioSeconds
  , clampCapBytes
  , parseKinds
  , serializeKinds
  , kindLetter
  , letterKind
  , kindOfKey
  , mimesFor
  , mimeAllowed
  , kindOfMime
  , acceptFor
  , maxBytesFor
  ) where

import Prelude
import Data.Array as Array
import Data.Foldable (all, elem)
import Data.Maybe (Maybe(..), maybe)
import Data.String (Pattern(..), joinWith, split, toLower, trim)
import Data.String.CodeUnits (toCharArray)

-- | The three media kinds. The wire/storage form is the lowercase name
-- | ("image" | "video" | "audio"); the ADT never crosses the JS boundary —
-- | every exported String-taking function parses through here, so an unknown
-- | kind string falls out as Nothing/empty, never a partial match.
data Kind = Image | Video | Audio

derive instance eqKind :: Eq Kind

-- | Canonical order: image, video, audio — everywhere (masks, accept attrs).
allKinds :: Array Kind
allKinds = [ Image, Video, Audio ]

printKind :: Kind -> String
printKind k = case k of
  Image -> "image"
  Video -> "video"
  Audio -> "audio"

parseKind :: String -> Maybe Kind
parseKind s = case s of
  "image" -> Just Image
  "video" -> Just Video
  "audio" -> Just Audio
  _ -> Nothing

-- | The kind names in canonical order — the string-side twin of `allKinds`.
kindNames :: Array String
kindNames = map printKind allKinds

-- | The platform defaults an admin's app_settings override. Byte values are
-- | Number (2 GB / 3 GB exceed the 32-bit Int range); the kinds masks are the
-- | serialized form `parseKinds` reads back.
defaults ::
  { imageMaxBytes :: Number
  , videoMaxBytes :: Number
  , audioMaxBytes :: Number
  , audioMaxSeconds :: Int
  , kindsDm :: String
  , kindsWall :: String
  , kindsBoard :: String
  , capDmBytes :: Number
  , capWallBytes :: Number
  , autocompress :: Boolean
  }
defaults =
  { imageMaxBytes: 10485760.0    -- 10 MB
  , videoMaxBytes: 15728640.0    -- 15 MB
  , audioMaxBytes: 5242880.0     -- 5 MB
  , audioMaxSeconds: 180
  , kindsDm: "image,video,audio"
  , kindsWall: "image,video,audio"
  , kindsBoard: "image,audio"
  , capDmBytes: 2147483648.0     -- 2 GB
  , capWallBytes: 3221225472.0   -- 3 GB
  , autocompress: true
  }

-- | Clamp an admin-supplied per-kind upload limit: floor 64 KB, ceiling 100 MB
-- | (the Workers request-body wall — an upload above it can never arrive).
clampKindBytes :: Number -> Number
clampKindBytes n = max 65536.0 (min 104857600.0 n)

-- | Clamp the voice-note length limit: 30 seconds .. 10 minutes.
clampAudioSeconds :: Number -> Number
clampAudioSeconds n = max 30.0 (min 600.0 n)

-- | Clamp a per-surface storage cap: floor 100 MB, ceiling 9 GB (under the R2
-- | free-tier 10 GB, leaving headroom for the DM media bucket's own sweep lag).
clampCapBytes :: Number -> Number
clampCapBytes n = max 104857600.0 (min 9663676416.0 n)

-- | Parse a stored kinds mask ("image, video", "audio,image,image", …): split
-- | on commas, trim, keep only real kinds, dedupe — always emitting canonical
-- | image,video,audio order regardless of input order. "" -> [].
parseKinds :: String -> Array String
parseKinds s =
  let toks = map trim (split (Pattern ",") s)
  in Array.filter (\k -> elem k toks) kindNames

-- | The inverse: an array of kind names -> the canonical stored mask (valid
-- | kinds only, deduped, canonical order).
serializeKinds :: Array String -> String
serializeKinds ks = joinWith "," (Array.filter (\k -> elem k ks) kindNames)

letterOf :: Kind -> String
letterOf k = case k of
  Image -> "i"
  Video -> "v"
  Audio -> "a"

-- | 'image' -> 'i', 'video' -> 'v', 'audio' -> 'a' — the one-letter segment an
-- | R2 object key carries.
kindLetter :: String -> Maybe String
kindLetter s = map letterOf (parseKind s)

-- | The inverse of `kindLetter`.
letterKind :: String -> Maybe String
letterKind s = case s of
  "i" -> Just "image"
  "v" -> Just "video"
  "a" -> Just "audio"
  _ -> Nothing

isLowHex :: Char -> Boolean
isLowHex c = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')

-- | Exactly 64 lowercase hex characters — the random object-name segment.
isHex64 :: String -> Boolean
isHex64 s =
  let cs = toCharArray s
  in Array.length cs == 64 && all isLowHex cs

-- | Parse an R2 object key of the exact shape `wall/<i|v|a>/<64 lowercase hex>`
-- | and return its kind. STRICT by design — this is the claim-time mask
-- | enforcement's parser, so ANY deviation (wrong prefix, unknown letter, wrong
-- | hex length, uppercase hex, extra segments) is Nothing, never a best guess.
kindOfKey :: String -> Maybe String
kindOfKey key = case split (Pattern "/") key of
  [ "wall", l, hex ] | isHex64 hex -> letterKind l
  _ -> Nothing

mimesForKind :: Kind -> Array String
mimesForKind k = case k of
  Image -> [ "image/jpeg", "image/png", "image/webp" ]
  Video -> [ "video/mp4", "video/quicktime", "video/webm" ]
  Audio ->
    [ "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a"
    , "audio/aac", "audio/webm", "audio/ogg", "audio/wav"
    ]

-- | The exact upload/serving MIME whitelist for a kind ([] for an unknown
-- | kind). The whitelist IS the law — nothing outside it is ever accepted or
-- | served, whatever a browser claims.
mimesFor :: String -> Array String
mimesFor s = maybe [] mimesForKind (parseKind s)

-- | Lowercase and drop any `;codecs=…` (or other parameter) suffix —
-- | MediaRecorder mimeTypes arrive as e.g. `audio/webm;codecs=opus`.
normMime :: String -> String
normMime m = case Array.head (split (Pattern ";") m) of
  Just h -> toLower (trim h)
  Nothing -> toLower (trim m)

-- | Whitelist membership for a kind, case-insensitive, codecs suffix stripped.
mimeAllowed :: String -> String -> Boolean
mimeAllowed kind mime = elem (normMime mime) (mimesFor kind)

-- | Classify a MIME string by exact whitelist membership (codecs stripped,
-- | case-insensitive) — NOT bare `image/…` prefix matching, so `image/gif` or
-- | `video/x-msvideo` is Nothing, exactly as the upload gate would refuse it.
kindOfMime :: String -> Maybe String
kindOfMime mime =
  let n = normMime mime
  in Array.find (\k -> elem n (mimesFor k)) kindNames

-- | A kinds mask -> the file-input `accept` attribute ("image/*,audio/*").
-- | Broad wildcards are fine client-side (a convenience filter for the OS file
-- | picker); the MIME whitelist above is what actually gates.
acceptFor :: Array String -> String
acceptFor ks = joinWith "," (map (_ <> "/*") (Array.filter (\k -> elem k ks) kindNames))

-- | Look up a kind's byte limit in a per-kind limits record (the admin-clamped
-- | live settings both sides hold). Nothing for an unknown kind.
maxBytesFor :: String -> { image :: Number, video :: Number, audio :: Number } -> Maybe Number
maxBytesFor kind limits = case parseKind kind of
  Just Image -> Just limits.image
  Just Video -> Just limits.video
  Just Audio -> Just limits.audio
  Nothing -> Nothing
