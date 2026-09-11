-- Last seen (2026-09-11): the moment a member's last live socket closed, for
-- the "Last seen …" line beside Offline in a conversation header and on a
-- profile. Written by the BoardHub Durable Object alone — the one party that
-- knows a member's presence mode, which rides the socket's auth frame, never a
-- column: stamped at the last disconnect under "auto", and CLEARED whenever a
-- socket authenticates under "off" (appear offline), so a member who hides
-- their presence has no stamp to serve. NULL = never seen, or hidden.
ALTER TABLE profiles ADD COLUMN last_seen_at INTEGER;
