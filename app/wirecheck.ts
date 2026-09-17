/* The lists the wire promises, kept for every read the page makes
   (Domain.Wire, 2026-09-17). For six weeks `GET /api/comments/recent`
   answered `items` as one object, and the Recent activity view read
   `d.items.length` as nothing and said "Nothing here yet." The shell wraps the
   page's `fetch` once: an answer from the worker (`/api/…`) whose `json()`
   holds a listed field that is neither a list nor null makes `json()` reject,
   so every view — classic or Lit, through the store or not — lands in its
   "could not be loaded" state instead of an empty one. Nothing else about a
   response changes. */
import { wireBroken } from './core.ts';

export const MALFORMED = 'The server sent an answer this page cannot read.';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init && init.method) return init.method;
  if (typeof input === 'object' && !(input instanceof URL) && input.method) return input.method;
  return 'GET';
}

/* the response, its json() now keeping the wire's promise */
export function wireChecked(res: Response, method: string, url: string): Response {
  if (!/(^|\/\/[^/]+)\/api\//.test(url)) return res;
  const read = res.json.bind(res);
  res.json = () => read().then((d: unknown) => {
    const broken = wireBroken(method, url, d);
    if (broken.length) {
      console.warn('mc-wire: ' + method + ' ' + url.split('?')[0] + ' broke ' + broken.join(', '));
      throw new Error(MALFORMED);
    }
    return d;
  });
  return res;
}

type Fetch = typeof fetch & { mcWire?: true };
export function installWireCheck(w: { fetch: Fetch }): void {
  if (w.fetch.mcWire) return;
  const orig = w.fetch.bind(w);
  const wrapped: Fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => orig(input, init).then((res) => wireChecked(res, methodOf(input, init), urlOf(input))),
    { mcWire: true as const },
  );
  w.fetch = wrapped;
}
