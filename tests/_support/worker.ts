/* The worker in the unit suite (2026-09-16). comments-worker/src/index.ts is
   loaded in plain Node and its handlers are driven through default.fetch
   against a real SQLite behind a D1-shaped shim, with every binding a request
   can touch stubbed or spying — so a test asserts what a road DOES to the
   ledger and answers on the wire, not what its source text looks like.

   The rules of the road:
   - index.ts is imported only through loadWorker() (dynamically). It re-exports
     the Durable Object classes, and durable.ts imports `cloudflare:workers`,
     which Node cannot resolve; the resolve hook below stubs that one specifier.
     ESM links a file's static graph before any hook can run, so a test file
     must never `import … from '…/index.ts'` at its top. lib.ts, db.ts, quota.ts
     and usage.ts import statically (they reach no `cloudflare:` scheme).
   - node --test runs each file in its own process, so the hook and the
     `caches` stub never leak between files; inside a file, call resetCaches()
     in beforeEach — lib.ts caches app_settings for five minutes.
   - Turnstile passes for an ESTABLISHED identity with no token (lib.ts
     verifyTurnstile): establish() inserts the profiles row that makes it so,
     with zero network. netSpy() proves that: every fetch throws and is recorded.
   - Nothing here reaches Workers AI, Vectorize, a Durable Object or R2 for
     real: AI/MERECAT_INDEX throw when touched, HUB is an optional spy, R2 is an
     in-memory bucket that records every call (and, for the media-hygiene rules,
     a snapshot of the ledger at the moment of the call). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { sha256hex, appSettingsCache, merecatConfigCache } from '../../comments-worker/src/lib.ts';
import { quotaCache } from '../../comments-worker/src/quota.ts';
import { keyCache } from '../../comments-worker/src/oidc.ts';

export * from './worker_src.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'comments-worker', 'src');
const migrationsDir = join(root, 'comments-worker', 'migrations');

export const ORIGIN = 'https://merecatholicity.com';

/* The shapes the suite passes around. A row and a wire answer are DATA the
   test reads by name — typed as such (`any` is the honest type of a parsed
   JSON body or a SELECT * row), never the worker's own types, which a test
   exists to hold the worker to rather than borrow from it. */
export type Row = Record<string, any>;
export type Worker = {
  fetch: (req: Request, env: any, ctx: any) => Promise<Response>;
  scheduled: (event: any, env: any, ctx: any) => Promise<void>;
};
export type Loaded = { worker: Worker; BoardHub: any; ChatRoom: any };

/* ---- loading -------------------------------------------------------------- */

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class DurableObject{constructor(c,e){this.ctx=c;this.env=e}}', shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const g = globalThis as { caches?: unknown };
if (!g.caches) {   // one handler reads caches.default (the wall media GET)
  g.caches = { default: { match: async () => undefined, put: async () => {} } };
}

let workerP: Promise<Loaded> | null = null;
/* → { worker: default export { fetch, scheduled }, BoardHub, ChatRoom } */
export function loadWorker(): Promise<Loaded> {
  workerP ||= import(pathToFileURL(join(src, 'index.ts')).href)
    .then((m) => ({ worker: m.default, BoardHub: m.BoardHub, ChatRoom: m.ChatRoom }));
  return workerP;
}

/* ---- the ledger ----------------------------------------------------------- */

/* every migration, in filename order, on a fresh in-memory database */
export function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  }
  return db;
}
/* one librarian room (schema-librarian.sql) */
export function freshLibDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(root, 'comments-worker', 'schema-librarian.sql'), 'utf8'));
  return db;
}

/* D1 over node:sqlite — exactly the surface the worker uses: prepare → bind →
   first | all | run, and batch. first() is get() with undefined → null and the
   null-prototype row spread to a plain object; all() → { results }; run() →
   { meta: { changes } }; batch() is one transaction whose statements each
   return their rows (a RETURNING inside a batch is read by the hub). Booleans
   bind as 1/0 as D1 coerces them; undefined throws, as it does on D1. */
