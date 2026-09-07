-- | Pull to refresh: the arithmetic of the gesture, away from the DOM.
-- |
-- | Everyone knows this gesture from Facebook and Instagram, which means it has
-- | to feel exactly right or it feels broken — and "exactly right" is a handful
-- | of numbers and one state machine that are miserable to get correct while
-- | also wrestling touch events. So they live here, where they can be checked
-- | without a browser.
-- |
-- | Two things are worth naming:
-- |
-- |   RESISTANCE. The indicator must not track the finger one-to-one; a real
-- |   pull gets heavier as it goes, which is what tells your hand the gesture is
-- |   bounded before you have read a word. `travel` is that curve.
-- |
-- |   ESCALATION. The owner's rule: an ordinary pull refetches the data in
-- |   place, but three pulls in quick succession mean "this still looks wrong",
-- |   and that earns a full document reload. `escalates` is that judgement —
-- |   count and recency together, so three pulls spread over a minute are three
-- |   ordinary refreshes, not a reload nobody asked for.
module Domain.Ptr
  ( Stage(..)
  , stage
  , stageTag
  , travel
  , threshold
  , maxTravel
  , escalates
  , escalateCount
  , escalateWindowMs
  ) where

import Prelude
import Data.Ord (abs)

-- | Where the gesture stands, from the distance pulled.
data Stage
  = Idle       -- ^ nothing worth showing yet
  | Pulling    -- ^ the indicator is following, release does nothing
  | Ready      -- ^ past the threshold: release refreshes

derive instance eqStage :: Eq Stage

-- | How far the finger must travel (in indicator pixels, i.e. after resistance)
-- | before releasing refreshes. Low enough to be easy with a thumb, high enough
-- | that a flick while scrolling never trips it.
threshold :: Number
threshold = 70.0

-- | The indicator never moves further than this, however hard the pull.
maxTravel :: Number
maxTravel = 120.0

-- | Raw finger distance to indicator distance: brisk at first, easing toward
-- | the cap, so the pull grows heavier the further it goes and the hand feels
-- | the limit rather than hitting it.
-- |
-- | The constant is tuned, not arbitrary. It puts `threshold` at roughly 130px
-- | of finger travel — a comfortable thumb pull. A first attempt used a much
-- | heavier curve that needed ~250px, which on a phone means dragging almost
-- | half the screen before the gesture arms; correct-looking arithmetic, wrong
-- | in the hand.
travel :: Number -> Number
travel dy
  | dy <= 0.0 = 0.0
  | otherwise = maxTravel * (1.0 - (1.0 / (1.0 + dy / (maxTravel * 0.75))))

-- | A tiny dead zone below the indicator's appearance keeps a normal scroll
-- | that begins at the very top from flashing it.
stage :: Number -> Stage
stage t
  | t < 8.0 = Idle
  | t < threshold = Pulling
  | otherwise = Ready

stageTag :: Stage -> String
stageTag Idle = "idle"
stageTag Pulling = "pulling"
stageTag Ready = "ready"

-- | Three pulls is the ask; the window is what makes it a deliberate gesture
-- | rather than an accumulation over a browsing session.
escalateCount :: Int
escalateCount = 3

escalateWindowMs :: Number
escalateWindowMs = 6000.0

-- | Should THIS refresh be a full document reload rather than a refetch?
-- | `n` counts refreshes already completed in the current run (so the third
-- | pull passes n = 2), and `sinceFirst` is how long ago that run began.
-- | `abs` guards a clock that jumped backwards mid-gesture — it should not
-- | silently turn an ordinary pull into a reload.
escalates :: Int -> Number -> Boolean
escalates n sinceFirst =
  n + 1 >= escalateCount && abs sinceFirst <= escalateWindowMs
