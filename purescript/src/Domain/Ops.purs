-- | Operations: how the worker knows something is wrong, and whom it tells.
-- |
-- | Born of the 2026-09-16 review. The platform logged sixty-one `*_failed`
-- | events that nobody read, backed the ledger up once a month with no word
-- | when it did not, and had no health endpoint. The owner's ruling: the alert
-- | channels are Platform settings — an email address (sent through the same
-- | `send_email` road as the contact form) and a Discord webhook — and the
-- | owner picks email, Discord or both. The rules live here; the worker
-- | (`alerts.ts`, `ops.ts`) only fetches, stores and sends.
-- |
-- | Three rules, each single-sourced:
-- |  * the channel rule — a channel is live when its switch is on AND its field
-- |    holds a value the validator accepts; empty or off is silent;
-- |  * the backup contract — the daily object's key, what the prune keeps
-- |    (90 days; a first-of-month object 400), the smallest plausible dump;
-- |  * the watchdog — a cron's heartbeat is stale after `staleAfter` seconds,
-- |    and `foldOpsAlerts` coalesces: a condition alerts once when it opens and
-- |    once more when it closes ("Recovered"), never twice a day while it lasts.
module Domain.Ops
  ( isEmailAddress
  , switchOn
  , channelsFrom
  , backupPrefix
  , backupKey
  , dayOfKey
  , keepDays
  , keepMonthlyDays
  , keepBackup
  , minBackupBytes
  , staleAfter
  , isStale
  , Condition
  , backupMissing
  , backupFailed
  , cronStale
  , stepFailed
  , conditionKey
  , conditionSubject
  , conditionText
  , recoveredSubject
  , recoveredText
  , foldOpsAlerts
  ) where

import Prelude

import Data.Array as A
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Data.String as S
import Data.String.CodeUnits (takeRight, toCharArray)

-- | The contact form's shape (`^[^\s@]+@[^\s@]+\.[^\s@]+$`) and no empty label:
-- | one `@`, no whitespace either side, a domain of at least two non-empty
-- | dot-separated parts, at most 254 characters. Not RFC 5322 — the address is
-- | the owner's own, typed once; the rule exists so a typo is refused at the
-- | settings door instead of failing silently at the first alert.
isEmailAddress :: String -> Boolean
isEmailAddress s = S.length s <= 254 && case S.split (S.Pattern "@") s of
  [ local, domain ] -> clean local && clean domain && labelsOk domain
  _ -> false
  where
  clean part = part /= "" && not (A.any isSpace (toCharArray part))
  isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'
  labelsOk d =
    let parts = S.split (S.Pattern ".") d
    in A.length parts >= 2 && A.all (_ /= "") parts

-- | A stored switch is on only as the literal "1" — the polarity every other
-- | admin switch in `app_settings` carries (`calls_enabled`, `media_enabled`).
switchOn :: String -> Boolean
switchOn v = v == "1"

-- | Where an alert goes, as channel tags in a fixed order. The caller passes
-- | the stored switches and whether each field passed its validator (the
-- | email one is `isEmailAddress`; the Discord one is the worker's SSRF gate,
-- | `isDiscordWebhook`). Empty or off is silent; both on is both.
channelsFrom :: { emailOn :: String, emailOk :: Boolean, discordOn :: String, discordOk :: Boolean } -> Array String
channelsFrom r =
  (if switchOn r.emailOn && r.emailOk then [ "email" ] else [])
    <> (if switchOn r.discordOn && r.discordOk then [ "discord" ] else [])

backupPrefix :: String
backupPrefix = "backups/comments-"

-- | The daily object, keyed by its UTC day: `backups/comments-2026-09-16.sql.gz`.
-- | The monthly cron wrote the same shape on the first of the month, so the
-- | objects from before the daily cadence are first-of-month objects under
-- | this rule and keep their longer life.
backupKey :: String -> String
backupKey day = backupPrefix <> day <> ".sql.gz"

dayOfKey :: String -> Maybe String
dayOfKey key = do
  rest <- S.stripPrefix (S.Pattern backupPrefix) key
  day <- S.stripSuffix (S.Pattern ".sql.gz") rest
  if S.length day == 10 then Just day else Nothing

keepDays :: Int
keepDays = 90

keepMonthlyDays :: Int
keepMonthlyDays = 400

