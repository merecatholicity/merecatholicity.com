/* comments-worker/src/env.ts — the worker's bindings as wrangler.jsonc declares
   them (2026-09-16). One place, typed: a handler that takes `env: Env` gets
   D1's `first<Row>()`, R2's object shapes and the limiter's verdict for free;
   a binding renamed in wrangler.jsonc is a compile error here, not a 500 in
   production. Every handler takes it (2026-09-17: the workers hold no `any`,
   tests/js/any_ratchet.test.mjs).

   The BRAND (2026-09-17): a type-only mark on the env that nothing else
   carries, and that every answer, row and live event refuses (`NotEnv`) — so
   the swapped argument that served the whole env from `/recent` for six weeks
   (`withNames(env, items)`), or a `json({ ...env })`, is a compile error. It
   exists in the types alone; comments-worker/types/env_brand.check.ts proves
   the refusal compiles as one. */
declare const ENV_BRAND: unique symbol;
/* an open record (a row, a live event) that may not carry the brand */
export type NotEnv = { readonly [ENV_BRAND]?: never };
/* `unknown` for any object but the env or a copy of it, `never` for those —
   json()'s parameter is `T & EnvFree<T>` */
export type EnvFree<T> = typeof ENV_BRAND extends keyof T ? never : unknown;

export interface Env {
  readonly [ENV_BRAND]: 'the worker env: never an answer, a row or an event';
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
  /* the rate limiters, only ever reached through lib.ts throttle() (2026-09-17):
     the three member buckets (keyed by identity; by address for a keyless
     request when no backstop exists) and their per-address backstops */
  POST_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
  CONNECT_LIMIT: RateLimit;
  POST_IP_LIMIT?: RateLimit;
  READ_IP_LIMIT?: RateLimit;
  CONNECT_IP_LIMIT?: RateLimit;
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
  HIDDEN_HASHES?: string;
  /* how many BoardHub shards the live sockets are spread over (Domain.Hub;
     absent = 1, the single "board" instance) */
  HUB_SHARDS?: string;
  /* secrets (`wrangler secret put`, never in a file) */
  /* The pepper under the public id: pubid = SHA-256(PUBLIC_ID_PEPPER || hash)
     (the P0 chain, layer three). STABLE FOREVER — changing it reshuffles every
     member's public id and displayed name. Absent, `serveId` returns the raw
     hash (the pre-layer-3 behaviour), so a missing secret degrades to the old
     exposure rather than breaking a read. NOT in PUBLIC_VARS, so egress.ts
     refuses every answer that would carry its value. */
  PUBLIC_ID_PEPPER?: string;
  TURNSTILE_SECRET?: string;
  VAPID_PRIVATE_KEY?: string;
  TURN_KEY_SECRET?: string;
  CF_USAGE_TOKEN?: string;
  OPS_REPORT_KEY?: string;
}

/* The vars above, by name: public by design (wrangler.jsonc prints most of
   them), so the egress scan (egress.ts) never looks for their values. Every
   OTHER env string is treated as a secret, so a `wrangler secret put` needs
   no line here. Held to the vars section above and to wrangler.jsonc by
   tests/worker/egress.test.mjs. */
export const PUBLIC_VARS: readonly string[] = [
  'MODERATION_MODE', 'ALLOW_ANON', 'ADMIN_HASHES', 'TURNSTILE_HOSTNAMES', 'SITE', 'ALLOWED_ORIGINS',
  'PUSH_ENABLED', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT', 'TURN_KEY_ID', 'CF_ACCOUNT_ID', 'ALERT_FROM',
  'HIDDEN_HASHES', 'HUB_SHARDS',
];

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
