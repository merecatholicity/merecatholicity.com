/* comments-worker/src/env.ts — the worker's bindings as wrangler.jsonc declares
   them (2026-09-16). One place, typed: a handler that takes `env: Env` gets
   D1's `first<Row>()`, R2's object shapes and the limiter's verdict for free;
   a binding renamed in wrangler.jsonc is a compile error here, not a 500 in
   production. The handlers are adopting it one route file at a time (the
   `: any` ratchet in tests/js/any_ratchet.test.mjs records each step); the
   ones not yet converted still take `env: any` and read the same object. */

export interface Env {
  /* D1: the platform, and the three librarian rooms (derived data) */
  DB: D1Database;
  LIBDB: D1Database;
  LIBDB2: D1Database;
  LIBDB3: D1Database;
  /* Vectorize and Workers AI (merecat) */
  MERECAT_INDEX: VectorizeIndex;
  AI: Ai;
  /* the two Durable Objects */
  HUB: DurableObjectNamespace;
  CHAT: DurableObjectNamespace;
  /* the ops alerts' mail (send_email binding, 2026-09-16) — it may write to
     every VERIFIED Email Routing destination address; the address is the
     alert_email Platform setting, the sender ALERT_FROM (alerts.ts) */
  EMAIL?: { send(msg: EmailSend): Promise<unknown> };
  /* R2 */
  BACKUPS: R2Bucket;
  AVATARS: R2Bucket;
  MEDIA: R2Bucket;
  WALLMEDIA: R2Bucket;
  /* the per-IP rate limiters, looked up by name in keyed()/keyedGated() */
  POST_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
  CONNECT_LIMIT: RateLimit;
  /* vars (wrangler.jsonc "vars") — every one optional: the code falls back */
  MODERATION_MODE?: string;
  ALLOW_ANON?: string;
  ADMIN_HASHES?: string;
  TURNSTILE_HOSTNAMES?: string;
  SITE?: string;
  ALLOWED_ORIGINS?: string;
  PUSH_ENABLED?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
  TURN_KEY_ID?: string;
  CF_ACCOUNT_ID?: string;
  ALERT_FROM?: string;
  /* secrets (`wrangler secret put`, never in a file) */
  TURNSTILE_SECRET?: string;
  VAPID_PRIVATE_KEY?: string;
  TURN_KEY_SECRET?: string;
  CF_USAGE_TOKEN?: string;
  MERECAT_INGEST_KEY?: string;
  MC_TEST_BYPASS?: string;
  TEST_HASHES?: string;
}

/* the send_email binding's message (the shape contact-worker sends) */
export type EmailAddress = string | { email: string; name?: string };
export type EmailSend = {
  to: EmailAddress;
  from: EmailAddress;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: EmailAddress;
  headers?: Record<string, string>;
};
