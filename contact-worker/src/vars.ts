/* contact-worker/src/vars.ts — the vars a deployment may set that are public
   by design (2026-09-17). Every OTHER env string (TURNSTILE_SECRET,
   CONTACT_TO) is scanned for by the egress guard this worker shares with the
   comments worker (comments-worker/src/egress.ts). Kept out of index.ts,
   whose exports are the worker's entrypoints; held to wrangler.jsonc by
   tests/worker/egress.test.mjs. */
export const PUBLIC_VARS: readonly string[] = ['ALLOWED_ORIGINS', 'CONTACT_FROM', 'TURNSTILE_HOSTNAMES'];
