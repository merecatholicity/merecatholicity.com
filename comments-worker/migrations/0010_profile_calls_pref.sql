-- The member-level voice-calls opt-out (the Settings gear's Privacy switch):
-- profiles.calls_ok NULL/1 = takes calls (the default), 0 = does not.
-- Enforced server-side in handleCallOffer with the SAME fake-success a
-- dm_block gets — a caller cannot tell "declined by preference" from
-- "did not pick up" (the standing indistinguishability law).
ALTER TABLE profiles ADD COLUMN calls_ok INTEGER;