type SqlValue = null | number | bigint | string | Uint8Array;
export type Stmt = {
  bind: (...b: unknown[]) => Stmt;
  first: (col?: string) => Promise<any>;
  all: () => Promise<{ results: Row[]; success: true; meta: { changes: number } }>;
  run: () => Promise<{ success: true; results: Row[]; meta: { changes: number; last_row_id: number } }>;
  _step: () => { results: Row[]; success: true; meta: { changes: number } };
};
export function d1(db: DatabaseSync) {
  const fix = (v: unknown) => (v === true ? 1 : v === false ? 0 : v) as SqlValue;
  const plain = (r: unknown): Row | null => (r === undefined ? null : { ...(r as Row) });
  const changes = () => Number(db.prepare('SELECT changes() AS c').get()!.c);
  const make = (sql: string, args: unknown[]): Stmt => {
    const s = db.prepare(sql);
    const a = args.map(fix);
    return {
      bind: (...b) => make(sql, b),
      first: async (col) => { const r = plain(s.get(...a)); return col == null ? r : (r ? r[col] : null); },
      all: async () => ({ results: (s.all(...a).map(plain) as Row[]), success: true, meta: { changes: 0 } }),
      run: async () => { const info = s.run(...a); return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; },
      /* inside batch: rows and the change count, synchronously */
      _step: () => { const results = (s.all(...a).map(plain) as Row[]); return { results, success: true, meta: { changes: changes() } }; },
    };
  };
  const batch = async (stmts: Stmt[]) => {
    db.exec('BEGIN');
    try { const out = stmts.map((st) => st._step()); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  /* the Sessions API (2026-09-17): every withSession constraint is recorded
     in `sessions`; one database answers them all, and the bookmark is a
     counter of the statements run, shaped like D1's */
  const sessions: string[] = [];
  let ticks = 0;
  const bookmark = () => (ticks++).toString(16).padStart(8, '0') + '-00000000-00000000-' + 'a'.repeat(32);
  const api = {
    prepare: (sql: string) => make(sql, []),
    batch,
    exec: async (sql: string) => { db.exec(sql); return { count: 1, duration: 0 }; },
    withSession: (constraint: string) => {
      if (constraint === 'refuse-me') throw new Error('D1_ERROR: bad bookmark');
      sessions.push(constraint);
      return { prepare: (sql: string) => make(sql, []), batch, getBookmark: () => bookmark() };
    },
    sessions,
    _db: db,
  };
  return api;
}

/* ---- the environment ------------------------------------------------------ */

/* a rate-limit binding that counts per key and records every call in `log`
   as [binding, key]; `max` is the per-key allowance (unlimited by default) */
export const limiter = (name = '', log: [string, string][] = [], max = Infinity) => {
  const seen = new Map<string, number>();
  return {
    limit: async ({ key }: { key: string }) => {
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      log.push([name, key]);
      return { success: n <= max };
    },
  };
};
const LIMITERS = ['POST_LIMIT', 'READ_LIMIT', 'CONNECT_LIMIT', 'POST_IP_LIMIT', 'READ_IP_LIMIT', 'CONNECT_IP_LIMIT'];
/* a binding whose real methods throw when reached (Workers AI, Vectorize); any
   other property reads as undefined so a stringify or a truthiness check passes */
const untouchable = (name: string, methods: string[]) => Object.fromEntries(methods.map((k) =>
  [k, () => { throw new Error(`env.${name}.${k} was reached from a test — stub it in makeEnv`); }]));

/* an in-memory R2 bucket that records every call; `snapshot()` (if given) is
   taken at the moment of each delete, so a rule can prove the ledger still
   named the key when the object went */
export type R2Call = { bucket: string; op: string; key?: string; size?: number; prefix?: string; at?: any };
type R2Stored = { bytes: Uint8Array; meta: { httpMetadata?: Row; customMetadata?: Row }; uploaded: Date };
export function r2Bucket(name: string, calls: R2Call[], snapshot?: (key: string) => any) {
  const objects = new Map<string, R2Stored>();
  const bytesOf = async (v: unknown): Promise<Uint8Array> => {
    if (v == null) return new Uint8Array();
    if (typeof v === 'string') return new TextEncoder().encode(v);
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return new Uint8Array(await new Response(v as BodyInit).arrayBuffer());
  };
  return {
    objects,
    async get(key: string) {
      calls.push({ bucket: name, op: 'get', key });
      const o = objects.get(key);
      return o ? { key, size: o.bytes.byteLength, httpMetadata: o.meta.httpMetadata || {}, customMetadata: o.meta.customMetadata || {},
        body: new Blob([o.bytes]).stream(), arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength),
        text: async () => new TextDecoder().decode(o.bytes) } : null;
    },
    async head(key: string) { calls.push({ bucket: name, op: 'head', key }); const o = objects.get(key); return o ? { key, size: o.bytes.byteLength } : null; },
    async put(key: string, value: unknown, meta: R2Stored['meta'] = {}) { const bytes = await bytesOf(value); objects.set(key, { bytes, meta, uploaded: new Date() }); calls.push({ bucket: name, op: 'put', key, size: bytes.byteLength }); return { key, size: bytes.byteLength }; },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) { calls.push({ bucket: name, op: 'delete', key, at: snapshot ? snapshot(key) : undefined }); objects.delete(key); }
    },
    async list(opts: { prefix?: string; limit?: number } = {}) {
      calls.push({ bucket: name, op: 'list', prefix: opts.prefix });
      const all = [...objects.entries()].filter(([k]) => !opts.prefix || k.startsWith(opts.prefix))
        .map(([key, o]) => ({ key, size: o.bytes.byteLength, uploaded: o.uploaded }));
      return { objects: opts.limit ? all.slice(0, opts.limit) : all, truncated: false };
    },
  };
}

