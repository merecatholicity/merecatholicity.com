-- | Direct-message rules shared by the client and the worker.
-- |
-- | The disappearing-message LIFETIMES (24h / 7d / 30d) — duplicated as
-- | `DM_TTLS` in comments.js AND the worker before this module; `ttlLabel`
-- | mirrors comments.js dmTtlLabel's thresholds, and the caller coerces a
-- | missing/zero value to `defaultTtl` first (the barrel does
-- | `Number(ttl) || defaultTtl`). The REPLY-QUOTE excerpt rule: a reply carries
-- | a short quote of what it answers inside the end-to-end-encrypted plaintext
-- | (the server never sees what answers what), marked by an untypeable sentinel
-- | character; the excerpt's length and whitespace rule are decided here. The
-- | per-message REACTION grammar (2026-09-10, the WhatsApp press-and-hold
-- | picker) was born here and moved to Domain.Reaction on 2026-09-12 when the
-- | board and the feed gained the same picker; it is re-exported from here so
-- | every DM reader still finds it where it always was. The MEMBER model
-- | (2026-09-13): a conversation is a thread with member rows — a pair is two
-- | of them, a group up to `maxMembers` — and its rules live here: the cap, the
-- | group name, the envelope tags (`enc` 3 = a content key per message sealed
-- | once per member), the roster equality the worker checks a sealed message
-- | against, the system-line grammar ("X added Y", "X left", "X named…"), the
-- | reaction tally the pill paints, the ✓✓ rule, and the author colours.
module Domain.Dm
  ( ttlOptions
  , ttlLabel
  , defaultTtl
  , mediaMaxSeconds
  , module Domain.Reaction
  , replySentinel
  , replyExcerptMax
  , replyExcerpt
  , maxMembers
  , typingFanCap
  , inboxAvatars
  , groupNameMax
  , normalizeGroupName
  , encPlain
  , encPair
  , encSystem
  , encSealed
  , envPairTag
  , envSealedTag
  , membersEqual
  , SysLine(..)
  , sysAddLine
  , sysLeaveLine
  , sysNameLine
  , missedCallLine
  , parseSysLine
  , sysLineTag
  , sysLineText
  , forwardedLabel
  , tallyReactions
  , readByAll
  , memberHue
  ) where

import Prelude

import Data.Array (all, filter, findIndex, foldl, modifyAt, nub, null, snoc, sort, sortBy, unsnoc)
import Data.Char (fromCharCode)
import Data.Int (fromStringAs, hexadecimal)
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.String (Pattern(..), joinWith, split, stripPrefix, trim)
import Data.String.CodePoints as CP
import Data.String.CodeUnits as CU
import Data.String.Regex (Regex, replace)
import Data.String.Regex.Flags (global)
import Data.String.Regex.Unsafe (unsafeRegex)
import Domain.Reaction (quickReactions, reactionMaxUnits, isCustomReaction, normalizeReaction)

-- | The three chooser options in order: 24h / 7d / 30d.
ttlOptions :: Array { secs :: Int, label :: String }
ttlOptions =
  [ { secs: 86400, label: "24 hours" }
  , { secs: 604800, label: "7 days" }
  , { secs: 2592000, label: "30 days" }
  ]

-- | The default lifetime for a conversation with no explicit TTL set: 30 days.
-- | Single-sourced into the worker's `dm_default_ttl` app-setting default and the
-- | client's dmTtlLabel coercion, so "the default" lives in exactly one place.
defaultTtl :: Int
defaultTtl = 2592000

-- | The HARD cap on how long any DM media attachment may persist — 30 days from
-- | upload — enforced by the sweep even for SAVED messages (you can keep the text
-- | forever, but the media is gone within 30 days). Independent of `ttlOptions`.
mediaMaxSeconds :: Int
mediaMaxSeconds = 2592000

