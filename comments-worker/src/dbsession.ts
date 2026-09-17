/* dbsession.ts — D1 read replicas for the listed read routes (2026-09-17; the
   rule is Domain.Consistency).

   Without the Sessions API every query goes to the one single-threaded
   primary. Each routed request now runs against a session: a route on the
   kernel's read list starts wherever D1 likes (a nearby replica), or from the
   browser's bookmark when it has one, so a member always reads at least as
   fresh as their own last write; every other route starts at the primary,
   because a write that decides on what it read must not read the past. Within
   a session D1 is sequentially consistent — a write goes to the primary and
   every later read of the same request sees it.

   A request that wrote hands the browser its bookmark in an HttpOnly cookie
   scoped to /api (same-origin, so every fetch carries it back; no client
   code). Crons and the Durable Objects keep the plain binding: the primary.

   The session object has only prepare, batch and getBookmark; the adapter
   below keeps the binding's shape (exec, dump and withSession go to the real
   binding) so a handler cannot tell the difference, and it marks the request
   as having written when it prepares a statement the kernel calls a write. */
import * as Consistency from '../../purescript/output/Domain.Consistency/index.js';
import { deriveEnv } from './egress.ts';
import type { Env } from './env.ts';

export type DbSession = { env: Env; wrote: () => boolean; bookmark: () => string | null };

function cookieBookmark(request: Request): string {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== Consistency.cookieName) continue;
    const v = decodeURIComponent(part.slice(eq + 1).trim());
    return Consistency.bookmarkOk(v) ? v : '';
  }
  return '';
}

export function sessionEnv(env: Env, request: Request, method: string, path: string): DbSession {
  const real = env.DB;
  if (!real || typeof real.withSession !== 'function') {
    return { env, wrote: () => false, bookmark: () => null };
  }
  const saved = cookieBookmark(request);
  const constraint = Consistency.readsReplica(method)(path) ? (saved || 'first-unconstrained') : 'first-primary';
  let session: D1DatabaseSession;
  try { session = real.withSession(constraint); } catch (e) {
    /* a bookmark D1 will not take: the primary is always a safe start */
    session = real.withSession('first-primary');
  }
  let wrote = false;
  const db = {
    prepare(sql: string) {
      if (Consistency.isWriteSql(sql)) wrote = true;
      return session.prepare(sql);
    },
    batch<T = unknown>(stmts: D1PreparedStatement[]) { return session.batch<T>(stmts); },
    exec(sql: string) { wrote = true; return real.exec(sql); },
    dump() { return real.dump(); },
    withSession(c?: string) { return real.withSession(c); },
  } as unknown as D1Database;
  /* sealed like the env it derives from (egress.ts), with the session as DB */
  const scoped = deriveEnv(env, { DB: db });
  return { env: scoped, wrote: () => wrote, bookmark: () => session.getBookmark() };
}

/* After the handler: a request that wrote tells the browser how fresh it must
   read next. Never on a WebSocket upgrade, never when D1 gave no bookmark. */
export function finishSession(res: Response, s: DbSession): Response {
  if (!s.wrote() || res.status === 101) return res;
  const bm = s.bookmark();
  if (!bm || !Consistency.bookmarkOk(bm)) return res;
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', Consistency.cookieName + '=' + encodeURIComponent(bm) +
    '; Path=/api; Max-Age=' + Consistency.cookieMaxAge + '; Secure; HttpOnly; SameSite=Strict');
  return out;
}

/* The ops probe's view of replication: where one unconstrained read ran. */
export async function servedBy(env: Env): Promise<{ served_by_primary: boolean | null; served_by_region: string | null }> {
  try {
    const r = await env.DB.withSession('first-unconstrained').prepare('SELECT 1 AS one').run();
    const meta = (r && r.meta) as { served_by_primary?: boolean; served_by_region?: string } | undefined;
    return { served_by_primary: meta && typeof meta.served_by_primary === 'boolean' ? meta.served_by_primary : null,
      served_by_region: (meta && meta.served_by_region) || null };
  } catch (e) {
    return { served_by_primary: null, served_by_region: null };
  }
}
