-- | Direct-message lifetimes (disappearing messages). The three allowed TTLs and
-- | their labels — duplicated as `DM_TTLS` in comments.js AND the worker ("must
-- | match the client"); this is the single typed source (the worker single-
-- | sources here in Phase 6). `ttlLabel` mirrors comments.js dmTtlLabel's
-- | thresholds; the caller coerces a missing/zero value to the 7-day default
-- | before calling (the barrel does `Number(ttl) || 604800`).
module Domain.Dm (ttlOptions, ttlLabel) where

import Prelude

-- | The three chooser options in order: 24h / 7d / 30d.
ttlOptions :: Array { secs :: Int, label :: String }
ttlOptions =
  [ { secs: 86400, label: "24 hours" }
  , { secs: 604800, label: "7 days" }
  , { secs: 2592000, label: "30 days" }
  ]

-- | The label for a lifetime in seconds: <= 24h → "24 hours", >= 30d → "30 days",
-- | anything between → "7 days".
ttlLabel :: Int -> String
ttlLabel secs
  | secs <= 86400 = "24 hours"
  | secs >= 2592000 = "30 days"
  | otherwise = "7 days"
