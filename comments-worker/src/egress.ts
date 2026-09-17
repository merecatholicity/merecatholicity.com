/* comments-worker/src/egress.ts — nothing the worker holds in secret leaves it
   (2026-09-17). For six weeks `GET /api/comments/recent` answered with the
   whole env: a handler handed `env` to a row mapper that began
   `Object.assign({}, row)`, both sides typed `any`, and the route answered 200.
   Two walls stand now, each where every answer already passes:

   - the env is SEALED at every entry (fetch, scheduled, both Durable
     Objects). Reading a binding or a var by name works as before;
     enumerating or serializing the env throws EnvLeak — so
     `Object.assign({}, env)`, `{...env}`, `JSON.stringify` of anything that
     holds it, `Object.keys`, `for…in` and a logged env fail at once instead of
     copying every secret. A seal is made per request and remembers each trip,
     so a handler whose own try/catch swallows the throw is still reported;
   - every text answer and every hub frame is SCANNED for the value of every
     env string that is not a declared public var. Default-deny: a secret
     added with `wrangler secret put` is covered without a line here. An
     answer that carries one is replaced by the usual 500, and only the
     secret's NAME is reported, never its value.

   Dependency-free on purpose: contact-worker/src/index.ts imports it too. */

export class EnvLeak extends Error {
  constructor(what: string) {
    super('the worker env was ' + what + ' — it is sealed (egress.ts)');
    this.name = 'EnvLeak';
  }
}

/* The shortest value the scan looks for. A shorter secret could occur in
   ordinary text; the daily self-check names it instead (shortSecrets). */
export const MIN_SECRET_LENGTH = 16;

type Seal = { raw: object; overrides: Record<string, unknown>; trips: string[] };
const SEALS = new WeakMap<object, Seal>();

function sealOf<E extends object>(seal: Seal): E {
  const refuse = (what: string): never => {
    seal.trips.push(what);
    console.log(JSON.stringify({ event: 'env_enumerated', what }));
    throw new EnvLeak(what);
  };
  const own = (prop: string | symbol): prop is string =>
    typeof prop === 'string' && Object.prototype.hasOwnProperty.call(seal.overrides, prop);
  /* The target is an empty object, so no Proxy invariant ties the traps to the
     raw env's property attributes; every read is forwarded by hand. */
  const proxy = new Proxy(Object.create(null) as E, {
    get(_t, prop) {
      if (prop === 'toJSON') return () => refuse('serialized');
      if (own(prop)) return seal.overrides[prop];
      return Reflect.get(seal.raw, prop);
    },
    has(_t, prop) { return own(prop) || Reflect.has(seal.raw, prop); },
    getOwnPropertyDescriptor(_t, prop) {
      if (own(prop)) return { value: seal.overrides[prop], writable: false, enumerable: false, configurable: true };
      const d = Reflect.getOwnPropertyDescriptor(seal.raw, prop);
      return d ? { ...d, enumerable: false, configurable: true } : undefined;
    },
    ownKeys() { return refuse('enumerated'); },
    set() { return refuse('written'); },
    defineProperty() { return refuse('written'); },
    deleteProperty() { return refuse('written'); },
    setPrototypeOf() { return refuse('written'); },
  });
  SEALS.set(proxy, seal);
  return proxy;
}

/* A fresh seal over the raw env (a sealed env is re-sealed over its raw one,
   sharing nothing but the bindings). */
export function sealEnv<E extends object>(env: E): E {
  const had = SEALS.get(env);
  return sealOf<E>({ raw: had ? had.raw : env, overrides: had ? { ...had.overrides } : {}, trips: [] });
}

/* The env a handler runs against with some bindings swapped (dbsession.ts: the
   D1 session in place of DB). Sealed like its base and sharing its trips, so
   the request still hears of a trip made through the derived env. An
   unsealed base (a unit test calling the helper directly) keeps the plain
   prototype road it always had. */