/* the BoardHub as the worker sees it (env.HUB.get(id).method): every call
   recorded; who is "viewing" and who is online are the test's to say. Since
   the hub is sharded (Domain.Hub, 2026-09-17) the spy also records WHICH
   instance each call went to — `spy.calls` is [{name, method, args}] — so a
   test can prove a private event reached its home shard alone and a public
   one every shard; one stub answers for every name. */
type HubOpts = {
  viewersOf?: (tag: string, hashes: string[]) => string[];
  viewing?: (recipient: string, sender: string) => boolean;
  online?: (hashes: string[]) => any;
  stats?: () => { sockets: number; members: number };
};
export type HubSpy = {
  events: Row[]; viewing: [string, string][]; viewersOf: [string, string[]][]; presence: string[][];
  calls: { name: string; method: string; args: any[] }[]; fetched: string[];
  namespace: { idFromName: (n: string) => string; get: (name: unknown) => any };
  frames: (t: string) => Row[];
  names: (method: string) => string[];
};
export function hubSpy({ viewersOf = () => [], viewing = () => false, online = () => [], stats = () => ({ sockets: 0, members: 0 }) }: HubOpts = {}): HubSpy {
  const spy = { events: [], viewing: [], viewersOf: [], presence: [], calls: [], fetched: [] } as unknown as HubSpy;
  let current = 'board';
  const rec = (method: string, args: any[]) => spy.calls.push({ name: current, method, args });
  const stub = {
    publish: async (event: Row) => { rec('publish', [event]); spy.events.push(event); },
    relay: async (items: unknown) => { rec('relay', [items]); return { idle: [] }; },
    watch: async (from: string, register: string[], also: string[] = []) => { rec('watch', [from, register, also]); return online([...register, ...also]); },
    presenceOf: async (hashes: string[]) => { rec('presenceOf', [hashes]); spy.presence.push(hashes); return online(hashes); },
    dmViewing: async (recipient: string, sender: string) => { rec('dmViewing', [recipient, sender]); spy.viewing.push([recipient, sender]); return viewing(recipient, sender); },
    viewersOf: async (tag: string, hashes: string[]) => { rec('viewersOf', [tag, hashes]); spy.viewersOf.push([tag, hashes]); return viewersOf(tag, hashes); },
    stats: async () => { rec('stats', []); return stats(); },
    fetch: async (request: Request) => { rec('fetch', [request && request.url]); spy.fetched.push(current); return new Response('hub', { status: 200 }); },
  };
  spy.namespace = { idFromName: (n: string) => n, get: (name: unknown) => { current = String(name); return stub; } };
  spy.frames = (t) => spy.events.filter((e) => e.t === t);
  spy.names = (method) => spy.calls.filter((c) => c.method === method).map((c) => c.name);
  return spy;
}

