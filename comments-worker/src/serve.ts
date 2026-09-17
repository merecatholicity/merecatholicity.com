/* comments-worker/src/serve.ts — the one road every request takes in and every
   answer takes out (2026-09-17). `index.ts`'s `default.fetch` is
   `serve(request, env, ctx, route)`: the env is sealed before the router sees
   it, the router's answer is scanned before the network does (egress.ts), and
   whatever the seal refused along the way is reported even when a handler's
   own try/catch swallowed the throw. Kept apart from index.ts so a test can
   hand it a route of its own — index.ts is a composition root, and its table
   is not a place to plant a leak. */
import { EnvLeak, guardResponse, refusal, sealEnv, secretValues, takeTrips } from './egress.ts';
import { UNSCANNED } from './env.ts';
import type { Env } from './env.ts';
import { noteLeak } from './ops.ts';

export type Route = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

function siteOf(request: Request): string {
  let path = '?';
  try { path = new URL(request.url).pathname.replace(/\/+$/, '') || '/'; } catch (e) { /* keep ? */ }
  /* a /@handle card names a member: the site is the road, not the person */
  if (path.startsWith('/@')) path = '/@…';
  return request.method + ' ' + path.slice(0, 80);
}

export async function serve(request: Request, rawEnv: Env, ctx: ExecutionContext, route: Route): Promise<Response> {
  const env = sealEnv(rawEnv);
  const site = siteOf(request);
  let res: Response;
  try {
    res = await route(request, env, ctx);
  } catch (err) {
    if (!(err instanceof EnvLeak)) console.log(JSON.stringify({ event: 'unhandled', error: String(err) }));
    res = refusal();
  }
  if (takeTrips(env).length) ctx.waitUntil(noteLeak(env, { kind: 'enumerated', site, names: [] }));
  const status = res.status;
  return guardResponse(res, secretValues(rawEnv, UNSCANNED), (names) => {
    console.log(JSON.stringify({ event: 'egress_blocked', site, status, names }));
    ctx.waitUntil(noteLeak(env, { kind: 'answer', site, names }));
  });
}
