/* Live updates transport (Phase 1) — window.mcLive.

   A single shell-owned WebSocket to the board hub Durable Object, surviving
   soft-navigation like the audio dock. Forum views subscribe to their scope on
   mount (mcLive.board.sub(['topic:'+id] | ['cat:'+key] | ['board:index'])); the
   hub pushes {v,t,scopes,...} events which we redispatch as a `mc-live`
   CustomEvent for the views to merge into their reactive state — no refresh, no
   polling. Resilience reuses the merecat brain's wisdom, re-expressed for WS:
   jittered-backoff reconnect, an app-level heartbeat against the free
   auto-responder, close-on-hidden/idle + reopen-and-resync on return, and
   silent degradation (missing/blocked WS ⇒ the site behaves exactly as today).

   A signed-in member also authenticates the board socket to add a private
   user:<hash> scope (mcLive.member.enable) over which the worker pushes that
   member's own DMs and notifications instantly — badge, open thread, and lists,
   no more 90-second polling. A per-conversation merecat chat socket rides beside
   `board` under this same lifecycle. Instantiated once by the shell (installLive). */

const BACKOFF = [1000, 2000, 5000, 10000, 30000];
const GRACE_MS = 45000;     // keep the socket this long after the tab hides
const IDLE_MS = 300000;     // 5-min inactivity (desktop screensaver) closes it
const PING_MS = 40000;      // app-level heartbeat cadence
const DEAD_MS = 15000;      // no pong within this past a ping ⇒ force reconnect
const DEGRADE_AT = 4;       // consecutive failures before we announce degraded

function wsUrl(path: string) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host + path;
}
function jitter(ms: number) { return Math.round(ms * (0.8 + Math.random() * 0.4)); }

/* One managed connection's mutable state. The object literal below carries only
   the data fields; `_open`/`_close`/`_sendSub` are attached before Conn returns
   and `nosub` is set by openChat, so both are part of the shape. */
interface ConnState {
  ws: WebSocket | null;
  want: boolean;
  desired: string[];
  userScope: string;
  authFrame: string | null;
  ix: number;
  failures: number;
  reconnectT: number;
  pingT: number;
  lastRx: number;
  closing: boolean;
  nosub?: boolean;
  _open: () => void;
  _close: () => void;
  _sendSub: () => void;
}

/* One managed connection (board today; chat in Phase 2). All timers are the
   client's; the server DO holds no timer and hibernates when idle. */