/* Every binding wrangler.jsonc declares, as a request sees it. `vars` overrides
   or adds plain variables/secrets (ADMIN_HASHES, ALLOW_ANON, …). */
/* the send_email binding: records every message; `fail` makes send() throw
   with a code, the way a refused destination does */
export function emailSpy(sent: any[], fail?: string) {
  return {
    send: async (msg: any) => {
      sent.push(msg);
      if (fail) { const e = new Error(fail) as Error & { code?: string }; e.code = 'test_refused'; throw e; }
      return { messageId: 'test-' + sent.length };
    },
  };
}

type EnvOpts = {
  db?: DatabaseSync; libdb?: DatabaseSync; hub?: HubSpy; vars?: Row; snapshot?: (key: string) => any;
  emailFail?: string; email?: boolean; limits?: Record<string, number>;
};
/* The env a request sees, plus the suite's own logs. Bindings are reached by
   name and any test may add or swap one, so the bag is open (Row). */
export type TestEnv = Row & { r2: R2Call[]; emails: any[]; limited: [string, string][] };
export function makeEnv({ db, libdb, hub, vars = {}, snapshot, emailFail, email = true, limits = {} }: EnvOpts = {}): TestEnv {
  const r2: R2Call[] = [];
  const emails: any[] = [];
  const limited: [string, string][] = [];
  const lib = libdb || freshLibDb();
  return {
    DB: d1(db || freshDb()),
    LIBDB: d1(lib), LIBDB2: d1(lib), LIBDB3: d1(lib),
    ...Object.fromEntries(LIMITERS.map((n) => [n, limiter(n, limited, limits[n] == null ? Infinity : limits[n])])),
    AVATARS: r2Bucket('AVATARS', r2, snapshot), MEDIA: r2Bucket('MEDIA', r2, snapshot),
    WALLMEDIA: r2Bucket('WALLMEDIA', r2, snapshot), BACKUPS: r2Bucket('BACKUPS', r2, snapshot),
    AI: untouchable('AI', ['run']), MERECAT_INDEX: untouchable('MERECAT_INDEX', ['query', 'upsert', 'deleteByIds', 'getByIds']),
    MODERATION_MODE: 'off',
    ...(email ? { EMAIL: emailSpy(emails, emailFail) } : {}),
    ...(hub ? { HUB: hub.namespace } : {}),
    ...vars,
    /* the R2 call log, for the hygiene rules; the mails the alerts sent */
    r2,
    emails,
    /* every rate-limit call, [binding, key] */
    limited,
  };
}

/* an ExecutionContext whose background work can be awaited */
export type Ctx = { waitUntil: (p: unknown) => void; passThroughOnException: () => void; settle: () => Promise<PromiseSettledResult<unknown>[]>; tasks: Promise<unknown>[] };
export function ctx(): Ctx {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (p: unknown) => { tasks.push(Promise.resolve(p)); },
    passThroughOnException: () => {},
    settle: () => Promise.allSettled(tasks),
    tasks,
  };
}

/* a fetch that never reaches the network: it records the attempt and throws
   (or answers, when a responder is given). Restore in afterEach. */
