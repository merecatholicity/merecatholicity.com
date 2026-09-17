/* comments-worker/src/serve.ts — the one road every request takes in and every
   answer takes out (2026-09-17). `index.ts`'s `default.fetch` is
   `serve(request, env, ctx, route)`: the env is sealed before the router sees
   it, the router's answer is scanned before the network does (egress.ts), and
   whatever the seal refused along the way is reported even when a handler's
   own try/catch swallowed the throw, and a successful JSON answer that breaks
   a list Domain.Wire promises is noted. Kept apart from index.ts so a test can
   hand it a route of its own — index.ts is a composition root, and its table
   is not a place to plant a leak. */
import * as Wire from '../../purescript/output/Domain.Wire/index.js';
import { EnvLeak, guardResponse, refusal, sealEnv, secretValues, takeTrips } from './egress.ts';
import { PUBLIC_VARS } from './env.ts';
import type { Env } from './env.ts';
import { noteLeak, noteShape } from './ops.ts';

export type Route = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

function pathOf(request: Request): string {
  try { return new URL(request.url).pathname.replace(/\/+$/, '') || '/'; } catch (e) { return '?'; }
}
function siteOf(request: Request): string {
  let path = pathOf(request);
  /* a /@handle card names a member: the site is the road, not the person */
  if (path.startsWith('/@')) path = '/@…';
  return request.method + ' ' + path.slice(0, 80);
}

/* What a JSON answer holds at a field, in Domain.Wire's words. */
function kindAt(json: Record<string, unknown>, field: string): string {
  if (!Object.prototype.hasOwnProperty.call(json, field)) return 'absent';
  const v = json[field];
  return v === null ? 'null' : Array.isArray(v) ? 'list' : 'other';
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
  /* a successful JSON answer keeps the lists Domain.Wire promises; one that
     does not still goes (the reader's view refuses it) and is noted */
  const listed = Wire.listFields(request.method)(pathOf(request)).length > 0;
  const inspect = listed && status >= 200 && status < 300 ? (text: string, type: string) => {
    if (!/json/i.test(type)) return;
    let json: unknown;
    try { json = JSON.parse(text); } catch (e) { return; }
    if (!json || typeof json !== 'object' || Array.isArray(json) || (json as { ok?: unknown }).ok === false) return;
    const broken: string[] = Wire.brokenFields(request.method)(pathOf(request))((f: string) => kindAt(json as Record<string, unknown>, f));
    if (!broken.length) return;
    console.log(JSON.stringify({ event: 'shape_broken', site, fields: broken }));
    ctx.waitUntil(noteShape(env, { site, fields: broken }));
  } : undefined;
  return guardResponse(res, secretValues(rawEnv, PUBLIC_VARS), (names) => {
    console.log(JSON.stringify({ event: 'egress_blocked', site, status, names }));
    ctx.waitUntil(noteLeak(env, { kind: 'answer', site, names }));
  }, inspect);
}
