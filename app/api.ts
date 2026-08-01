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
function get(url: string, ttl: number) {
  return store.fetchJson(tx, url, undefined, { ttl, bypass: !!freshFn() });
}
/* a cached POST-read (keyed reads that are still safe to memo briefly) */
function postRead(path: string, body: unknown, ttl: number) {
  return store.fetchJson(tx, API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { ttl, bypass: !!freshFn() });
}
/* an uncached write; caller passes prefixes to invalidate on success */
function write(base: string, path: string, body: unknown, invalidate?: (string | null)[]) {
  return Promise.resolve(tx(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).then((r) => r.json()).then((d) => {
    if (d && d.ok && invalidate) (invalidate.length ? invalidate : [null])
      .forEach((p: string | null) => store.invalidate(p == null ? undefined : p));
    return d;
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
export const dmThreads = (p?: number) => postRead('/dm/threads', { key: keyFn(), p: p || 1 }, 20000);
export const dmThread = (other: string, p?: number) => postRead('/dm/thread', { key: keyFn(), with: other, ...(p ? { p } : {}) }, 15000);
export const dmSend = (to: string, body: string, token: string) => write(API, '/dm/send', { to, body, token, key: keyFn() }, [API + '/dm']);
export const dmBlock = (hash: string, blocked: boolean) => write(API, '/dm/block', { hash, blocked, key: keyFn() }, [API + '/dm']);
export const dmDelete = (other: string) => write(API, '/dm/delete', { with: other, key: keyFn() }, [API + '/dm']);
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
