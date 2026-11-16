-- Lérins Press's mailing list (2026-11-16): new books and the press's news by email. Write-only
-- from the web: the contact worker adds an address (/subscribe) and deletes one (/unsubscribe),
-- and nothing reads it back. An address is kept with the day it joined and the key of the consent
-- wording it agreed to (src/list.ts CONSENT), and nothing else: no IP, no browser, no name.
CREATE TABLE IF NOT EXISTS list (
  email      TEXT PRIMARY KEY COLLATE NOCASE,
  consent    TEXT NOT NULL,
  joined_at  TEXT NOT NULL
);
