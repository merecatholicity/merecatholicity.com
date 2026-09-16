/* The client SDK for the real headless API (interior campaign, Phase 4) —
   the swappable seam enchant.games achieves with content-loader.js, here for
   the LIVE Worker (comments/board/DMs/notifications/profiles/merecat on
   D1/R2/Vectorize). One named function per operation, the whole surface in
   one place and documented in comments-worker/API.md, so a new feature calls
   `mcApi.category('pub', 2)` instead of hand-writing a fetch + cache + retry.

   READS route through the store (app/store.js): in-memory TTL + in-flight
   dedup, invalidated by any write — the free-tier budget law's second half.
   WRITES go direct (never cached) and INVALIDATE the reads they change, so a
   post never leaves a stale listing behind. Transport is injected at wire-up
   (comments.js hands its proven fetchRetry), so retry/timeout semantics stay
   exactly what the site already ships; this module adds no new behavior, only
   a single honest surface over it. Exposed as window.mcApi by the shell. */

import * as store from './store.ts';
import type { DmRosterPayload, DmThreadPayload, DmThreadsPayload } from './wire.ts';

const API = '/api/comments';
const MERECAT = '/api/merecat';

/* Wired once (shell): tx = the raw transport (fetchRetry-like, returns a
   Response), keyFn = () => the caller's identity key, freshFn = () => bypass
   the read cache while a recent writer's own change would otherwise be hidden. */
type Transport = (url: string, init?: RequestInit) => Promise<Response> | Response;
let tx: Transport = (url: string, init?: RequestInit) => fetch(url, init).then((r) => r);
let keyFn: () => string = () => '';
let freshFn: () => boolean = () => false;

export function configure(opts: { tx?: Transport; key?: () => string; fresh?: () => boolean }) {
  if (opts.tx) tx = opts.tx;
  if (opts.key) keyFn = opts.key;
  if (opts.fresh) freshFn = opts.fresh;
}

function q(sep: string) { return keyFn() && freshFn() ? sep + 'fresh=1' : ''; }