-- | What the prune keeps: a daily object for 90 days, a first-of-month object
-- | for 400 (the monthly history survives the daily cadence), and anything
-- | whose key this module does not recognise — the prune deletes only what
-- | this rule names.
keepBackup :: { key :: String, ageDays :: Int } -> Boolean
keepBackup r = case dayOfKey r.key of
  Nothing -> true
  Just day -> r.ageDays <= (if takeRight 2 day == "01" then keepMonthlyDays else keepDays)

-- | A dump smaller than this is not a backup (the schema alone gzips larger);
-- | the self-check treats it as missing.
minBackupBytes :: Int
minBackupBytes = 1024

-- | How long a heartbeat may go unrenewed before the cron is presumed dead:
-- | more than two periods for the hourly, a day plus slack for the dailies,
-- | a month plus slack for the monthly.
staleAfter :: String -> Int
staleAfter name = case name of
  "hourly" -> 3 * 3600
  "daily" -> 26 * 3600
  "usage" -> 26 * 3600
  "monthly" -> 33 * 86400
  _ -> 26 * 3600

-- | A heartbeat that never beat is not stale: the first beat starts the clock
-- | (a fresh deploy must not alert about a monthly cron that is 33 days away).
-- | The health panel shows "never" for a human to judge.
isStale :: { name :: String, last :: Int, now :: Int } -> Boolean
isStale r = r.last > 0 && r.now - r.last > staleAfter r.name

-- | A condition is what the self-check found wrong: its kind, the thing it is
-- | about, and a detail. `conditionKey` is its identity for coalescing.
type Condition = { kind :: String, subject :: String, detail :: String }

backupMissing :: String -> Condition
backupMissing key = { kind: "backup_missing", subject: key, detail: "" }

backupFailed :: String -> String -> Condition
backupFailed key err = { kind: "backup_failed", subject: key, detail: err }

cronStale :: String -> Int -> Condition
cronStale name ageSecs = { kind: "cron_stale", subject: name, detail: show ageSecs }

stepFailed :: String -> String -> String -> Condition
stepFailed chain step err = { kind: "step_failed", subject: chain <> "/" <> step, detail: err }

conditionKey :: Condition -> String
conditionKey c = c.kind <> ":" <> c.subject

conditionSubject :: Condition -> String
conditionSubject c = case c.kind of
  "backup_missing" -> "Backup missing: " <> c.subject
  "backup_failed" -> "Backup failed: " <> c.subject
  "cron_stale" -> "Cron stale: " <> c.subject
  "step_failed" -> "Cron step failed: " <> c.subject
  _ -> c.kind <> ": " <> c.subject

conditionText :: Condition -> String
conditionText c = case c.kind of
  "backup_missing" ->
    "The backup object " <> c.subject <> " is not in the bucket, or is smaller than "
      <> show minBackupBytes <> " bytes. The 03:15 UTC cron did not run, or its dump failed without leaving a record."
  "backup_failed" -> "Writing " <> c.subject <> " failed: " <> c.detail
  "cron_stale" ->
    "The " <> c.subject <> " cron last beat " <> hours c.detail <> " ago; it is presumed dead after "
      <> show (staleAfter c.subject / 3600) <> " hours."
  "step_failed" -> "The cron step " <> c.subject <> " threw: " <> c.detail <> ". The other steps of its chain still ran."
  _ -> c.detail
  where
  hours secs = case Int.fromString secs of
    Just n -> show (n / 3600) <> " hours"
    Nothing -> secs <> " seconds"

recoveredSubject :: String -> String
recoveredSubject key = "Recovered: " <> key

recoveredText :: String -> String
recoveredText key = "The condition " <> key <> " is no longer present."

-- | The coalescing fold. `open` is the set of condition keys already alerted
-- | and still standing (stored between runs); `conditions` is what this run
-- | found. Fires what is new, clears what went away, and hands back the new
-- | `open` set — sorted and deduplicated, so the stored state is canonical and
-- | a run that finds the same trouble twice says nothing new.
foldOpsAlerts :: { open :: Array String, conditions :: Array Condition } -> { open :: Array String, fire :: Array Condition, clear :: Array String }
foldOpsAlerts r =
  let
    found = A.nubByEq (\a b -> conditionKey a == conditionKey b) r.conditions
    keys = A.sort (map conditionKey found)
    fire = A.filter (\c -> not (A.elem (conditionKey c) r.open)) found
    clear = A.filter (\k -> not (A.elem k keys)) r.open
  in
    { open: keys, fire, clear }
