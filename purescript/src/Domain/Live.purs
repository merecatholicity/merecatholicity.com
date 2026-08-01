-- | The PURE decisions behind the live (WebSocket-driven) forum views. The
-- | reducers in app/views/board.js and topic.js are decision/DOM-effect braids;
-- | this extracts only the side-effect-free parts — the topic sort ordering and
-- | the reply-page math — leaving every DOM write (append a node, raise the
-- | "N new replies" pill, moderation patches) in the view as a dumb interpreter.
-- | Nothing here touches the DOM, so it is exhaustively unit-testable.
module Domain.Live
  ( topicCompare
  , replyPage
  ) where

import Prelude
import Data.Int (ceil, toNumber)

-- | Order two topics for a category listing: stickies first, then most-recent
-- | activity. Returns a sort comparator value (sign is what Array.sort uses),
-- | matching board.js's `(b.sticky - a.sticky) || (b.last - a.last)`. Uses
-- | Number so a large `last` timestamp can't overflow an Int.
topicCompare :: { sticky :: Number, last :: Number } -> { sticky :: Number, last :: Number } -> Number
topicCompare a b =
  let s = b.sticky - a.sticky
  in if s /= 0.0 then s else b.last - a.last

-- | The 1-based page a reply lands on given the total reply count and page size
-- | (topic.js `Math.ceil(total / per)`). The view compares this to the shown
-- | page to decide append-in-place vs a jump pill.
replyPage :: Int -> Int -> Int
replyPage total per = if per <= 0 then 1 else ceil (toNumber total / toNumber per)