-- | The label for a lifetime in seconds: <= 24h → "24 hours", >= 30d → "30 days",
-- | anything between → "7 days".
ttlLabel :: Int -> String
ttlLabel secs
  | secs <= 86400 = "24 hours"
  | secs >= 2592000 = "30 days"
  | otherwise = "7 days"

-- | The character that opens a reply envelope inside the E2E plaintext:
-- | U+0001, which no keyboard produces and the worker's CONTROL_RE refuses in
-- | any plaintext it can see. Plaintext that does not begin with it is the
-- | bare message it always was, so every older message still reads.
replySentinel :: String
replySentinel = maybe "" CU.singleton (fromCharCode 1)

-- | How much of the quoted message a reply carries, in code points.
replyExcerptMax :: Int
replyExcerptMax = 160

wsRe :: Regex
wsRe = unsafeRegex "\\s+" global

-- | The quote a reply keeps of what it answers: whitespace runs (line breaks
-- | included) folded to one space, trimmed, and cut to `replyExcerptMax` code
-- | points with an ellipsis when it was longer. Counted in code points, never
-- | UTF-16 units, so an emoji is never split in half.
replyExcerpt :: String -> String
replyExcerpt raw =
  let s = trim (replace wsRe " " raw)
  in
    if CP.length s <= replyExcerptMax then s
    else trim (CP.take replyExcerptMax s) <> "…"

-- | The most members a conversation may hold (the owner's cap, 2026-09-13).
-- | Every message carries one sealed content key per member, so the cap is
-- | the free tier's arithmetic as much as a social choice.
maxMembers :: Int
maxMembers = 25

-- | How many members one typing signal may be fanned to: everyone but the
-- | typist.
typingFanCap :: Int
typingFanCap = maxMembers - 1

-- | How many avatars a group's inbox row shows in its collage.
inboxAvatars :: Int
inboxAvatars = 4

-- | The longest group name, in code points.
groupNameMax :: Int
groupNameMax = 60

ctlRe :: Regex
ctlRe = unsafeRegex "[\\x00-\\x1f\\x7f]" global

-- | A group name as stored: control characters dropped, whitespace runs folded
-- | to one space, trimmed, cut to `groupNameMax` code points. Nothing when
-- | nothing is left — the caller keeps the old name, or clears it.
normalizeGroupName :: String -> Maybe String
normalizeGroupName raw =
  let s = trim (CP.take groupNameMax (trim (replace wsRe " " (replace ctlRe "" raw))))
  in if s == "" then Nothing else Just s

-- | How `dms.enc` marks a body: 0 plaintext (legacy), 1 the pair's box ("E1.",
-- | one ciphertext both sides open), 2 a system line in the clear, 3 the
-- | sealed envelope ("E3.", 2026-09-13: a random content key per message,
-- | boxed once per member — a member added later has no key for earlier
-- | words, a member who left has none for later ones).
encPlain :: Int
encPlain = 0

encPair :: Int
encPair = 1

encSystem :: Int
encSystem = 2

encSealed :: Int
encSealed = 3

envPairTag :: String
envPairTag = "E1."

envSealedTag :: String
envSealedTag = "E3."

-- | Whether two member lists name the same set (order and repeats aside): the
-- | worker's check that a sealed message covers exactly the current members,
-- | and the client's own before it seals.
membersEqual :: Array String -> Array String -> Boolean
membersEqual a b = sort (nub a) == sort (nub b)

-- | A system line: a plaintext (`enc` 2) word the server writes into the
-- | thread about the thread itself. Never message content.
data SysLine
  = SysAdd (Array String)
  | SysLeave
  | SysName String
  | SysMissedCall

-- | "sys:add:<hash>,<hash>" — the actor added these members.
sysAddLine :: Array String -> String
sysAddLine hs = "sys:add:" <> joinWith "," hs

-- | "sys:leave" — the actor left.
sysLeaveLine :: String
sysLeaveLine = "sys:leave"

