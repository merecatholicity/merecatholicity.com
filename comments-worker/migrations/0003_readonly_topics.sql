-- Read-only topics: an admin can mark a topic read-only so ordinary members
-- cannot post to it, while admins still can. Distinct from `locked` (which
-- closes a thread to EVERYONE). Used by the Mere Catholicity Journal, whose
-- entries are admin posts to one read-only topic.
ALTER TABLE comments ADD COLUMN readonly INTEGER DEFAULT 0;
