/* comments-worker/src/oidc.ts — who is at a pipeline door (2026-09-17).

   The librarian's pipeline (merecat.yml) and the watchdog (ops-watch.yml)
   proved themselves with one static key until the env disclosure published
   it. Now each GitHub Actions job asks GitHub for an OIDC token — a JWT that
   GitHub signs for that one run, naming the repository, the workflow file,
   the branch, the event and the job's environment, alive for minutes — and
   sends it as `Authorization: Bearer`. This file checks the signature against
   GitHub's published keys (RS256, WebCrypto) and hands the claims to the
   policy, `Domain.Pipeline`, which says which door they open. The worker
   holds no pipeline secret, so there is none to leak.

   Fail closed: an unreadable token, an unknown key, a failed key fetch or a
   refused claim is "No.", and a bearer that fails never falls through to a
   key in the body. The keys are cached per isolate for an hour; a token
   naming a key the cache lacks refetches them at most once a minute (GitHub
   publishes a new key before it signs with it).

   The other roads to the same doors: an admin key (the owner by hand — the
   merecat dashboard pushes its dials through /config); and, for the ops door
   alone, OPS_REPORT_KEY, the dev box's nightly credential, which opens that
   door and nothing else. */
import * as Pipeline from '../../purescript/output/Domain.Pipeline/index.js';
import { json, requireAdmin } from './lib.ts';
import type { Env } from './env.ts';

/* what a token is for (Domain.Pipeline.workflowOf) */
export type Door = 'ingest' | 'config' | 'probe';

/* how a caller proved itself */
export type Caller =
  | { road: 'oidc'; door: Door }
  | { road: 'admin' }
  | { road: 'report-key' }
  | { road: 'ingest-key' };

export const JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const KEYS_LIVE_MS = 3600_000;
const REFETCH_GAP_MS = 60_000;

/* GitHub's signing keys, per isolate (tests/_support/worker.mjs resetCaches
   empties it between cases) */
export const keyCache: { at: number; tried: number; keys: Map<string, CryptoKey>; loading: Promise<void> | null } = {
  at: 0, tried: 0, keys: new Map(), loading: null,
};

function bytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('not base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function objectPart(s: string): Record<string, unknown> | null {
  const v: unknown = JSON.parse(new TextDecoder().decode(bytes(s)));
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function loadKeys(now: number): Promise<void> {
  const res = await fetch(JWKS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('the key set answered ' + res.status);
  const body: unknown = await res.json();
  const list = body && typeof body === 'object' ? (body as { keys?: unknown }).keys : null;
  const keys = new Map<string, CryptoKey>();
  for (const k of Array.isArray(list) ? list : []) {
    if (!k || typeof k !== 'object') continue;
    const { kty, kid, n, e, use, alg } = k as Record<string, unknown>;
    if (kty !== 'RSA' || typeof kid !== 'string' || typeof n !== 'string' || typeof e !== 'string') continue;
    if ((use !== undefined && use !== 'sig') || (alg !== undefined && alg !== 'RS256')) continue;
    try {
      keys.set(kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n, e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    } catch (err) { /* a key this runtime cannot read is one no token can use */ }
  }
  if (!keys.size) throw new Error('the key set held no usable key');
  keyCache.keys = keys;
  keyCache.at = now;
}

async function keyFor(kid: string, now: number): Promise<CryptoKey | null> {
  const known = () => (now - keyCache.at < KEYS_LIVE_MS && keyCache.keys.get(kid)) || null;
  if (known()) return known();
  if (!keyCache.loading && now - keyCache.tried >= REFETCH_GAP_MS) {
    keyCache.tried = now;
    keyCache.loading = loadKeys(now).finally(() => { keyCache.loading = null; });
  }
  if (keyCache.loading) {
    try { await keyCache.loading; } catch (err) {
      console.log(JSON.stringify({ event: 'pipeline_keys_failed', error: String(err).slice(0, 120) }));
    }
  }
  return known();
}

/* The claims of a token GitHub signed, or null. */
export async function verifiedClaims(token: string, now: number): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 8192) return null;
  const head = objectPart(parts[0]);
  if (!head || head.alg !== 'RS256' || typeof head.kid !== 'string' || head.crit !== undefined) return null;
  const key = await keyFor(head.kid, now);
  if (!key) return null;
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), signed))) return null;
  return objectPart(parts[1]);
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
/* whole seconds inside the kernel's Int; absent or unreadable is 0 */
const seconds = (v: unknown): number =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(2147483647, Math.floor(v))) : 0);

