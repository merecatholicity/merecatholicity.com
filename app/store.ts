/* The client-side API store (Wave A of the interior campaign): every read
   the views repeat flows through here — a fetch-through memo with TTLs that
   mirror the server's own cache semantics, in-flight dedup so two views
   asking the same question cost one request, and write-through invalidation
   so nothing stale survives an action. The free-tier budget law's second
   half: rapid view hops render from memory instead of drawing keyed reads
   from the shared 15/min bucket.

   Keys default to url + body, so the same keyed POST for two identities can
   never collide. `bypass` skips the cache read (the recent-writer fresh
   path) but still refreshes the entry. `invalidate(prefix)` sweeps every
   key that starts with the prefix; `invalidate()` sweeps all. Counters feed
   the audit gate (a slice that INCREASES requests fails). */

const entries = new Map();     // key -> { at, ttl, json }
const inflight = new Map();    // key -> Promise
export const metrics = { hits: 0, misses: 0, dedup: 0 };

function now() { return Date.now(); }

/* ---- The disk tier (stale-while-revalidate) ---------------------------------
   Until now this store died with the tab, so every first view of a page paid a
   round trip and showed a placeholder — even a page the reader had opened five
   minutes earlier. Persisting it is what makes a return visit paint in the
   first frame: `peek` answers SYNCHRONOUSLY, before render, and the network
   refreshes behind it.

   WHAT MAY BE WRITTEN is not a caching decision and does not live here — it is
   Domain.Cache.persistable, which refuses every /dm/ read by construction
   because those bodies are end-to-end encrypted and putting their plaintext on
   disk would undo that guarantee at the easiest possible point. Ages are
   classified by Domain.Cache.classify (fresh / stale / expired).

   Everything is keyed by IDENTITY: a different key writes a different store,
   and clearing on logout is a single removeItem — one reader's cached pages can
   never surface for the next person on the device. */
const DISK_PREFIX = 'mc-store:';
let diskKey = '';              // '' until an identity is known: nothing persists
let diskDirty = false;
let diskTimer = 0;

/* The kernel, if this environment has one. Guarded rather than assumed: the
   store is imported directly by unit tests (no window, no localStorage) and it
   also has to survive a half-loaded bundle in a browser. Both cases fall back
   to memory-only behaviour, which is exactly what this store did before. */
function core(): any {
  return (typeof window === 'undefined') ? null : (window as any).mcCore;
}
function haveDisk() {
  try { return typeof localStorage !== 'undefined' && !!localStorage; } catch (e) { return false; }
}
function persistable(key: string) {
  /* No kernel means no persistence: refusing to write is always safe, guessing
     at the rule is not — and the rule here is the DM privacy line. */
  const c = core();
  return !!(c && c.cachePersistable && c.cachePersistable(key));
}
function classify(age: number, ttl: number) {
  const c = core();
  if (!c || !c.cacheClassify) return age < ttl ? 'fresh' : 'expired';
  return c.cacheClassify(age, ttl);
}
function diskSlot() { return diskKey ? DISK_PREFIX + diskKey : ''; }

/* Called once the identity hash is known. Loads what was stored for THIS
   identity, dropping anything the current schema cannot read or that has aged
   past the stale horizon. Synchronous by design — it must finish before the
   first view renders, and it is one small localStorage read. */
export function hydrate(identity: string) {
  const id = String(identity || '');
  if (!id || id === diskKey || !haveDisk()) return;
  diskKey = id;
  try {
    const raw = localStorage.getItem(diskSlot());
    if (!raw) return;
    const blob = JSON.parse(raw);
    if (!blob || blob.v !== (core() && core().cacheSchema)) { localStorage.removeItem(diskSlot()); return; }
    const t = now();
    for (const k of Object.keys(blob.e || {})) {
      const e = blob.e[k];
      if (!e || classify(t - e.at, e.ttl) === 'expired') continue;
      /* Only fill gaps: anything this tab already fetched is newer than disk. */
      if (!entries.has(k)) entries.set(k, e);
    }
  } catch (e) { /* unreadable or blocked: the store simply starts empty */ }
}

/* Everything a reader keeps is thrown away together. Called on logout, so the
   next person on the device inherits nothing. */
export function forget() {
  try { if (diskSlot() && haveDisk()) localStorage.removeItem(diskSlot()); } catch (e) { /* blocked */ }
  entries.clear();
  diskKey = '';
}

