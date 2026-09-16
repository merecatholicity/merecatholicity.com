/* Ambient declarations for the cross-module bridges the client uses. The bundle
   (app/**) and the served-raw client (client/comments.ts) talk to each other only
   through these `window.mc*` seams — the classic client delegates to the bundle
   with `if (window.mcCore) …`, and the Lit views receive `mcKit` by reference.
   Typed loosely where the shape is genuinely dynamic (mcKit is a ~55-helper grab
   bag), derived where it can be (mcCore is `typeof` the membrane). Third-party
   globals (turnstile, nacl) are declared where they are loaded, not bundled. */

export {};

/* The PureScript↔JS membrane (app/core.ts) — DERIVED from its exports since
   2026-09-16: a member added to core.ts is typed here at once, and a member the
   UI names that core.ts does not export is a compile error (three of this
   month's tsc failures were declaration drift, not bugs). */
type McCore = typeof import('./app/core');

interface McStore {
  fetchJson(fetcher: (url: string, init?: RequestInit) => Promise<Response> | Response,
            url: string, init?: RequestInit,
            opts?: { ttl?: number; key?: string; bypass?: boolean }): Promise<any>;
  invalidate(prefix?: string): void;
  metrics: { hits: number; misses: number; dedup: number };
  /* The disk tier (stale-while-revalidate). peek is SYNCHRONOUS on purpose:
     a view seeds its first render from it, so a return visit shows real content
     in the first frame. hydrate/forget bind the store to one identity. */
  peek?(key: string): { json: any; stale: boolean } | null;
  keyFor?(url: string, init?: RequestInit): string;
  hydrate?(identity: string): void;
  forget?(): void;
}

interface McInstall { evt: any; available?: () => boolean; prompt: () => void; }

declare global {
  interface Window {
    mcCore?: McCore;
    mcStore?: McStore;
    mcApi?: Record<string, (...args: any[]) => any>;
    mcRich?: { appendRich: (...a: any[]) => any; fillBody: (...a: any[]) => any; [k: string]: any };
    mcLive?: {
      board: { sub: (scopes: string[]) => void; leave: () => void };
      member: { enable: (key: string, hash: string) => void; disable: () => void;
                typing?: (to: string | string[], state?: string, thread?: number) => void; setPresence?: (mode: string) => void;
                callSig?: (to: string, f: { call?: string; kind?: string; payload?: unknown }) => boolean;
                presenceMode?: () => string };
      chat: (chatId: string | number, key: string, onFrame: (m: any) => void) =>
            { send: (o: any) => boolean; ready: () => boolean; close: () => void };
      _conns?: any[];
    };
    /* mcKit is the per-boot ~55-helper bridge handed to the Lit views by reference;
       genuinely dynamic — indexed as any, with the stable fields named. */
    mcViews?: Record<string, (...args: any[]) => any>;
    mcKit?: { state: any; API: string; [k: string]: any };
    mcPrefs?: { receipts: string; notify_reply: number; notify_mention: number; notify_dm: number };
    mcInstall?: McInstall;
    mcOnboard?: (onDone?: any, opts?: any) => void;
    mcConfirm?: (msg: string, opts?: any) => Promise<boolean>;
    mcDialog?: (opts: { title: string; body: Node; actions?: HTMLElement[] }) => { close: () => void; body: HTMLElement };
    mcToast?: (msg: string, opts?: any) => void;
    mcSheet?: { open: (...a: any[]) => void; settings?: () => void; close: () => void; lock?: () => boolean | void; unlock?: () => void };
    /* the keyboard shackle (app/appchrome.ts, 2026-09-12): the visible region under the soft keyboard and the placing of a field into it */
    /* haptics (app/haptic.ts, 2026-09-12): a buzz where the device has one, the ring's pattern */
    /* badges everywhere (app/badges.ts, 2026-09-12): the shell's refresh of the two counts */
    mcBadges?: { refresh: (which: 'dm' | 'notif') => void; set: (which: 'dm' | 'notif', n: number) => void };
    mcHaptic?: { haptic: (kind: string) => boolean; ringStart: () => void; ringStop: () => void };
    mcKeyboard?: { region: () => { top: number; bottom: number }; align: (el: Element, region?: { top: number; bottom: number }) => boolean; inset: () => number; isField: (el: unknown) => boolean; pretend: (raw: { top: number; bottom: number } | null) => void };
    mcGetDark?: () => string;
    mcSetDark?: (p: string) => void;
    mcGetLight?: () => string;
    mcSetLight?: (p: string) => void;
    mcDeeplink?: { run: () => void; reveal: () => void };
    /* The shell's programmatic soft navigation. Any in-app hop written in
       code (after posting, opening a conversation, submitting a search) must
       go through this, not `location.href` — a raw assignment is a full
       document load: the white flash, the lost scroll, the dropped socket. */
    mcNav?: (href: string, replace?: boolean) => void;
    /* Cache keys for what the client fetches or injects at runtime, stamped
       into nav.js by scripts/stamp_versions.py. They live there rather than in
       this bundle's source because a key written HERE would change the bundle,
       which would change the bundle's own key — a fixpoint with no solution. */
    mcAssets?: Record<string, string>;
    mcAsset?: (name: string) => string;
    /* The version manifest and what this page is running (docs/nav.js), read
       by Settings → About so the panel and the update banner cannot disagree. */
    mcVersion?: {
      running: () => Record<string, string>;
      served: () => { build: string; assets: Record<string, string> } | null;
      stale: () => string[];
      check: () => Promise<any>;
    };
    mcTyping?: () => boolean;
    /* nav.js's persistent breadcrumb ring: it survives the very reload it
       exists to explain, so anything that unloads or replaces the page
       should name itself here first. */
    mcCrumb?: (msg: string) => void;
    mcCommentsBoot?: () => void;
    mcCommentsTeardown?: () => void;
    mcSelectSheet?: (...a: any[]) => any;
    turnstile?: any;
    nacl?: any;
  }
  /* Loaded as classic scripts on the pages that need them, not bundled. */
  const turnstile: any;
  const nacl: any;
}
