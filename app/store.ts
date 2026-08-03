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

export function invalidate(prefix?: string) {
  if (prefix == null) { entries.clear(); return; }
  for (const k of Array.from(entries.keys())) {
    if (k.indexOf(prefix) === 0) entries.delete(k);
  }
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
      if (json && json.ok !== false) entries.set(key, { at: now(), ttl, json });
      return json;
    })
    .catch((err) => { inflight.delete(key); throw err; });
  inflight.set(key, p);
  return p;
}