-- | "sys:name:<name>" — the actor named the conversation.
sysNameLine :: String -> String
sysNameLine n = "sys:name:" <> n

-- | "call:missed" — the caller's line for a call nobody answered (2026-09-12).
missedCallLine :: String
missedCallLine = "call:missed"

-- | The grammar, read back. Anything else is not a system line.
parseSysLine :: String -> Maybe SysLine
parseSysLine s
  | s == sysLeaveLine = Just SysLeave
  | s == missedCallLine = Just SysMissedCall
  | otherwise = case stripPrefix (Pattern "sys:add:") s of
      Just rest -> Just (SysAdd (filter (_ /= "") (split (Pattern ",") rest)))
      Nothing -> case stripPrefix (Pattern "sys:name:") s of
        Just n -> Just (SysName n)
        Nothing -> Nothing

-- | The ADT erased to a plain record the membrane hands the client (the
-- | erasure done here, so it survives a constructor rename — `routeTag`'s way).
sysLineTag :: SysLine -> { tag :: String, hashes :: Array String, name :: String }
sysLineTag l = case l of
  SysAdd hs -> { tag: "add", hashes: hs, name: "" }
  SysLeave -> { tag: "leave", hashes: [], name: "" }
  SysName n -> { tag: "name", hashes: [], name: n }
  SysMissedCall -> { tag: "missed-call", hashes: [], name: "" }

-- | The sentence a system line reads, given the actor's shown name and a way
-- | to name any member. "Ann added Bob and Cy" / "Ann left" / "Ann named the
-- | conversation “Choir”"; the missed call keeps its own renderer (by side).
sysLineText :: String -> (String -> String) -> SysLine -> String
sysLineText actor nameOf l = case l of
  SysAdd hs -> actor <> " added " <> listNames (map nameOf hs)
  SysLeave -> actor <> " left"
  SysName n -> actor <> " named the conversation “" <> n <> "”"
  SysMissedCall -> "Missed voice call"

-- | "Bob" / "Bob and Cy" / "Bob, Cy and Di" / "nobody".
listNames :: Array String -> String
listNames ns = case unsnoc ns of
  Nothing -> "nobody"
  Just { init, last } -> if null init then last else joinWith ", " init <> " and " <> last

-- | The small line a forwarded message wears (the owner's choice, 2026-09-13).
-- | It rides INSIDE the end-to-end plaintext: the server never learns that a
-- | word was forwarded, nor from where.
forwardedLabel :: String
forwardedLabel = "Forwarded"

-- | The pill's cells from the ledger's rows: one per emoji with its count,
-- | most-given first, ties by emoji — one reaction per member per message.
tallyReactions :: Array { hash :: String, emoji :: String } -> Array { e :: String, n :: Int }
tallyReactions rows = sortBy order (foldl add [] rows)
  where
  add acc r = case findIndex (\c -> c.e == r.emoji) acc of
    Just i -> fromMaybe acc (modifyAt i (\c -> c { n = c.n + 1 }) acc)
    Nothing -> snoc acc { e: r.emoji, n: 1 }
  order x y = case compare y.n x.n of
    EQ -> compare x.e y.e
    o -> o

-- | Whether every OTHER current member has read a word: their read stamp
-- | reaches its moment. `leftAt` 0 = still here, `readAt` 0 = never. False
-- | when nobody else remains — a word nobody can read is not "read by all".
readByAll :: Int -> String -> Array { hash :: String, readAt :: Int, leftAt :: Int } -> Boolean
readByAll createdAt me members =
  let others = filter (\m -> m.hash /= me && m.leftAt == 0) members
  in not (null others) && all (\m -> m.readAt >= createdAt) others

-- | A member's colour slot for their author line in a group (0–7), from the
-- | hash alone so it is the same on every screen: its first byte, mod 8.
memberHue :: String -> Int
memberHue h = maybe 0 (\n -> n `mod` 8) (fromStringAs hexadecimal (CU.take 2 h))
