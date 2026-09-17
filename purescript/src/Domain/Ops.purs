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
  , alertScope
  , digest
  , recoveredDigest
  , secretShort
  , leakRetellAfter
  , leakWindow
  , shouldRetell
  , leakDigest
  , noteStanding
  , shapeRetellAfter
  , shapeDigest
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

-- | A secret the egress scan cannot guard: a non-public env string shorter
-- | than the scan's floor (egress.ts MIN_SECRET_LENGTH). The subject is its
-- | NAME; a value never enters a condition.
secretShort :: String -> Condition
secretShort name = { kind: "secret_short", subject: name, detail: "" }

conditionKey :: Condition -> String
conditionKey c = c.kind <> ":" <> c.subject

conditionSubject :: Condition -> String
conditionSubject c = case c.kind of
  "backup_missing" -> "Backup missing: " <> c.subject
  "backup_failed" -> "Backup failed: " <> c.subject
  "cron_stale" -> "Cron stale: " <> c.subject
  "step_failed" -> "Cron step failed: " <> c.subject
  "secret_short" -> "Secret too short to guard: " <> c.subject
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
  "secret_short" ->
    "The worker secret " <> c.subject <> " is shorter than the egress scan's floor, so an answer carrying it "
      <> "would not be refused. Replace it with a long random value (wrangler secret put)."
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

-- | Which open conditions a chain's run may judge: its own step failures, and
-- | — when it ran the self-check — every backup, staleness and short-secret
-- | condition. A chain never clears a condition it cannot observe: the hourly
-- | chain finding no failures of its own must not "recover" the daily's
-- | missing backup.
alertScope :: { chain :: String, selfCheck :: Boolean } -> String -> Boolean
alertScope r key =
  startsWith ("step_failed:" <> r.chain <> "/")
    || (r.selfCheck && (startsWith "backup_" || startsWith "cron_stale:" || startsWith "secret_short:"))
  where
  startsWith p = S.indexOf (S.Pattern p) key == Just 0

-- | One message for everything a run raised: the first condition's subject
-- | (and how many more), every condition's subject and sentence in the body.
digest :: Array Condition -> { subject :: String, text :: String }
digest cs = case A.uncons cs of
  Nothing -> { subject: "", text: "" }
  Just { head, tail } ->
    { subject: conditionSubject head <> more tail
    , text: S.joinWith "\n\n" (map (\c -> conditionSubject c <> "\n" <> conditionText c) cs)
    }

-- | And one for what a run cleared.
recoveredDigest :: Array String -> { subject :: String, text :: String }
recoveredDigest keys = case A.uncons keys of
  Nothing -> { subject: "", text: "" }
  Just { head, tail } ->
    { subject: recoveredSubject head <> more tail
    , text: S.joinWith "\n" (map recoveredText keys)
    }

more :: forall a. Array a -> String
more tail = if A.null tail then "" else " (+" <> show (A.length tail) <> " more)"

-- | The egress guard (egress.ts, 2026-09-17). A refused answer, a refused hub
-- | frame, or a handler that tried to enumerate or serialize the sealed env is
-- | a LEAK NOTE: its key is the kind and the site (the route or the object). A note is told at
-- | once and, while it keeps happening, at most once an hour: the owner must
-- | hear of a leak attempt now, and must not have the channel flooded by a
-- | route that trips on every request.
leakRetellAfter :: Int
leakRetellAfter = 3600

-- | How long a note keeps the health verdict red (`readOps.ok`), so the
-- | outside watchdog fails its run too: a day.
leakWindow :: Int
leakWindow = 86400

-- | `told` is when the note was last told (0 = never); `quiet` is its kind's
-- | quiet time (`leakRetellAfter`, `shapeRetellAfter`).
shouldRetell :: { told :: Int, now :: Int, quiet :: Int } -> Boolean
shouldRetell r = r.told <= 0 || r.now - r.told >= r.quiet

-- | Whether a note (a leak, a broken shape) seen `last` still stands at `now`.
noteStanding :: { last :: Int, now :: Int } -> Boolean
noteStanding r = r.last > 0 && r.now - r.last < leakWindow

-- | The alert for one note. `names` are the secret NAMES the answer or frame
-- | carried (empty for an enumeration); a value never reaches this function.
leakDigest :: { kind :: String, site :: String, names :: Array String, n :: Int } -> { subject :: String, text :: String }
leakDigest r =
  { subject: head <> r.site
  , text: body <> "\n\n" <> seen <> "\n\n" <> advice
  }
  where
  head = case r.kind of
    "answer" -> "Answer refused (it carried a secret): "
    "frame" -> "Hub frame refused (it carried a secret): "
    _ -> "The sealed env was enumerated: "
  names = if A.null r.names then "" else " It carried: " <> S.joinWith ", " r.names <> "."
  body = case r.kind of
    "answer" -> "The worker was about to send " <> r.site <> " an answer containing the value of a secret. The guard replaced it with a 500." <> names
    "frame" -> "A live frame from " <> r.site <> " contained the value of a secret. The guard dropped it." <> names
    _ -> "A handler behind " <> r.site <> " tried to copy, list or serialize the worker env. The seal refused it (a 500, or a caught throw)."
  seen = "Seen " <> show r.n <> " time" <> (if r.n == 1 then "" else "s") <> " so far; while it continues you hear of it at most once an hour."
  advice = "Nothing left the worker. Find the handler (Workers Logs: egress_blocked / env_enumerated) and fix it; if you cannot rule out an earlier leak, rotate the named secrets (CICD.md §4)."

-- | A broken shape (Domain.Wire, 2026-09-17): an answer whose listed field was
-- | neither a list nor null. The answer still went — a reader's view refuses
-- | it — so the owner hears once a day per road, not once an hour.
shapeRetellAfter :: Int
shapeRetellAfter = 86400

shapeDigest :: { site :: String, fields :: Array String, n :: Int } -> { subject :: String, text :: String }
shapeDigest r =
  { subject: "Answer with a broken shape: " <> r.site
  , text: "The worker answered " <> r.site <> " with " <> S.joinWith ", " r.fields
      <> " holding something other than the list Domain.Wire promises. Readers' views refuse such an answer "
      <> "(\"could not be loaded\"), so the road is broken for them until it is fixed. Seen "
      <> show r.n <> " time" <> (if r.n == 1 then "" else "s") <> "; you hear of it at most once a day. "
      <> "Workers Logs: shape_broken."
  }
