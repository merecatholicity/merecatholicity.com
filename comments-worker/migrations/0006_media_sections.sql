-- Per-section media accounting (2026-08-02): which SECTION a wall_media upload
-- belongs to — 'wall' (the public feed + member walls) or 'board' (the
-- community forum). Stamped at upload from the route (/wall/media vs
-- /board/media), RE-STAMPED at claim/link time to follow the claiming parent,
-- so for every linked row ctx = 'board' ⇔ ref_type = 'board' and
-- ctx = 'wall' ⇔ ref_type ∈ ('post','comment'). ref_type stays the visibility
-- truth; ctx is the accounting dimension — per-section storage budgets,
-- purge-all, and age retention all scope on it. Readers COALESCE(ctx, 'wall')
-- for belt-and-braces robustness.
ALTER TABLE wall_media ADD COLUMN ctx TEXT;
UPDATE wall_media SET ctx = CASE WHEN ref_type = 'board' THEN 'board' ELSE 'wall' END;
CREATE INDEX IF NOT EXISTS wall_media_ctx_idx ON wall_media(ctx, created_at);
