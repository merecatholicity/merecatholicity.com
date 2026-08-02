-- Per-feed Discord webhook subscriptions.
-- Each row maps one of our own feed URLs (parsed to a normalized `scope`) to a
-- Discord channel webhook. When a fresh LIVE post matches the scope, the worker
-- posts an abbreviated embed to that Discord channel (event-driven, no polling).
-- Independent of the two coarse global webhooks in app_settings, which remain.
CREATE TABLE IF NOT EXISTS discord_hooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL,            -- 'topic:219' | 'cat:general' | 'page:/credo.html'
  feed_url   TEXT NOT NULL,            -- the feed URL the admin pasted (shown in the list)
  hook_url   TEXT NOT NULL,            -- the Discord webhook URL (validated by isDiscordWebhook)
  label      TEXT,                     -- optional friendly name
  created_at INTEGER NOT NULL,
  created_by TEXT                      -- admin hash that added it
);
CREATE INDEX IF NOT EXISTS discord_hooks_scope_idx ON discord_hooks (scope);