function flushDisk() {
  diskTimer = 0;
  if (!diskDirty || !diskSlot() || !haveDisk()) return;
  diskDirty = false;
  try {
    const c = core();
    const out: Record<string, unknown> = {};
    let bytes = 0;
    /* Newest first, so a cap that bites drops the least useful entries rather
       than whichever the Map happened to yield last. */
    const rows = Array.from(entries.entries())
      .filter(([k]) => persistable(k as string))
      .sort((a: any, b: any) => b[1].at - a[1].at);
    const cap = (c && c.cacheMaxBytes) || 524288;
    for (const [k, e] of rows as any) {
      const line = JSON.stringify(e).length + (k as string).length + 8;
      if (bytes + line > cap) break;
      bytes += line;
      out[k as string] = e;
    }
    localStorage.setItem(diskSlot(), JSON.stringify({ v: c && c.cacheSchema, e: out }));
  } catch (e) {
    /* Quota, private mode, a serialisation cycle: persistence is an
       optimisation and must never break a working page. */
    try { localStorage.removeItem(diskSlot()); } catch (e2) { /* nothing more to try */ }
  }
}
function markDirty() {
  if (!diskSlot()) return;
  diskDirty = true;
  if (diskTimer) return;
  /* Debounced: a page that fires six reads writes once. */
  diskTimer = (setTimeout as any)(flushDisk, 1200);
}

/* The missing primitive: a SYNCHRONOUS look, so a view can render real content
   in its first frame instead of painting a placeholder and replacing it one
   microtask later. Returns null when there is nothing worth showing.
   `stale` tells the caller it should still refresh. */
export function peek(key: string): { json: any; stale: boolean } | null {
  const hit = entries.get(key);
  if (!hit) return null;
  const how = classify(now() - hit.at, hit.ttl);
  if (how === 'expired') { entries.delete(key); return null; }
  return { json: hit.json, stale: how === 'stale' };
}

/* The key a given read would use — the same derivation fetchJson does, exposed
   so a view can peek before it asks. One source, so the two can never drift. */
export function keyFor(url: string, init?: RequestInit) {
  return url + '|' + (((init && init.body) || '') as string);
}

export function invalidate(prefix?: string) {
  if (prefix == null) entries.clear();
  else {
    for (const k of Array.from(entries.keys())) {
      if (k.indexOf(prefix) === 0) entries.delete(k);
    }
  }
  /* Rewrite the disk copy from what survived, or a key just invalidated by a
     write would walk back in on the next load — the exact bug persistence
     invites, and the reason invalidate lives above the disk tier. */
  markDirty();
  flushDisk();
}

/* fetchJson(fetcher, url, init, opts) — fetcher is the caller's own
   transport (comments.js hands its fetchRetry so retry semantics stay
   exactly what they were); opts: { ttl (ms), key, bypass }. Only 2xx JSON
   with ok !== false is cached; refusals and errors pass through uncached so
   a rate-limited answer can never be memoized.

   A THROTTLED read self-heals here, in the one place every cached read
   passes: the server's 429 rides a rolling per-IP minute, so a rapid
   navigator's burst frees tokens within seconds — two quiet waits and
   re-asks turn "Too many requests" from a dead 'could not be loaded' page
   into a briefly-late render. Bounded (each re-ask draws the bucket too);
   past the ladder the refusal reaches the view as before. */
const THROTTLE_WAITS = [1600, 3500];
function throttled(json: { ok?: boolean; error?: unknown } | null | undefined) {
  return !!(json && json.ok === false && /too many|slow down/i.test(String(json.error || '')));
}
export function fetchJson(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> | Response,
  url: string,
  init?: RequestInit,
  opts?: { ttl?: number; key?: string; bypass?: boolean },
) {
  opts = opts || {};
  const ttl = opts.ttl == null ? 45000 : opts.ttl;
  const key = opts.key || (url + '|' + (((init && init.body) || '') as string));
  const hit = entries.get(key);
  if (!opts.bypass && hit && now() - hit.at < hit.ttl) {
    metrics.hits++;
    return Promise.resolve(hit.json);
  }
  const flying = inflight.get(key);
  if (flying) { metrics.dedup++; return flying; }
  metrics.misses++;
  const ask = (attempt: number): Promise<any> =>
    Promise.resolve(fetcher(url, init))
      .then((r) => r.json())
      .then((json) => {
        if (throttled(json) && attempt < THROTTLE_WAITS.length) {
          return new Promise((res) => setTimeout(res, THROTTLE_WAITS[attempt]))
            .then(() => ask(attempt + 1));
        }
        return json;
      });
  const p = ask(0)
    .then((json) => {
      inflight.delete(key);
      if (json && json.ok !== false) {
        entries.set(key, { at: now(), ttl, json });
        if (persistable(key)) markDirty();
      }
      return json;
    })
    .catch((err) => { inflight.delete(key); throw err; });
  inflight.set(key, p);
  return p;
}