/* a cached GET (through the store) */
function get<T = any>(url: string, ttl: number): Promise<T> {
  return store.fetchJson(tx, url, undefined, { ttl, bypass: !!freshFn() }) as Promise<T>;
}
/* a cached POST-read (keyed reads that are still safe to memo briefly) */
function postRead<T = any>(path: string, body: unknown, ttl: number): Promise<T> {
  return store.fetchJson(tx, API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { ttl, bypass: !!freshFn() }) as Promise<T>;
}
/* an uncached write; caller passes prefixes to invalidate on success */
function write<T = any>(base: string, path: string, body: unknown, invalidate?: (string | null)[]): Promise<T> {
  return Promise.resolve(tx(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).then((r) => r.json()).then((d) => {
    if (d && d.ok && invalidate) (invalidate.length ? invalidate : [null])
      .forEach((p: string | null) => store.invalidate(p == null ? undefined : p));
    return d as T;
  });
}

/* ---- board & comments (reads) ---- */
export const pageComments = (path: string) => get(API + '?page=' + encodeURIComponent(path) + q('&'), 45000);
export const boardIndex = () => get(API + '/board' + q('?'), 45000);
export const category = (cat: string, p?: number) => get(API + '/board/cat?cat=' + cat + '&p=' + (p || 1) + q('&'), 45000);
export const topic = (id: string | number, extra?: string) => get(API + '/board/topic?id=' + id + (extra || '') + q('&'), 30000);
export const authorPosts = (hash: string, p?: number) => get(API + '/board/author?hash=' + hash + '&p=' + (p || 1) + q('&'), 45000);
export const search = (qs: string) => get(API + '/search?' + qs + q('&'), 30000);
export const profile = (hash: string) => get(API + '/profile?hash=' + hash + q('&'), 30000);
export const directory = () => get(API + '/dm/directory' + q('?'), 45000);
export const backroomCat = (p?: number) => postRead('/board/admin', { key: keyFn(), p: p || 1 }, 45000);
export const backroomTopic = (id: string | number, p?: number, find?: string | number) => postRead('/board/admin', { key: keyFn(), id, p, find }, 30000);

/* ---- board & comments (writes) ---- */
export const post = (payload: Record<string, unknown>) => write(API, '', { ...payload, key: keyFn() }, ['']);   // full invalidate: counts everywhere shift
export const edit = (id: string | number, body: string, token: string) => write(API, '/edit', { id, body, token, key: keyFn() }, ['']);
export const remove = (id: string | number) => write(API, '/delete', { id, key: keyFn() }, ['']);
export const report = (id: string | number, reason: string) => write(API, '/report', { id, reason, key: keyFn() }, []);
export const watch = (topicId: string | number, act: string) => write(API, '/watch', { topic: topicId, act, key: keyFn() }, []);
export const markRead = (topicId: string | number) => write(API, '/board/read', { topic: topicId, key: keyFn() }, [API + '/board']);
export const markAllRead = () => write(API, '/board/read-all', { key: keyFn() }, [API + '/board']);

/* ---- DMs & notifications ---- */
/* A conversation is addressed by its id ({thread_id}) — the only door a group
   has — or, a pair, by its other (a 64-hex string, or {with}); 2026-09-13. */
type DmTarget = string | { thread_id?: number; with?: string };
const dmTarget = (t: DmTarget) => (typeof t === 'string' ? { with: t } : { ...(t.thread_id ? { thread_id: t.thread_id } : {}), ...(t.with ? { with: t.with } : {}) });
export const dmThreads = (p?: number) => postRead<DmThreadsPayload>('/dm/threads', { key: keyFn(), p: p || 1 }, 20000);
export const dmThread = (target: DmTarget, p?: number) => postRead<DmThreadPayload>('/dm/thread', { key: keyFn(), ...dmTarget(target), ...(p ? { p } : {}) }, 15000);
/* The sealed envelope: {thread_id | to, body:'E3.…', enc:3, keys:{hash: sealed}, media_key?, token}; a pair's E1 body ({to, body, enc:1}) one deploy longer. */
export const dmSend = (payload: Record<string, unknown>) => write(API, '/dm/send', { ...payload, key: keyFn() }, [API + '/dm']);
export const dmForward = (items: Record<string, unknown>[], token: string) => write(API, '/dm/forward', { items, token, key: keyFn() }, [API + '/dm']);
export const dmRoster = (target: DmTarget) => postRead<DmRosterPayload>('/dm/roster', { key: keyFn(), ...dmTarget(target) }, 5000);
export const dmGroups = (members: string[], name: string | null, token: string) => write(API, '/dm/groups', { members, name, token, key: keyFn() }, [API + '/dm']);
export const dmMembers = (threadId: number, add: string[], token: string) => write(API, '/dm/members', { thread_id: threadId, add, token, key: keyFn() }, [API + '/dm']);
export const dmLeave = (threadId: number) => write(API, '/dm/leave', { thread_id: threadId, key: keyFn() }, [API + '/dm']);
export const dmName = (threadId: number, name: string) => write(API, '/dm/name', { thread_id: threadId, name, key: keyFn() }, [API + '/dm']);
export const dmBlock = (hash: string, blocked: boolean) => write(API, '/dm/block', { hash, blocked, key: keyFn() }, [API + '/dm']);
export const dmDelete = (target: DmTarget) => write(API, '/dm/delete', { ...dmTarget(target), key: keyFn() }, [API + '/dm']);
export const notifications = (p?: number) => postRead('/notifications', { key: keyFn(), p: p || 1 }, 15000);
export const notificationsRead = () => write(API, '/notifications/read', { key: keyFn() }, [API + '/notifications']);

/* ---- profiles ---- */
export const saveProfile = (fields: Record<string, unknown>) => write(API, '/profile', { ...fields, key: keyFn() }, [API + '/profile']);

/* ---- merecat (the librarian) ---- */
export const merecatUsage = () => write(MERECAT, '/usage', { key: keyFn() }, []);
export const merecatChats = () => write(MERECAT, '/chats', { key: keyFn() }, []);
export const merecatChat = (id: string | number) => write(MERECAT, '/chat', { key: keyFn(), id }, []);
export const merecatForward = (chat: string | number, msg: string | number, topicId: string | number) => write(MERECAT, '/forward', { key: keyFn(), chat, msg, topic: topicId }, ['']);
/* /ask is a streaming endpoint driven by the merecat engine directly, not
   through this JSON SDK — see app/merecat-engine within comments.js. */

export { API, MERECAT };