export function deriveEnv<E extends object>(env: E, overrides: Record<string, unknown>): E {
  const base = SEALS.get(env);
  if (!base) {
    const scoped = Object.create(env) as E;
    for (const k of Object.keys(overrides)) Object.defineProperty(scoped, k, { value: overrides[k], enumerable: true });
    return scoped;
  }
  return sealOf<E>({ raw: base.raw, overrides: { ...base.overrides, ...overrides }, trips: base.trips });
}

/* Every trip the seal saw since the last call (the entry reports them once). */
export function takeTrips(env: object): string[] {
  const s = SEALS.get(env);
  if (!s || !s.trips.length) return [];
  return s.trips.splice(0, s.trips.length);
}

const rawOf = (env: object): Record<string, unknown> =>
  ((SEALS.get(env) || { raw: env }).raw) as Record<string, unknown>;

/* [name, value] for every env string that is not public and long enough to
   scan for, from the sealed or the raw env. */
export function secretValues(env: object, publicVars: readonly string[]): Array<[string, string]> {
  const raw = rawOf(env);
  const out: Array<[string, string]> = [];
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (typeof v === 'string' && publicVars.indexOf(k) === -1 && v.length >= MIN_SECRET_LENGTH) out.push([k, v]);
  }
  return out;
}

/* The names of non-public env strings too short for the scan to guard. */
export function shortSecrets(env: object, publicVars: readonly string[]): string[] {
  const raw = rawOf(env);
  return Object.keys(raw).filter((k) => {
    const v = raw[k];
    return typeof v === 'string' && v !== '' && publicVars.indexOf(k) === -1 && v.length < MIN_SECRET_LENGTH;
  }).sort();
}

/* The forms a value takes once an answer has escaped it: as written, inside a
   JSON string, inside HTML, inside a URL. */
function forms(v: string): string[] {
  const html = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return Array.from(new Set([v, JSON.stringify(v).slice(1, -1), html, encodeURIComponent(v)]));
}

/* Which secrets a text carries, by name, in any of those forms. */
export function leakedNames(text: string, secrets: ReadonlyArray<[string, string]>): string[] {
  const out: string[] = [];
  for (const [k, v] of secrets) if (forms(v).some((f) => text.indexOf(f) !== -1)) out.push(k);
  return out;
}

/* Only a textual answer's body is read (SVG counts: it is XML a browser
   renders). A binary one (an avatar, a media object, a ciphertext) and one
   with no declared type go out untouched: nothing the worker builds from a
   string lacks a type, and reading a video as text would cost the request its
   CPU. Every answer's HEADERS are read. */
const TEXTUAL = /^(text\/|application\/([\w.+-]*\+)?(json|xml)\b|application\/javascript\b|image\/svg\+xml\b)/i;

export const REFUSAL_TEXT = 'Server hiccup. Please try again shortly.';

export function refusal(): Response {
  return new Response(JSON.stringify({ ok: false, error: REFUSAL_TEXT }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* The answer as it would leave, or the refusal when it carries a secret. */
export async function guardResponse(
  res: Response,
  secrets: ReadonlyArray<[string, string]>,
  onBlock: (names: string[]) => void,
): Promise<Response> {
  if (!secrets.length) return res;
  /* the headers of every answer (a Location, a cookie), the body of a textual one */
  const heads: string[] = [];
  res.headers.forEach((value, name) => { heads.push(name + ': ' + value); });
  const inHeaders = leakedNames(heads.join('\n'), secrets);
  if (inHeaders.length) {
    onBlock(inHeaders);
    return refusal();
  }
  if (res.status === 101 || res.body === null) return res;
  if ((res as Response & { webSocket?: unknown }).webSocket) return res;
  if (!TEXTUAL.test(res.headers.get('Content-Type') || '')) return res;
  const text = await res.text();
  const names = leakedNames(text, secrets);
  if (names.length) {
    onBlock(names);
    return refusal();
  }
  return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
}
