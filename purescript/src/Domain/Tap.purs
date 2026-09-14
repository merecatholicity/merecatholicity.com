-- | A press on the phone's fixed chrome — the tab bar, the app bar: the
-- | judgement that a finger's press-and-lift was a TAP and not a drag or a
-- | hold, away from the DOM.
-- |
-- | Why this exists at all. The shell navigates on the click event, and on a
-- | phone the click is SYNTHESIZED by the platform after the finger lifts —
-- | and withheld whenever the platform decides the tap meant something else.
-- | iOS withholds it for a tap that lands while the page is still decelerating
-- | (the tap stops the scroll instead) and for a tap whose hover it judges to
-- | have changed content (the first tap becomes a hover, the second the click).
-- | Live, 2026-09-13: Inbox pressed, the tab drawn in the hover tint, the page
-- | never moving; a second press worked. The finger's own events are delivered
-- | every time, so the chrome answers them directly and asks this module
-- | whether the lift was a tap. The numbers are the feature: too tight and a
-- | thumb's jitter is a drag, too loose and a scroll that began on the bar
-- | navigates.
module Domain.Tap
  ( Verdict(..)
  , verdict
  , verdictTag
  , excursion
  , slop
  , holdMs
  , echoMs
  ) where

import Prelude
import Data.Ord (abs)

-- | What the lift was.
data Verdict
  = Tap    -- ^ a press and a lift, in place, quickly: act on it
  | Drag   -- ^ the finger travelled: a scroll or a swipe that began on the bar, never a tap
  | Hold   -- ^ the finger stayed down: the platform's own gesture (a link preview), never a tap

derive instance eqVerdict :: Eq Verdict

-- | How far the finger may wander (CSS px, on the farther axis) and still be
-- | a tap. Ordinary tap jitter is a few px; a scroll that begins on the bar
-- | crosses this within its first frame.
slop :: Number
slop = 12.0

-- | How long the finger may stay down. Beyond it the press is a hold — iOS's
-- | link preview begins at about half a second, and a hold that then lifts
-- | must not navigate as well.
holdMs :: Number
holdMs = 500.0

-- | How long after the finger's own press the platform's late click, should
-- | an engine still send one, is that same press — an echo to be swallowed,
-- | never a second navigation. Generous: an engine without the manipulation
-- | fast path once waited 300 ms before sending it.
echoMs :: Number
echoMs = 700.0

-- | How far a finger has strayed from where it landed: the farther axis, so
-- | a purely vertical scroll and a purely horizontal swipe measure the same.
excursion :: Number -> Number -> Number
excursion dx dy = max (abs dx) (abs dy)

-- | The judgement, from the farthest the finger strayed while down and how
-- | long it stayed down. Travel is judged first: a finger that moved is a
-- | drag however brief, and a hold that also moved is still a drag.
verdict :: Number -> Number -> Verdict
verdict far ms
  | far > slop = Drag
  | ms > holdMs = Hold
  | otherwise = Tap

verdictTag :: Verdict -> String
verdictTag Tap = "tap"
verdictTag Drag = "drag"
verdictTag Hold = "hold"
