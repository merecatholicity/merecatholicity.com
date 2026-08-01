-- | Client-side mute: a purely local list of hashes whose forum posts collapse
-- | for this reader alone (no server, orthogonal to the DM block). The list lives
-- | in localStorage (`mc-muted`); the membership + toggle DECISIONS are pure here,
-- | the storage I/O stays in comments.js.
module Domain.Mute (isMuted, toggleMute) where

import Prelude
import Data.Array (deleteAt, elemIndex, snoc)
import Data.Maybe (Maybe(..), fromMaybe, isJust)

-- | Bot-exempt, non-empty membership. The librarian (its fixed hash) can never be
-- | muted — it speaks only when summoned, so a muted bot reads as a broken
-- | summons, and a stale stored mute of it is ignored too.
isMuted :: String -> String -> Array String -> Boolean
isMuted bot hash list = hash /= bot && hash /= "" && isJust (elemIndex hash list)

-- | Toggle a hash in the list: add if absent, remove if present. `added` is true
-- | when it was added (mirrors the classic toggleMute return). The caller writes
-- | `list` back to localStorage.
toggleMute :: String -> Array String -> { list :: Array String, added :: Boolean }
toggleMute hash list = case elemIndex hash list of
  Just i -> { list: fromMaybe list (deleteAt i list), added: false }
  Nothing -> { list: snoc list hash, added: true }
