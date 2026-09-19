/* app/wire.ts — the DM wire shapes (2026-09-16): the one home for what
   comments-worker/src/routes/dm.ts sends and app/api.ts, the views and the
   classic client read. Types only and DOM-free, so the worker's tsconfig (no
   DOM lib) imports it too; comments-worker/API.md §4.1 is the prose of these
   shapes. A field added on one side without the other is a compile error
   here, not a drift found a week later. */

/* a member row of a conversation, the departed included (their keys still open their words) */
export interface DmMember {
  hash: string;
  nick: string | null;
  avatar: string | null;
  assigned: string;             // the pseudonym the hash derives (Domain.Pseudonym)
  pubkey: string | null;        // their X25519 public key, null until they signed in under the encrypted client
  joined_at: number | null;
  left_at: number | null;
  read_at: number | null;       // withheld (null) when their receipts are off, and for members who never read
  receipts: number;             // 1 when this member reports reads at all — a group's ✓✓ waits only for those who do
  last_seen: number | null;     // the hub's stamp; absent for appear-offline
  /* 1 on the READER'S OWN row. The server resolved the key, so it alone knows
     this without guessing; a client comparing ids to find itself is how the
     2026-09-19 "stranger to your own conversation" defect happened, and that
     comparison is now a fallback for a cached payload, not the answer. */
  is_me?: number;
}
export interface DmReaction { hash: string; emoji: string; }
/* one message as the thread serves it; the client grafts its own fields (the plaintext, the reply, the content key) */
export interface DmMessage {
  id: number;
  sender_hash: string;
  body: string;                 // E1./E3. ciphertext, a system line in the clear (enc 2), or '' once redacted
  created_at: number;
  enc: number;                  // Domain.Dm: 0 plain, 1 the pair's box, 2 a system line, 3 the sealed envelope
  saved: number;
  saved_by: string | null;
  mine?: number;                // 1 when the reader sent it — the server's word, so a bubble never has to infer its side
  media_key: string | null;
  media_size: number | null;
  media_expired: number;
  redacted: number;
  edited_at: number | null;
  opened_at: number | null;
  expires_at: number | null;
  sealed: string | null;        // MY sealed content key (enc 3), served to me alone
  reactions: DmReaction[];
  /* a pair's, one deploy for bundles from before the member model */
  react_me?: string;
  react_other?: string;
  liked_me?: number;
  liked_other?: number;
}
export interface DmThreadInfo { id: number | null; kind: number; name: string | null; ttl: number; members: DmMember[]; }
/* a pair's `other`, kept one deploy: a member row, or the bare shape for an unmade pair */
export type DmOther = Pick<DmMember, 'hash' | 'nick' | 'avatar' | 'assigned' | 'pubkey' | 'last_seen'> & Partial<DmMember>;
/* POST /dm/thread */
export interface DmThreadPayload {
  ok: true;
  thread_id: number | null;     // null: an unmade pair's empty room
  ttl: number;
  thread: DmThreadInfo;
  other: DmOther | null;
  messages: DmMessage[];
  total: number;
  page: number;
  per: number;
  blocked: number;              // 1 when I block the pair's other
  unread: number;               // words unread BEFORE this open marked them read
  unread_from: number | null;   // the first of them, above which the "N unread messages" line stands
  notif_unread: number;         // the bell count after this open read the conversation's bells
}
/* one inbox row: POST /dm/threads */
export interface DmThreadsRow {
  id: number;
  thread_id: number;
  kind: number;
  name: string | null;
  other_hash: string | null;    // a pair's other; null for a group
  nick: string | null;
  avatar: string | null;
  members: { hash: string; nick: string | null; avatar: string | null; assigned: string | null }[];   // up to Domain.Dm.inboxAvatars others
  assigned: string | null;
  member_count: number;
  msgs: number;
  last_at: number;
  unread: number;               // WORDS, from the one fragment (dmUnreadCount)
}
export interface DmThreadsPayload { ok: true; threads: DmThreadsRow[]; total: number; unread_total: number; page: number; per: number; }
/* POST /dm/roster — the current members' keys, read without a mark */
export interface DmRosterPayload { ok: true; thread_id: number | null; kind: number; name: string | null; members: { hash: string; pubkey: string | null }[]; }
/* POST /dm/send (and each item of /dm/forward) */
export interface DmSendBody {
  key: string;
  token?: string;
  thread_id?: number;
  /* A pair's other, for a room not yet made — under EITHER name: `with` is what
     the client sends (the one target shape, app/api.ts `dmTarget`), `to` what
     /dm/forward's items send. The server takes both (2026-09-19). */
  with?: string;
  to?: string;
  body: string;
  enc: 0 | 1 | 3;
  keys?: Record<string, string>; // enc 3: the content key sealed once per current member, the sender included
  media_key?: string;
}