export function netSpy(respond?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (respond) return respond(url, init);
    throw new Error('the network was reached from a test: ' + url);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/* lib.ts caches app_settings and the merecat config for five minutes; quota.ts
   caches the meter; oidc.ts GitHub's signing keys — reset between cases or a
   seeded setting (or a test's own issuer) is ignored */
export function resetCaches() {
  appSettingsCache.at = 0; appSettingsCache.s = null;
  merecatConfigCache.at = 0; merecatConfigCache.cfg = null;
  quotaCache.reading = null; quotaCache.failedAt = 0;
  keyCache.at = 0; keyCache.tried = 0; keyCache.keys = new Map(); keyCache.loading = null;
}

/* ---- identities ----------------------------------------------------------- */

/* the worker knows a member by sha256hex(key); seed the key deterministically */
export async function identity(seed: unknown) {
  /* The suffix is not decoration: a test identity's key must clear the key
     floor (`Domain.Auth.keyAcceptable`, 2026-09-18), because a real member
     holds the generated 43-character key and a fixture the worker refuses on
     every write would be testing the refusal instead of the road. Twenty-plus
     characters over three classes is the floor; `weakIdentity` below is the
     fixture for testing the floor ITSELF. */
  const key = 'mc-test-identity-' + String(seed) + '-Aa1';
  return { key, hash: await sha256hex(key) };
}
/* An identity whose key the floor refuses — one class under twenty characters. */
export async function weakIdentity(seed: unknown) {
  const key = 'guessable-' + String(seed);
  return { key, hash: await sha256hex(key) };
}
/* an ESTABLISHED identity — one that has passed a challenge — is not
   challenged again, and its uploads, calls and first DM are open
   (Domain.Turnstile, the default). The whole of it is `verified_at` (0018). */
export function establish(db: DatabaseSync, hash: string, now = 1_700_000_000) {
  db.prepare('INSERT OR IGNORE INTO profiles (hash, created_at) VALUES (?, ?)').run(hash, now);
  db.prepare('UPDATE profiles SET verified_at = ? WHERE hash = ? AND verified_at IS NULL').run(now, hash);
}
/* what a keyed READ leaves behind (registerMember): a row, and no record of
   anyone answering for it. Established it is NOT — that was the hole. */
export function seen(db: DatabaseSync, hash: string, now = 1_700_000_000) {
  db.prepare('INSERT OR IGNORE INTO profiles (hash, created_at) VALUES (?, ?)').run(hash, now);
}
/* a published X25519 public key (43 base64url chars), so DM roads that need one open */
export function publishKey(db: DatabaseSync, hash: string, now = 1_700_000_000) {
  const pub = Buffer.from(hash.slice(0, 32)).toString('base64url').slice(0, 43);
  db.prepare('INSERT OR REPLACE INTO dm_pubkeys (hash, pubkey, created_at) VALUES (?, ?, ?)').run(hash, pub, now);
}

/* ---- requests ------------------------------------------------------------- */

/* one request through default.fetch → { status, json, text, res, ctx }.
   `origin: null` sends no Origin header (a curl from CI, the pipeline's shape);
   `host` reaches the worker on another hostname (its workers.dev front door). */
export type CallOpts = { ip?: string; origin?: string | null; headers?: Record<string, string>; ctx?: Ctx; host?: string };
export type Answer = { status: number; json: any; text: string; res: Response; ctx: Ctx };
export async function call(worker: Worker, env: unknown, method: string, path: string, body?: unknown, { ip = '203.0.113.7', origin = ORIGIN, headers = {}, ctx: c, host = ORIGIN }: CallOpts = {}): Promise<Answer> {
  const h: Record<string, string> = { 'CF-Connecting-IP': ip, ...headers };
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET' && method !== 'HEAD') {
    if (origin !== null) h.Origin = origin;
    /* a FormData body travels as multipart (the Request writes its boundary) */
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body); }
  }
  const cx = c || ctx();
  const res = await worker.fetch(new Request(host + path, init), env, cx);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, res, ctx: cx };
}
/* a client bound to one worker + env: api.post('/api/comments/dm/unread', { key }) */
export function client(worker: Worker, env: unknown, defaults: CallOpts = {}) {
  return {
    post: (path: string, body?: unknown, opts?: CallOpts) => call(worker, env, 'POST', path, body, { ...defaults, ...opts }),
    get: (path: string, opts?: CallOpts) => call(worker, env, 'GET', path, undefined, { ...defaults, ...opts }),
  };
}
