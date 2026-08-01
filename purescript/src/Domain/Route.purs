-- | The forum's URL router as a typed decision. `comments.js route()` was a
-- | priority ladder of `if (params.get('x')) return viewX()` checks; the ORDER is
-- | load-bearing (e.g. `?merecat=1&topic=5` must open merecat, not the topic).
-- | `parseRoute` is that ladder as one pure, exhaustive function returning a
-- | `Route`; the view dispatch (the effects) stays in JS.
-- |
-- | Boundary contract: string params arrive as `Nullable String` — "truthy" means
-- | present AND non-empty (URLSearchParams.get('x') is '' for a bare `?x`), while
-- | `merecatthreads`/`q` match on mere PRESENCE (the classic used `!== null`).
-- | `topic` arrives pre-validated as `Nullable Int`: the JS boundary runs
-- | `Number()` + `Number.isInteger` + `> 0` (those coercion quirks belong in JS),
-- | and passes the id or null. `merecatthread` keeps its raw string; the dispatch
-- | re-runs `Number()` on it exactly as the classic did.
module Domain.Route (Route(..), parseRoute, routeTag) where

import Prelude
import Data.Maybe (Maybe(..), fromMaybe, isJust)
import Data.Nullable (Nullable, toMaybe)

type Params =
  { ipbans :: Nullable String
  , settings :: Nullable String
  , admins :: Nullable String
  , admin :: Nullable String
  , merecatadmin :: Nullable String
  , merecatthread :: Nullable String
  , merecatthreads :: Nullable String
  , merecat :: Nullable String
  , notifications :: Nullable String
  , inbox :: Nullable String
  , users :: Nullable String
  , q :: Nullable String
  , dm :: Nullable String
  , me :: Nullable String
  , profile :: Nullable String
  , audit :: Nullable String
  , topic :: Nullable Int
  , cat :: Nullable String
  }

data Route
  = RIpBans
  | RSettings
  | RAdmins
  | RAdminHome
  | RMerecatAdmin
  | RMerecatThread String
  | RMerecatThreads
  | RMerecat
  | RNotifications
  | RInbox
  | RUsers
  | RSearch
  | RDm String
  | RMe
  | RProfile String
  | RAudit
  | RTopic Int
  | RCat String
  | RIndex

-- | present AND non-empty (`if (params.get('x'))` in the classic).
truthy :: Nullable String -> Boolean
truthy n = case toMaybe n of
  Just s -> s /= ""
  Nothing -> false

-- | merely present (the classic `!== null`).
present :: Nullable String -> Boolean
present = isJust <<< toMaybe

str :: Nullable String -> String
str = fromMaybe "" <<< toMaybe

-- | The priority ladder, in the exact order of the classic route().
parseRoute :: Params -> Route
parseRoute p =
  if truthy p.ipbans then RIpBans
  else if truthy p.settings then RSettings
  else if truthy p.admins then RAdmins
  else if truthy p.admin then RAdminHome
  else if truthy p.merecatadmin then RMerecatAdmin
  else if truthy p.merecatthread then RMerecatThread (str p.merecatthread)
  else if present p.merecatthreads then RMerecatThreads
  else if truthy p.merecat then RMerecat
  else if truthy p.notifications then RNotifications
  else if truthy p.inbox then RInbox
  else if truthy p.users then RUsers
  else if present p.q then RSearch
  else if truthy p.dm then RDm (str p.dm)
  else if truthy p.me then RMe
  else if truthy p.profile then RProfile (str p.profile)
  else if truthy p.audit then RAudit
  else case toMaybe p.topic of
    Just n -> RTopic n
    Nothing -> if truthy p.cat then RCat (str p.cat) else RIndex

-- | Erase the ADT to a plain `{tag, s, n}` the JS dispatch reads (the membrane
-- | does the erasure in PS, so it survives a constructor rename).
routeTag :: Route -> { tag :: String, s :: String, n :: Int }
routeTag r = case r of
  RIpBans -> t "IpBans"
  RSettings -> t "Settings"
  RAdmins -> t "Admins"
  RAdminHome -> t "AdminHome"
  RMerecatAdmin -> t "MerecatAdmin"
  RMerecatThread s -> ts "MerecatThread" s
  RMerecatThreads -> t "MerecatThreads"
  RMerecat -> t "Merecat"
  RNotifications -> t "Notifications"
  RInbox -> t "Inbox"
  RUsers -> t "Users"
  RSearch -> t "Search"
  RDm s -> ts "Dm" s
  RMe -> t "Me"
  RProfile s -> ts "Profile" s
  RAudit -> t "Audit"
  RTopic n -> tn "Topic" n
  RCat s -> ts "Cat" s
  RIndex -> t "Index"
  where
  t tag = { tag, s: "", n: 0 }
  ts tag s = { tag, s, n: 0 }
  tn tag n = { tag, s: "", n }
