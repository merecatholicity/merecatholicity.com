-- | Post-level permission predicates — the authorization matrix that decides
-- | which affordances a viewer gets on a post. Pure boolean logic over the
-- | author's hash, the viewer's own hash, the librarian-bot hash, and whether
-- | the viewer is an admin. Extracted from app/views/post.js's inline gates
-- | (the classic copy in comments.js is the no-bundle fallback, retires at
-- | Wave F). Server-side authority is unchanged — these only govern the UI.
module Domain.Access
  ( canInteract
  , canReport
  , canEdit
  , canDelete
  ) where

import Prelude

-- | May the viewer act on this author at all (DM / mute)? A keyed viewer, on
-- | someone else's post, that is not the bot's.
canInteract :: String -> String -> String -> Boolean
canInteract author me bot =
  author /= "" && me /= "" && author /= me && author /= bot

-- | May the viewer report this post? Anyone who can interact, EXCEPT an admin
-- | (admins act directly and don't see the report link).
canReport :: String -> String -> String -> Boolean -> Boolean
canReport author me bot isAdmin = canInteract author me bot && not isAdmin

-- | May the viewer edit this post? Only its own author (keyed).
canEdit :: String -> String -> Boolean
canEdit author me = author /= "" && author == me

-- | May the viewer delete this post? Its author, or any admin (keyed).
canDelete :: String -> String -> Boolean -> Boolean
canDelete author me isAdmin = me /= "" && (author == me || isAdmin)
