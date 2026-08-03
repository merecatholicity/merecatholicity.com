/* Ambient declarations for the cross-module bridges the client uses. The bundle
   (app/**) and the served-raw client (client/comments.ts) talk to each other only
   through these `window.mc*` seams — the classic client delegates to the bundle
   with `if (window.mcCore) …`, and the Lit views receive `mcKit` by reference.
   Typed loosely where the shape is genuinely dynamic (mcKit is a ~55-helper grab
   bag), precisely where it is stable (mcCore is the PS↔JS membrane). Third-party
   globals (turnstile, nacl) are declared where they are loaded, not bundled. */

export {};

/* The PureScript↔JS membrane (app/core.ts). Kept in sync with core.ts's exports;
   these are the erased, plain-JS shapes the UI consumes. */
interface McCore {
  rankFor(n: number): string;
  rankLine(n: number): string;
  bibleSrc: string;
  bookSlug(key: string): string | null;
  verseParts(bookKey: string, ch: number | string, v1: number | string, v2?: number | string | null):
    { slug: string; ch: number; v1: number; v2: number; href: string } | null;
  profileLimits: { nick: number; bio: number; sig: number };
  handleValidate(raw: string): { ok: boolean; handle: string; error: string };
  handleMax: number;
  faithLabel(code: string): string;
  faiths: ReadonlyArray<{ code: string; label: string }>;
  displayName(hash: string): string;
  dmTtlLabel(ttl: number | string): string;
  dmTtlOptions: ReadonlyArray<{ secs: number; label: string }>;
  canInteract(author: string, me: string, bot: string): boolean;
  canReport(author: string, me: string, bot: string, isAdmin: boolean): boolean;
  canEdit(author: string, me: string): boolean;
  canDelete(author: string, me: string, isAdmin: boolean): boolean;
  topicCompare(a: { sticky?: number; last?: number }, b: { sticky?: number; last?: number }): number;
  replyPage(total: number, per: number): number;
  pagerItems(total: number, per: number, active: number): Array<{ gap: boolean; n: number; active: boolean }>;
  boardCatRows: ReadonlyArray<ReadonlyArray<string>>;
  boardCatKeys: ReadonlyArray<string>;
  adminCat: string;
  emojiPacks: { memes: Array<[string, string]>; pepe: Array<[string, string]> };
  emojiNamedTokens: string;
  parseRoute(get: (k: string) => string | null): { tag: string; s: string; n: number };
  authIsAdmin(s: Record<string, unknown>): boolean;
  authIsMember(s: Record<string, unknown>): boolean;
  authGate(s: Record<string, unknown>): string;
  isMuted(bot: string, hash: string, list: string[]): boolean;
  toggleMute(hash: string, list: string[]): { list: string[]; added: boolean };
  blockedMessage(reason: string): string;
  mentionsIn(text: string, picks: Array<{ token: string; hash: string }>): string[];
  [k: string]: unknown;
}

interface McStore {
  fetchJson(fetcher: (url: string, init?: RequestInit) => Promise<Response> | Response,
            url: string, init?: RequestInit,
            opts?: { ttl?: number; key?: string; bypass?: boolean }): Promise<any>;
  invalidate(prefix?: string): void;
  metrics: { hits: number; misses: number; dedup: number };
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
                typing?: (to: string, state?: string) => void; setPresence?: (mode: string) => void;
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
    mcToast?: (msg: string, opts?: any) => void;
    mcSheet?: { open: (...a: any[]) => void; settings?: () => void; close: () => void };
    mcGetDark?: () => string;
    mcSetDark?: (p: string) => void;
    mcGetLight?: () => string;
    mcSetLight?: (p: string) => void;
    mcDeeplink?: { run: () => void; reveal: () => void };
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
