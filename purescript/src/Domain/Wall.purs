-- | Permissions + retention policy for the public posting system (walls + the
-- | global feed + post comments). A "wall" is a member's own stream of public
-- | posts: you post only to YOUR wall (a post's author IS its wall owner), anyone
-- | signed in may read a wall or the feed and comment, and a post/comment is
-- | deletable by its author or an admin. Viewing the feed or any profile requires
-- | membership (Home + Community stay public — those gates live in the router).
-- | Single-sourced into the worker (`/wall*` handlers) and the client (`app/core`
-- | barrel → the feed/profile views). The pure rules; the storage is imperative.
module Domain.Wall
  ( canView
  , canPost
  , canComment
  , canDelete
  , pruneDayOptions
  , clampPruneDays
  ) where

import Prelude

-- | Membership: a non-empty identity hash. The three gates below are the same
-- | rule (you must be signed in), named for what they govern so the rulebook
-- | reads clearly.
member :: String -> Boolean
member me = me /= ""

-- | Reading the feed or a member's wall requires membership.
canView :: String -> Boolean
canView = member

-- | Posting to your own wall (which also lands the post in the global feed)
-- | requires membership; the author is always the wall owner.
canPost :: String -> Boolean
canPost = member

-- | Commenting on any public post requires membership.
canComment :: String -> Boolean
canComment = member

-- | A post or comment is deletable by its author, or by any admin.
canDelete :: String -> String -> Boolean -> Boolean
canDelete author me isAdmin = isAdmin || (member me && me == author)

-- | The retention options the admin auto-prune offers (days). Posts persist
-- | indefinitely unless the admin enables pruning and picks one of these.
pruneDayOptions :: Array Int
pruneDayOptions = [ 90, 180, 365 ]

-- | Clamp an admin-supplied retention to a sane range (1 day .. 10 years). The
-- | UI offers `pruneDayOptions`; this guards the stored value against nonsense.
clampPruneDays :: Int -> Int
clampPruneDays d = max 1 (min 3650 d)
