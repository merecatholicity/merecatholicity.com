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
  , sectionNames
  , parseSection
  , sectionKindBytesKey
  , sectionScanKey
  , sectionVoiceKey
  , sectionAudioSecondsKey
  , sectionRetentionKey
  , defaults
  , clampKindBytes
  , clampAudioSeconds
  , clampCapBytes
  , clampRetentionDays
  , clampDmRetentionDays
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

-- | The three media sections — the surfaces attachments live on. The wire form
-- | is the lowercase name ("dm" = the Inbox, "wall" = the Feed and member
-- | walls, "board" = the community forum); like Kind, the ADT never crosses
-- | the JS boundary.
data Section = SDm | SWall | SBoard

printSection :: Section -> String
printSection s = case s of
  SDm -> "dm"
  SWall -> "wall"
  SBoard -> "board"

parseSection' :: String -> Maybe Section
parseSection' s = case s of
  "dm" -> Just SDm
  "wall" -> Just SWall
  "board" -> Just SBoard
  _ -> Nothing

-- | The section names in canonical order (dm, wall, board).
sectionNames :: Array String
sectionNames = map printSection [ SDm, SWall, SBoard ]

-- | Normalize a section string — Just the canonical name, or Nothing for junk.
parseSection :: String -> Maybe String
parseSection s = map printSection (parseSection' s)

-- | The app_settings key grammar for the per-section knobs — the ONE place the
-- | key names live, so the worker membrane and the admin UI can never drift.
-- | Each builder answers Nothing for an unknown section (or kind), and the
-- | worker treats Nothing as "no such knob".

-- | `media_<section>_<kind>_max_bytes` — the per-section per-kind size limit
-- | (an OVERRIDE: absent means inherit the legacy global `media_<kind>_max_bytes`).
sectionKindBytesKey :: String -> String -> Maybe String
sectionKindBytesKey sec kind = case parseSection' sec, parseKind kind of
  Just s, Just k -> Just ("media_" <> printSection s <> "_" <> printKind k <> "_max_bytes")
  _, _ -> Nothing

-- | `media_scan_<section>` — the per-section AI image screen toggle. THE DM
-- | CASE IS Nothing BY CONSTRUCTION: DM media is end-to-end encrypted, the
-- | server holds only ciphertext, and scanning it is structurally impossible —
-- | so no key exists for anyone to flip. The E2E law, in the type.
sectionScanKey :: String -> Maybe String
sectionScanKey sec = case parseSection' sec of
  Just SWall -> Just "media_scan_wall"
  Just SBoard -> Just "media_scan_board"
  _ -> Nothing

-- | `media_voice_<section>` — the per-section voice-recorder feature flag
-- | (client-advisory: the server cannot tell a voice note from a file upload).
sectionVoiceKey :: String -> Maybe String
sectionVoiceKey sec = map (\s -> "media_voice_" <> printSection s) (parseSection' sec)

-- | `media_audio_max_seconds_<section>` — the per-section voice-note length
-- | (an OVERRIDE: absent means inherit the legacy global `media_audio_max_seconds`).
sectionAudioSecondsKey :: String -> Maybe String
sectionAudioSecondsKey sec = map (\s -> "media_audio_max_seconds_" <> printSection s) (parseSection' sec)

-- | `media_<section>_retention_days` — the per-section media age retention.
-- | For wall/board 0 means keep forever (the default); the DM knob replaces the
-- | old hardcoded 30-day cap and can never be "forever" (ephemeral by contract).
sectionRetentionKey :: String -> Maybe String
sectionRetentionKey sec = map (\s -> "media_" <> printSection s <> "_retention_days") (parseSection' sec)

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
  , capBoardBytes :: Number
  , autocompress :: Boolean
  , scanWall :: Boolean
  , scanBoard :: Boolean
  , voiceDm :: Boolean
  , voiceWall :: Boolean
  , voiceBoard :: Boolean
  , retentionWallDays :: Int
  , retentionBoardDays :: Int
  }
defaults =
  { imageMaxBytes: 10485760.0    -- 10 MB
  , videoMaxBytes: 15728640.0    -- 15 MB
  , audioMaxBytes: 5242880.0     -- 5 MB
  , audioMaxSeconds: 180
  , kindsDm: "image,video,audio"
  , kindsWall: "image,video,audio"
  , kindsBoard: "image,video,audio"
  , capDmBytes: 2147483648.0     -- 2 GB
  , capWallBytes: 3221225472.0   -- 3 GB, the feed's own budget (board split out)
  , capBoardBytes: 1073741824.0  -- 1 GB, the forum's budget
  , autocompress: true
  , scanWall: true               -- AI image screen on the feed (today's behavior)
  , scanBoard: true              -- and on the forum; DMs have NO flag — E2E, unscannable
  , voiceDm: true                -- the 🎙 recorder, per section
  , voiceWall: true
  , voiceBoard: true
  , retentionWallDays: 0         -- media age retention; 0 = keep forever
  , retentionBoardDays: 0        -- (the DM default rides Dm.mediaMaxSeconds)
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

-- | Clamp a wall/board media retention setting: 0 (= keep forever, and the
-- | floor — 0 must SURVIVE the clamp) .. 3650 days.
clampRetentionDays :: Number -> Number
clampRetentionDays n = max 0.0 (min 3650.0 n)

-- | Clamp the DM media retention setting: 1 .. 90 days — DM media is ephemeral
-- | by contract and can never be set to "forever".
clampDmRetentionDays :: Number -> Number
clampDmRetentionDays n = max 1.0 (min 90.0 n)

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
