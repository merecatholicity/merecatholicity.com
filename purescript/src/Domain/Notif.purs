-- | The notification list's words and doors (2026-09-12). Every kind the
-- | `notifications.kind` CHECK admits, and for each the sentence a row reads
-- | ("X reacted to your post") and the page a tap opens. Three renderers — the
-- | classic list, the Lit list on the member page, and the app chrome's bell
-- | sheet — each carried a copy of this map and had already drifted once (a
-- | missed call read as "replied in a thread" in one of them); a fourth copy
-- | for the reaction kinds was the moment to make it one rule. The row's raw
-- | fields are exactly the wire's; the coercions live in the membrane.
module Domain.Notif
  ( kinds
  , Item
  , who
  , label
  , href
  , hasSnippet
  ) where

import Prelude

import Domain.Pseudonym as Pseudonym

-- | Every kind, in the order the ledger gained them. The worker's CHECK and
-- | the client's label map both read this list, so adding a kind is one line
-- | here, one migration, and one case in `label` / `href` below.
kinds :: Array String
kinds =
  [ "reply", "mention", "dm", "wall", "wall-like", "merecat", "call"
  , "react", "wall-react", "dm-react" ]

-- | A row as the client sees it: the kind, the actor's shown name (already
-- | resolved by `who`), the thread's title when there is one, and the two
-- | integers whose meaning depends on the kind — for reply/mention/react the
-- | thread and the post; for wall the sub-kind (1 = a comment on your post,
-- | 0 = an @mention) and the feed post; for wall-react the feed comment (0 for
-- | the post itself) and the feed post; for dm-react 0 and the message; for
-- | merecat the chat and 0.
type Item =
  { kind :: String
  , who :: String
  , topicTitle :: String
  , topicId :: Int
  , commentId :: Int
  , actor :: String
  }

-- | The actor's name for the sentence: their nick when they have one, else
-- | the pseudonym every hash carries, else (no actor at all) "Someone".
who :: String -> String -> String
who nick actor
  | nick /= "" = nick
  | actor /= "" = Pseudonym.displayName actor
  | otherwise = "Someone"

-- | The sentence the row reads. A reaction says "reacted", never the emoji or
-- | "liked" — the owner's ruling (2026-09-12): with the whole picker open to
-- | a reactor, one word covers every reaction honestly.
label :: Item -> String
label r = case r.kind of
  "dm" -> r.who <> " sent you a message"
  "call" -> "📞 " <> r.who <> " called you"
  "merecat" -> "merecat finished answering your question"
  "wall-like" -> r.who <> " liked your post"
  "wall" -> r.who <> (if r.topicId == 1 then " commented on your post" else " mentioned you in a post")
  "react" -> r.who <> " reacted to your post"
  "wall-react" -> r.who <> " reacted to your " <> (if r.topicId > 0 then "comment" else "post")
  "dm-react" -> r.who <> " reacted to your message"
  "mention" -> r.who <> " mentioned you in " <> title
  _ -> r.who <> " replied in " <> title
  where
  title = if r.topicTitle == "" then "a thread" else r.topicTitle

-- | The door a tap opens: the exact post for the board kinds, the feed post
-- | (and the feed comment's own anchor) for the wall kinds, the conversation —
-- | landing on the very message for a reaction — for the DM kinds.
href :: Item -> String
href r = case r.kind of
  "dm" -> "messages.html?dm=" <> r.actor
  "call" -> "messages.html?dm=" <> r.actor
  "dm-react" -> "messages.html?dm=" <> r.actor <> "&m=" <> show r.commentId
  "merecat" -> "merecat-ai.html?chat=" <> show r.topicId
  "wall" -> "feed.html?post=" <> show r.commentId
  "wall-like" -> "feed.html?post=" <> show r.commentId
  "wall-react" -> "feed.html?post=" <> show r.commentId <> (if r.topicId > 0 then "#wc-" <> show r.topicId else "")
  _ -> "community.html?topic=" <> show r.topicId <> "#comment-" <> show r.commentId

-- | Whether the row may show an excerpt of the post under the sentence. A
-- | message is end-to-end encrypted — the server has no words to excerpt for
-- | the DM kinds — and a call has none.
hasSnippet :: String -> Boolean
hasSnippet k = not (k == "dm" || k == "call" || k == "dm-react")
