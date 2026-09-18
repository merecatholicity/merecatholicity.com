/* app/transport.ts — the read transport, out of the boot (the write-path port's
   P1, 2026-09-17).

   These six moved here VERBATIM from client/comments.ts, where they had been
   the boot's own since the classic client was one function: `fetchRetry` (the
   bounded network retry with its per-attempt timeout), the fresh-bypass pair
   (`freshOpts`/`stampFresh` — a recent writer must not be shown the browser's
   60-second cache of their own change), `freshParam` (the keyed reader's
   `fresh=1`), and the two store-backed reads `cachedJson`/`peekJson`.

   Why they move first: forty-eight call sites across the Lit views and
   `app/api.ts` reached them through `window.mcKit`, which meant `app/api.ts`
   could not have a transport until the classic client had booted — the shell
   polled every 500 ms for up to eight seconds waiting for `window.mcKit` to
   appear, purely to hand itself its own fetch. Here the store is a static
   import, so there is no ordering hazard left to lose a race to.

   Two rules this file must keep:

   1. **Never capture `fetch`.** The shell installs its own wrapper over
      `window.fetch` (`app/wirecheck.ts`: an `/api/` answer whose listed field
      is neither a list nor null makes `json()` reject). A module-level
      `const f = fetch` would freeze the unwrapped one; every call below looks
      the global up at call time, which is what inherits the check.
   2. **One store.** `client/` bundles separately from `app/` (two esbuild
      entries), so the classic client must reach this module through
      `window.mcTransport` — a static import from `client/` would bundle a
      SECOND copy of `app/store.ts` into docs/comments.js, and two caches that
      never invalidate each other is a bug with no symptom until it is a
      stale one. */
import * as store from './store.ts';

/* The caller's identity key, for `freshParam` alone. Wired by the shell (and,
   until the identity slice moves `state.key` out of the boot, it reads the
   classic client's state through that wiring — a lazy getter, so nothing here
   waits for the boot the way the old api.ts wire-up did). */
let keyFn: () => string = () => '';
export function configure(opts: { key?: () => string }) {
  if (opts.key) keyFn = opts.key;
}

/* Bounded retries for network failures only. An HTTP response of any
   status is final: the server spoke, retrying could only double an
   action. A rejected fetch means nothing arrived, so a short backoff
   and another try are safe, and the attempt count is small on purpose:
   after the last one the reader's manual refresh is the only restart.
   Every attempt also carries a hard timeout: a fetch that never settles
   (a flaky mobile radio, service-worker limbo) once hung a view's
   "Loading…" forever with no error and no retry — an aborted attempt is
   a network failure and rides the same ladder. Callers that manage their
   own AbortSignal keep it; the timeout only guards unsignalled calls. */
export const FETCH_TIMEOUT = 15000;
export function fetchRetry(url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void): Promise<Response> {
  function attempt(i: number): Promise<Response> {
    var init = opts;
    var timer = 0;
    if (typeof AbortController === 'function' && !(opts && opts.signal)) {
      var ctrl = new AbortController();
      init = Object.assign({}, opts, { signal: ctrl.signal });
      /* bare setTimeout, not window.setTimeout: identical in a browser (the
         clearTimeout below was already bare) and it lets this module run under
         Node, which is what tests/js/api.test.mjs drives it with. */
      timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT) as unknown as number;
    }
    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (i >= delays.length) throw new Error('Network error. Check your connection and try again.');
      if (onRetry) onRetry();
      return new Promise(function (resolve) { setTimeout(resolve, delays[i]); })
        .then(function () { return attempt(i + 1); });
    });
  }
  return attempt(0);
}

/* Reads are browser-cached for 60s. To someone who just wrote, that
   cache makes their own change vanish on reload, so recent writers
   bypass it until the cache would be fresh again. */
export function freshOpts(): RequestInit | undefined {
  var posted = 0;
  try { posted = Number(localStorage.getItem('mc-posted-at')) || 0; } catch (e) {}
  return (Date.now() - posted < 90000) ? { cache: 'no-store' } : undefined;
}

export function stampFresh() {
  try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e) {}
  store.invalidate();
}

/* Keyed visitors ask the server for the short-cache profile and keep
   today's behavior to the letter. Anonymous readers ride a five-minute
   browser cache, their repeat views never reaching the worker. */
export function freshParam(sep: string): string {
  return keyFn() ? sep + 'fresh=1' : '';
}

/* Reads route through the store: in-memory TTL + in-flight dedup — the
   free-tier budget law's second half, so rapid view hops render from memory
   instead of drawing keyed reads from the shared rate bucket. WRITES never
   come through here. (The `if (window.mcStore)` fallback this carried in the
   boot is gone with the move: the store is imported, so it always stands.) */
/* `Promise<any>` is the honest type here: the answer is whatever the endpoint
   returns, and every caller narrows it at the `.then`. (app/api.ts is where a
   read gets a real wire type — app/wire.ts — and it does not come through
   this door.) */
export function cachedJson(url: string, init: RequestInit | undefined, ttl: number): Promise<any> {
  return store.fetchJson(function (u, i) { return fetchRetry(u, i, [1000, 3000]); },
    url, init, { ttl: ttl, bypass: !!freshOpts() });
}

/* The synchronous half of cachedJson: what do we ALREADY know for this exact
   read? Returns the stored answer (from this tab, or from disk if the reader
   was here before) or null. A view seeds its first render from this, so a
   revisit paints real content in the first frame instead of a placeholder
   that is replaced a moment later — the "it was already there" feel.
   Null whenever nothing is stored, so every caller falls back to its
   ordinary loading state. */
export function peekJson(url: string, init?: RequestInit): any {
  try {
    if (freshOpts()) return null;      // the reader just wrote: never show them stale
    var hit = store.peek(store.keyFor(url, init));
    return hit ? hit.json : null;
  } catch (e) { return null; }
}
