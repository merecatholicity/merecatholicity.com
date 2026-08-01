-- | User preference rules for the settings gear, single-sourced so the worker
-- | (which GATES delivery) and the client (which renders the toggles) agree.
-- | Read receipts: a mode of "off" stops receipts flowing in BOTH directions for
-- | that member (they send none AND see none) — reciprocal by design. Notify
-- | prefs: one per notification kind, stored as an int column that is 1 (on, the
-- | default) or 0 (off); a NULL column is coerced to 1 at the boundary, so a
-- | member who never touched a toggle gets everything.
module Domain.Prefs (receiptsOn, notifyOn, notifyKinds) where

import Prelude

-- | Do read receipts flow for a member with this mode? "off" is the only silence.
receiptsOn :: String -> Boolean
receiptsOn mode = mode /= "off"

-- | Is a notification kind enabled, given its stored column value (0 = off,
-- | anything else including the NULL-default 1 = on)?
notifyOn :: Int -> Boolean
notifyOn v = v /= 0

-- | The three notification kinds a member can switch off (server-checked at
-- | delivery). Turning "dm" off silences only the bell — the message still
-- | arrives and the inbox unread badge still updates (separate paths).
notifyKinds :: Array String
notifyKinds = [ "reply", "mention", "dm" ]