/* the membrane: GitHub's claim names to the policy's record */
export function claimsOf(c: Record<string, unknown>) {
  const aud = Array.isArray(c.aud) ? (c.aud.length === 1 ? text(c.aud[0]) : '') : text(c.aud);
  return {
    iss: text(c.iss), aud,
    repositoryId: text(c.repository_id), ownerId: text(c.repository_owner_id),
    ref: text(c.ref), refType: text(c.ref_type), eventName: text(c.event_name),
    runner: text(c.runner_environment), workflowRef: text(c.job_workflow_ref),
    environment: text(c.environment),
    exp: seconds(c.exp), nbf: seconds(c.nbf), iat: seconds(c.iat),
  };
}

/* The first of `doors` a bearer token opens, or null. The log names the
   doors and the policy's reasons, never a claim's value. */
export async function tokenDoor(token: string, doors: readonly Door[], nowMs = Date.now()): Promise<Door | null> {
  let raw: Record<string, unknown> | null = null;
  try { raw = await verifiedClaims(token, nowMs); } catch (err) { raw = null; }
  if (!raw) {
    console.log(JSON.stringify({ event: 'pipeline_refused', why: ['the signature'] }));
    return null;
  }
  const claims = claimsOf(raw);
  const now = Math.floor(nowMs / 1000);
  const why: string[] = [];
  for (const door of doors) {
    const no: string = Pipeline.refusal(door)(claims)(now);
    if (!no) return door;
    why.push(door + ': ' + no);
  }
  console.log(JSON.stringify({ event: 'pipeline_refused', why }));
  return null;
}

/* a key compared in constant time (its length aside); an unset one never matches */
function sameKey(given: string, want: string): boolean {
  if (!want || given.length !== want.length) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(want);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* Who is at the door: a GitHub job whose token opens one of `doors`, an
   admin, or (with `reportKey`, the ops door) the dev box's nightly key. */
export async function pipelineCaller(request: Request, env: Env, key: string, doors: readonly Door[],
  o: { reportKey?: boolean } = {}): Promise<Caller | null> {
  const auth = request.headers.get('Authorization');
  if (auth !== null) {
    const m = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(auth);
    const door = m ? await tokenDoor(m[1], doors) : null;
    return door ? { road: 'oidc', door } : null;
  }
  if (await requireAdmin(env, key)) return { road: 'admin' };
  if (o.reportKey && sameKey(key, String(env.OPS_REPORT_KEY || ''))) return { road: 'report-key' };
  /* the static key, for the one deploy the workflows take to move
     (tests/_support/retirements.json) */
  if (sameKey(key, String(env.MERECAT_INGEST_KEY || ''))) {
    console.log(JSON.stringify({ event: 'pipeline_static_key', doors }));
    return { road: 'ingest-key' };
  }
  return null;
}

/* The pipeline's preamble: parse, then the caller. */
export async function pipelineGated(request: Request, env: Env, doors: readonly Door[]): Promise<Response | { data: any; caller: Caller }> {
  let data: unknown;
  try { data = await request.json(); } catch (err) { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ ok: false, error: 'Bad request.' }, 400);
  const body = data as Record<string, unknown>;
  const caller = await pipelineCaller(request, env, String(body.key || ''), doors);
  if (!caller) return json({ ok: false, error: 'No.' }, 403);
  return { data: body, caller };
}
