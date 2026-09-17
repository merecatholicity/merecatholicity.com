/* app/push.ts — keep a member's push subscription on the server's CURRENT
   VAPID key, on every app open (2026-09-17).

   A browser push subscription is bound to the applicationServerKey it was made
   with. When the worker's VAPID pair is rotated (it was, the same day, after
   the env disclosure), every existing subscription is left on the dead key:
   the push service refuses the worker's pushes (401/403, counted `failed`, not
   `dead`, so nothing is pruned) and the member silently stops being notified.
   The repair used to live only in the Settings element, which a member mounts
   by opening Settings — most never do. It now runs from the shell once per
   document, after first paint, and the Settings element calls the same code.

   What it does, and only when the member turned notifications on HERE
   (`mc-push-owner` is this identity) with the permission still granted:
     · the subscription is on the served key → nothing (no write, ever);
     · it is on another key → unsubscribe it, unregister its token, subscribe
       on the served key, register the new token;
     · the browser refuses to subscribe without a user gesture (WebKit may) →
       the attempt waits for the member's next real tap or key press anywhere
       in the app, where subscribe() is started synchronously inside the
       handler so the gesture still counts. No toggle, no prompt: the
       permission was already granted.
   A half-done move is remembered in `mc-push-resub` (the identity), so a
   member who closes the app before that tap is repaired on the next open.
   One read (`/push/vapid-key`, cacheable, unmetered) per open, and only for a
   member who has push on — never a poller. Dependencies come in as `PushEnv`
   so tests/js/push_heal.test.mjs drives it with no browser. */

const API = '/api/comments';

export type SubLike = {
  options?: { applicationServerKey?: ArrayBuffer | null } | null;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
};
export type PushManagerLike = {
  getSubscription(): Promise<SubLike | null>;
  subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<SubLike>;
};
export type PushEnv = {
  key(): string;                                      // the identity key in storage
  owner(): string;                                    // mc-push-owner: who turned push on, on THIS device
  pending(): string;                                  // mc-push-resub: an unfinished move, by identity
  setPending(v: string): void;
  permission(): string;                               // Notification.permission
  pushManager(): Promise<PushManagerLike | null>;     // null when no service worker stands
  getJson(url: string): Promise<{ ok?: boolean; key?: string } | null>;
  postJson(url: string, body: unknown): Promise<{ ok?: boolean } | null>;
  onNextGesture(run: () => void): void;               // once, on a real tap or key press
  healed(): void;                                     // a move finished outside the caller's await
};
export type HealResult = 'skipped' | 'current' | 'rotated' | 'deferred' | 'failed';

/* The standard VAPID applicationServerKey decoder: base64url → raw bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

async function register(env: PushEnv, key: string, sub: SubLike): Promise<boolean> {
  const res = await env.postJson(API + '/push/register',
    { key, platform: 'web', token: JSON.stringify(sub.toJSON()) }).catch(() => null);
  return !!(res && res.ok);
}

let inflight: Promise<HealResult> | null = null;

/* Single-flight: the shell's boot and an opening Settings sheet may both ask. */
export function healPushSubscription(env: PushEnv): Promise<HealResult> {
  if (!inflight) inflight = heal(env).finally(() => { inflight = null; });
  return inflight;
}

async function heal(env: PushEnv): Promise<HealResult> {
  const key = env.key();
  if (!key || env.permission() !== 'granted' || env.owner() !== key) return 'skipped';
  const pm = await env.pushManager().catch(() => null);
  if (!pm) return 'skipped';
  const sub = await pm.getSubscription().catch(() => null);
  const pending = env.pending() === key;
  if (!sub && !pending) return 'skipped';        // push is off here, or was never moved by us
  const served = await env.getJson(API + '/push/vapid-key').catch(() => null);
  if (!served || !served.ok || !served.key) return 'failed';
  const want = urlBase64ToUint8Array(served.key);

  if (sub) {
    const raw = sub.options && sub.options.applicationServerKey;
    const have = raw ? new Uint8Array(raw) : null;
    if (!have) return 'skipped';                 // cannot tell which key it holds: the toggle decides
    if (sameBytes(have, want)) {
      /* on the right key; if an earlier move subscribed but never registered, finish it */
      if (pending && (await register(env, key, sub))) env.setPending('');
      return 'current';
    }
    /* the key rotated: the old subscription is dead weight — take it down first
       (a subscribe on a new key beside a live one is refused) and remember the
       move is unfinished until the new token is registered */
    env.setPending(key);
    const oldToken = JSON.stringify(sub.toJSON());
    try { await sub.unsubscribe(); } catch (e) { /* the new subscribe still decides */ }
    env.postJson(API + '/push/unregister', { key, token: oldToken }).catch(() => null);
  }

  try {
    const fresh = await pm.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    if (await register(env, key, fresh)) env.setPending('');
    return 'rotated';
  } catch (e) {
    /* refused without a gesture: finish on the member's next tap, starting
       subscribe() inside the handler itself so the activation is still live */
    env.onNextGesture(() => {
      pm.subscribe({ userVisibleOnly: true, applicationServerKey: want })
        .then((fresh) => register(env, key, fresh))
        .then((ok) => { if (ok) { env.setPending(''); env.healed(); } })
        .catch(() => { /* the next open tries again: mc-push-resub still stands */ });
    });
    return 'deferred';
  }
}

/* The browser's side of PushEnv, and the once-per-document start. Called by the
   shell after it registers the service worker; never from a page boot. */
export function browserPushEnv(): PushEnv {
  const get = (k: string) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  return {
    key: () => get('mc-comment-key'),
    owner: () => get('mc-push-owner'),
    pending: () => get('mc-push-resub'),
    setPending: (v) => { try { if (v) localStorage.setItem('mc-push-resub', v); else localStorage.removeItem('mc-push-resub'); } catch (e) { /* blocked */ } },
    permission: () => (typeof Notification !== 'undefined' ? Notification.permission : 'default'),
    pushManager: async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? (reg.pushManager as unknown as PushManagerLike) : null;
    },
    getJson: (url) => fetch(url).then((r) => r.json()),
    postJson: (url, body) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json()),
    onNextGesture: (run) => {
      /* the events that grant transient activation: a touch ends with pointerup
         (pointerdown only counts for a mouse), a mouse press, a key */
      const kinds = ['pointerup', 'mousedown', 'keydown'];
      const once = () => { kinds.forEach((k) => document.removeEventListener(k, once, true)); run(); };
      kinds.forEach((k) => document.addEventListener(k, once, true));
    },
    /* an open Settings sheet re-reflects its toggle when a deferred move lands */
    healed: () => { document.dispatchEvent(new CustomEvent('mc-push-healed')); },
  };
}

export function installPushHeal(): void {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  const go = () => { healPushSubscription(browserPushEnv()).catch(() => { /* never in the reader's way */ }); };
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 5000 });
  else setTimeout(go, 2000);
}
