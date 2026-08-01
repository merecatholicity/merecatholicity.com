-- | The page-bar windowing, single-sourced. Two bundled copies computed the same
-- | thing — `pagerPages` in app/views/util.js (feeding the href pagers) and an
-- | inline reimplementation in app/views/member.js (the McUsers button pager).
-- | Both now call `pagerItems`.
-- |
-- | (The classic docs/comments.js `pageBar` uses a DIFFERENT window — it always
-- | shows the first three pages, not just the first — so it is deliberately not
-- | unified here; that is a distinct algorithm, not a copy of this one.)
module Domain.Pager (pagerItems) where

import Prelude
import Data.Array (filter, range)
import Data.Foldable (foldl)
import Data.Int (ceil, toNumber)

-- | A page-bar cell in a uniform shape so the barrel passes it straight through
-- | (no ADT erasure) and every renderer reads the same fields: `gap` = an
-- | ellipsis (n/active irrelevant); otherwise a page, `active` marking the
-- | current one (rendered bold rather than linked).
type Cell = { gap :: Boolean, n :: Int, active :: Boolean }

-- | Show page 1, the last page, and the active page's immediate neighbours; a
-- | one-page gap is filled with that page as a link, a wider gap with an
-- | ellipsis. `[]` for a single page (the caller renders nothing). Byte-parity
-- | with the former util.js `pagerPages` (and its member.js twin).
pagerItems :: Int -> Int -> Int -> Array Cell
pagerItems total per active =
  if pages < 2 then []
  else (foldl step { prev: 0, out: [] } shown).out
  where
  pages = ceil (toNumber total / toNumber per)
  shown = filter keep (range 1 pages)
  keep n = n == 1 || n == pages || n == active - 1 || n == active || n == active + 1
  step acc n =
    { prev: n
    , out: acc.out <> gapCells acc.prev n <> [ { gap: false, n, active: n == active } ]
    }
  gapCells prev n =
    if prev == 0 then []
    else if n - prev == 2 then [ { gap: false, n: prev + 1, active: false } ]
    else if n - prev > 2 then [ { gap: true, n: 0, active: false } ]
    else []