function Conn(path: string, onFrame: (m: any) => void): ConnState {
  const c = {
    ws: null, want: false, desired: [], userScope: '', authFrame: null,
    ix: 0, failures: 0, reconnectT: 0, pingT: 0, lastRx: 0, closing: false,
  } as unknown as ConnState;

  function clearTimers() {
    if (c.pingT) { clearInterval(c.pingT); c.pingT = 0; }
    if (c.reconnectT) { clearTimeout(c.reconnectT); c.reconnectT = 0; }
  }

  function open() {
    if (c.ws || !c.want) return;
    let sock;
    try { sock = new WebSocket(wsUrl(path)); } catch (e) { schedule(); return; }
    c.ws = sock;
    sock.addEventListener('open', function () {
      c.ix = 0; c.failures = 0; c.lastRx = Date.now();
      if (c.authFrame) { try { sock.send(c.authFrame); } catch (e) { /* will reconnect */ } }
      sendSub();
      startPing();
      document.dispatchEvent(new CustomEvent('mc-live-resync', { detail: { conn: path } }));
    });
    sock.addEventListener('message', function (ev) {
      c.lastRx = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || m.t === 'pong') return;
      onFrame(m);
    });
    sock.addEventListener('close', dropped);
    sock.addEventListener('error', dropped);
  }

  function dropped() {
    if (c.ws) { try { c.ws.close(); } catch (e) { /* already */ } }
    c.ws = null; clearTimers();
    if (c.closing) { c.closing = false; return; }
    if (c.want && !hidden) schedule();
  }

  function schedule() {
    if (c.reconnectT) return;
    c.failures += 1;
    if (c.failures === DEGRADE_AT) {
      document.dispatchEvent(new CustomEvent('mc-live-degraded', { detail: { conn: path } }));
    }
    const base = BACKOFF[Math.min(c.ix, BACKOFF.length - 1)];
    c.ix += 1;
    c.reconnectT = setTimeout(function () { c.reconnectT = 0; open(); }, jitter(base));
  }

  function startPing() {
    if (c.pingT) clearInterval(c.pingT);
    c.pingT = setInterval(function () {
      if (!c.ws) return;
      if (Date.now() - c.lastRx > PING_MS + DEAD_MS) { dropped(); return; }
      try { c.ws.send('{"t":"ping"}'); } catch (e) { dropped(); }
    }, PING_MS);
  }

  function sendSub() {
    if (c.nosub) return;   // chat sockets subscribe to nothing — they auth + ask
    if (c.ws && c.ws.readyState === 1) {
      /* A member's private user:<hash> scope (DMs, notifications) is persistent
         across forum-view changes, so every sub carries it alongside whatever
         forum scope is shown. It leads the list so the server's scope cap never
         drops it. */
      const scope = c.userScope ? [c.userScope].concat(c.desired) : c.desired;
      try { c.ws.send(JSON.stringify({ t: 'sub', scope: scope })); } catch (e) { /* reconnect handles it */ }
    }
  }

  function close() {
    c.closing = true; clearTimers();
    if (c.ws) { try { c.ws.close(); } catch (e) { /* already */ } c.ws = null; }
  }

  c._open = open; c._close = close; c._sendSub = sendSub;
  return c;
}

const conns: ConnState[] = [];   // every managed connection, for the shared idle policy
let hidden = false;
let idleT = 0;

/* board — the always-available forum feed. */
const board = Conn('/api/comments/live', function (m: any) {
  document.dispatchEvent(new CustomEvent('mc-live', { detail: m }));
});
conns.push(board);

const boardApi = {
  /* A forum view calls this on mount with its scope(s). Replaces the desired
     subscription (one forum view is shown at a time) and ensures the socket. */
  sub: function (scopes: string[]) {
    board.desired = Array.isArray(scopes) ? scopes : [];
    board.want = true;
    if (board.ws) board._sendSub(); else if (!hidden) board._open();
  },
  /* On unmount: stop receiving forum events. A short grace keeps the socket for
     the next forum view; if none arrives AND no member scope is active, it closes
     (reopens instantly on the next sub). A signed-in member keeps the socket for
     the private user scope even with no forum view shown. */
  leave: function () {
    board.desired = [];
    board._sendSub();
    setTimeout(function () {
      if (board.desired.length === 0 && !board.userScope) { board.want = false; board._close(); }
    }, 3000);
  },
};

/* member — a signed-in member's private scope on the board socket, for instant
   DMs and notifications. The socket authenticates (the key in the auth frame,
   never the URL) and subscribes to user:<hash>; the DO honors that scope only
   for the hash the key proves, so a member's private events reach their own
   connections alone. Persistent: it rides every sub frame and keeps the socket
   open across forum-view changes and on any page (badges everywhere). */
