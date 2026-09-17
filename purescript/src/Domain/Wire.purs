-- | The wire's lists (2026-09-17). For six weeks `GET /api/comments/recent`
-- | answered `items` as ONE OBJECT (the worker's env, copied) where every
-- | reader expected a list of rows, and the Recent activity view showed
-- | "Nothing here yet." — `d.items.length` was undefined, and undefined reads
-- | as empty. A list the client renders is a list the wire promises, so the
-- | promise is written down once, here, and checked at both ends:
-- |
-- |  * the worker (`comments-worker/src/serve.ts`) notes and alerts an answer
-- |    whose listed field is present and not a list — the answer still goes;
-- |  * the client (`app/store.ts`, through `app/core.ts`) refuses such an
-- |    answer, so the view shows its "could not be loaded" state rather than
-- |    an empty one, and nothing malformed is cached.
-- |
-- | The table is every route's top-level fields that were a list in EVERY
-- | successful answer the leak sweep saw; `tests/worker/response_shapes.test.mjs`
-- | holds it to the committed snapshot (`tests/_support/response_shapes.json`),
-- | so a route that grows or drops a list changes this file in the same commit.
module Domain.Wire
  ( lists
  , listFields
  , brokenFields
  ) where

import Prelude

import Data.Array as A
import Data.Maybe (Maybe(..), maybe)
import Data.String as S

-- | One route per line: the method, the path, and the fields that are always
-- | lists when its answer is ok (comma-separated). Kept as text because it
-- | rides every page's bundle, where a record per row cost a kilobyte.
table :: String
table =
  """GET /api/comments comments
GET /api/comments/board/author items
GET /api/comments/board/cat topics
GET /api/comments/board/topic replies
GET /api/comments/config bible,cats,faiths,pages,ranks
GET /api/comments/dm/directory users
GET /api/comments/recent items
GET /api/comments/search items
POST /api/comments/admin/alert-test channels,errors
POST /api/comments/admin/discord/list hooks
POST /api/comments/admin/settings ttls,wall_prune_options
POST /api/comments/admins admins
POST /api/comments/audit pages,reports,topics
POST /api/comments/board/admin replies
POST /api/comments/board/reads unread
POST /api/comments/bookmarks items
POST /api/comments/call/turn iceServers
POST /api/comments/dm/blocked blocked
POST /api/comments/dm/forward results
POST /api/comments/dm/members added
POST /api/comments/dm/presence online
POST /api/comments/dm/roster members
POST /api/comments/dm/thread messages
POST /api/comments/dm/threads threads
POST /api/comments/ipban keys
POST /api/comments/ipbans ips
POST /api/comments/meta meta
POST /api/comments/notifications items
POST /api/comments/pending pending,pending_wall
POST /api/comments/react reacts
POST /api/comments/react/who likers,who
POST /api/comments/shadowban/list bans
POST /api/comments/wall posts
POST /api/comments/wall/comment/like reacts
POST /api/comments/wall/feed posts
POST /api/comments/wall/like reacts
POST /api/comments/wall/likers likers,who
POST /api/comments/wall/post/get comments
POST /api/merecat/about works
POST /api/merecat/admin/thread msgs
POST /api/merecat/admin/threads threads
POST /api/merecat/chat msgs
POST /api/merecat/chats chats
POST /api/merecat/stats days
POST /api/merecat/works works"""

-- | "METHOD /path" → the fields that are always lists when the answer is ok.
lists :: Array { route :: String, fields :: Array String }
lists = A.mapMaybe row (S.split (S.Pattern "\n") table)
  where
  row line = case S.split (S.Pattern " ") line of
    [ m, p, fs ] -> Just { route: m <> " " <> p, fields: S.split (S.Pattern ",") fs }
    _ -> Nothing

-- | A route's listed fields ([] for a route not in the table). The method is
-- | upper-case; the path has no query and no trailing slash.
listFields :: String -> String -> Array String
listFields method path =
  maybe [] _.fields (A.find (\r -> r.route == key) lists)
  where
  key = method <> " " <> path

-- | The listed fields an answer breaks: present, and neither a list nor null
-- | (an absent or null field is a quirk to render, not a broken promise).
-- | `kindOf` says what the answer holds at a field — "absent", "null", "list"
-- | or "other"; the membranes read the JSON, the rule is here.
brokenFields :: String -> String -> (String -> String) -> Array String
brokenFields method path kindOf = A.filter (\f -> kindOf f == "other") (listFields method path)
