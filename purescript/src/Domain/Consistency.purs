-- | Which requests may read a D1 read replica (2026-09-17). The comments
-- | database is one single-threaded primary; the Sessions API lets a request
-- | read a replica instead, at the price of seeing the database as it stood a
-- | moment ago. That price is safe for a pure read and dangerous for a write
-- | that decides on what it just read (the DM media reference count before a
-- | purge, the roster a sealed message must equal, the live media budget). So
-- | the rule is an ALLOWLIST: a route named here starts its session anywhere
-- | (or from the browser's bookmark, so a member always sees their own last
-- | write); every other route starts at the primary. A request that wrote
-- | hands the browser a bookmark cookie (`cookieName`), and the next request
-- | starts at least that fresh. A route joins the list only when its handler
-- | writes nothing a later statement of the same request depends on, and is
-- | not the gate of a write.
module Domain.Consistency
  ( cookieName
  , cookieMaxAge
  , replicaRoutes
  , readsReplica
  , isWriteSql
  , bookmarkOk
  ) where

import Prelude

import Data.Array as A
import Data.String as S
import Data.String.CodeUnits (toCharArray)

-- | The cookie that carries a request's last write bookmark to the next one.
cookieName :: String
cookieName = "mc-d1"

-- | How long a bookmark is worth keeping, in seconds. Replica lag is well under
-- | a second; five minutes covers a slow tab without pinning a browser to the
-- | primary for ever.
cookieMaxAge :: Int
cookieMaxAge = 300

-- | The read routes, as "METHOD path". Each was read for writes on
-- | 2026-09-17 and none writes. Deliberately absent: `/dm/thread` (opening a
-- | conversation stamps the read mark and starts the disappearing clock from
-- | the lifetime it just read — a stale replica would start it wrong),
-- | `/dm/roster` (a sealed send must match the live roster), `/dm/media/get`
-- | (a member who left is refused at once), `/call/pending` (the ring), and
-- | every route that writes.
replicaRoutes :: Array String
replicaRoutes =
  [ "GET /api/comments"
  , "GET /api/comments/config"
  , "GET /api/comments/feed"
  , "GET /api/comments/journal"
  , "GET /api/comments/board"
  , "GET /api/comments/board/cat"
  , "GET /api/comments/board/author"
  , "GET /api/comments/board/topic"
  , "GET /api/comments/search"
  , "GET /api/comments/profile"
  , "GET /api/comments/recent"
  , "POST /api/comments/dm/threads"
  , "POST /api/comments/dm/unread"
  , "POST /api/comments/dm/presence"
  , "POST /api/comments/dm/blocked"
  , "POST /api/comments/notifications/unread"
  , "POST /api/comments/notifications"
  , "POST /api/comments/board/reads"
  , "POST /api/comments/wall"
  , "POST /api/comments/wall/feed"
  , "POST /api/comments/bookmarks"
  , "POST /api/comments/reacts"
  ]

-- | May this request start its session away from the primary?
readsReplica :: String -> String -> Boolean
readsReplica method path = A.elem (method <> " " <> path) replicaRoutes

-- | Does this statement write? Anything that does not open with SELECT or
-- | PRAGMA counts as a write — an unknown statement only costs a cookie, while
-- | a missed write would cost a member the sight of their own words.
isWriteSql :: String -> Boolean
isWriteSql sql =
  let word = S.toUpper (S.takeWhile isLetter (S.trim sql))
  in not (word == "SELECT" || word == "PRAGMA")
  where
  isLetter cp = let s = S.singleton cp in (s >= "A" && s <= "Z") || (s >= "a" && s <= "z")

-- | A bookmark as D1 writes it: hex groups and dashes. Anything else from a
-- | cookie is ignored rather than handed to the database.
bookmarkOk :: String -> Boolean
bookmarkOk b =
  let cs = toCharArray b
      n = A.length cs
  in n >= 8 && n <= 200 && A.all ok cs
  where
  ok c = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') || c == '-'