let memberKey = '';
function presenceMode() {
  try { return localStorage.getItem('mc-presence') === 'off' ? 'off' : 'auto'; } catch (e) { return 'auto'; }
}
const memberApi = {
  enable: function (key: string, hash: string) {
    if (!key || !/^[0-9a-f]{64}$/.test(String(hash))) return;
    const next = 'user:' + hash;
    if (board.userScope === next && board.authFrame) return;   // already enabled
    memberKey = key;
    board.authFrame = JSON.stringify({ t: 'auth', key: key, presence: presenceMode() });
    board.userScope = next;
    board.want = true;
    if (board.ws && board.ws.readyState === 1) {
      try { board.ws.send(board.authFrame); } catch (e) { /* reconnect re-auths */ }
      board._sendSub();
    } else if (!hidden) { board._open(); }
  },
  disable: function () {
    board.authFrame = null;
    board.userScope = '';
    memberKey = '';
    if (board.desired.length === 0) { board.want = false; board._close(); }
    else board._sendSub();
  },
  /* Transient "I am typing to <to>" signal, sent over the live socket only (no
     HTTP, no rate-limit bucket); the caller debounces it. state 'start'|'stop'. */
  typing: function (to: string, state?: string) {
    if (!board.ws || board.ws.readyState !== 1) return;
    if (!/^[0-9a-f]{64}$/.test(String(to))) return;
    try { board.ws.send(JSON.stringify({ t: 'typing', to: to, state: state === 'stop' ? 'stop' : 'start' })); } catch (e) { /* dropped */ }
  },
  /* Change my presence mode ('auto'|'off'), persist it, and re-auth so the DO
     broadcasts the change to anyone watching me. */
  setPresence: function (mode: string) {
    try { localStorage.setItem('mc-presence', mode === 'off' ? 'off' : 'auto'); } catch (e) { /* private mode */ }
    if (!memberKey) return;
    board.authFrame = JSON.stringify({ t: 'auth', key: memberKey, presence: presenceMode() });
    if (board.ws && board.ws.readyState === 1) { try { board.ws.send(board.authFrame); } catch (e) { /* reconnect */ } }
  },
  presenceMode: presenceMode,
};

/* chat — a per-conversation merecat socket (Phase 2). Created on demand by
   viewMerecat, one at a time (opening a new conversation closes any prior),
   and torn down when the reader leaves. It shares the whole idle/reconnect
   lifecycle through `conns`, so a hidden tab / locked phone closes it and a
   return reopens it — the ChatRoom DO keeps generating regardless and replays
   its state in the `hello` frame on reconnect, which IS the resume. It carries
   an auth frame (the member key, never in the URL) and subscribes to nothing. */
let chatConn: ConnState | null = null;
function closeChat() {
  if (chatConn) {
    chatConn.want = false;
    chatConn._close();
    const i = conns.indexOf(chatConn);
    if (i >= 0) conns.splice(i, 1);
    chatConn = null;
  }
}
function openChat(chatId: string | number, key: string, onFrame: (m: any) => void) {
  closeChat();
  const c = Conn('/api/merecat/live?chat=' + encodeURIComponent(chatId), onFrame);
  c.nosub = true;
  c.authFrame = JSON.stringify({ t: 'auth', key: key });
  c.want = true;
  chatConn = c;
  conns.push(c);
  if (!hidden) c._open();
  return {
    send: function (obj: any) {
      if (c.ws && c.ws.readyState === 1) {
        try { c.ws.send(JSON.stringify(obj)); return true; } catch (e) { /* reconnect will retry */ }
      }
      return false;
    },
    ready: function () { return !!(c.ws && c.ws.readyState === 1); },
    close: function () { if (chatConn === c) closeChat(); },
  };
}

function reopenAll() {
  for (const c of conns) { if (c.want && !c.ws) c._open(); }
}
function closeAll() {
  for (const c of conns) { if (c.ws) c._close(); }
}

let installed = false;
export function installLive() {
  if (installed || window.mcLive) return;
  installed = true;
  window.mcLive = { board: boardApi, member: memberApi, chat: openChat, _conns: conns };

  /* Idle policy — one place, applied to every connection. A hidden tab / locked
     phone / screensaver must stop consuming resources; the DO keeps no state we
     lose, so closing is free and reopening resyncs. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      hidden = true;
      setTimeout(function () { if (hidden) closeAll(); }, GRACE_MS);
    } else {
      hidden = false;
      reopenAll();
    }
  });
  window.addEventListener('pagehide', closeAll);
  document.addEventListener('freeze', closeAll);

  function activity() {
    if (idleT) clearTimeout(idleT);
    if (!hidden) reopenAll();
    idleT = setTimeout(function () { closeAll(); }, IDLE_MS);
  }
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(function (t) {
    window.addEventListener(t, activity, { passive: true });
  });
  activity();
}
