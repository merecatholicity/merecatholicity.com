-- Forum attachments + the wall-media emergency valve (media platform Phase A/D).
--
-- comments.media_key/media_size: one optional media object per board comment
-- (topic head or reply), riding the EXISTING wall media pipeline — the
-- wall_media table and the WALLMEDIA bucket — linked as ref_type = 'board'
-- (NOT 'comment', which means a wall comment). The columns are the denormalized
-- read-side pointer, exactly the shape wall_posts/wall_comments carry; NULL =
-- no attachment (every existing row). The FTS5 triggers reference title/body
-- and are untouched by ADD COLUMN.
--
-- media_expired on all three parent tables: stamped by enforceWallMediaCap's
-- 95% emergency valve when it must evict the oldest linked media, so the client
-- renders an honest placeholder instead of a broken tile (the dms.media_expired
-- precedent).
--
-- Additive only; safe to apply under the running worker.
ALTER TABLE comments ADD COLUMN media_key TEXT;
ALTER TABLE comments ADD COLUMN media_size INTEGER;
ALTER TABLE comments ADD COLUMN media_expired INTEGER;
ALTER TABLE wall_posts ADD COLUMN media_expired INTEGER;
ALTER TABLE wall_comments ADD COLUMN media_expired INTEGER;
