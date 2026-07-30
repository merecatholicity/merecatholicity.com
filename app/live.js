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

   Structured for Phase 2 to add a per-conversation chat socket beside `board`
   under this same lifecycle. Instantiated once by the shell (installLive). */

const BACKOFF = [1000, 2000, 5000, 10000, 30000];
const GRACE_MS = 45000;     // keep the socket this long after the tab hides
const IDLE_MS = 300000;     // 5-min inactivity (desktop screensaver) closes it
const PING_MS = 40000;      // app-level heartbeat cadence
const DEAD_MS = 15000;      // no pong within this past a ping ⇒ force reconnect
const DEGRADE_AT = 4;       // consecutive failures before we announce degraded

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host + path;
}
function jitter(ms) { return Math.round(ms * (0.8 + Math.random() * 0.4)); }

/* One managed connection (board today; chat in Phase 2). All timers are the
   client's; the server DO holds no timer and hibernates when idle. */
function Conn(path, onFrame) {
  const c = {
    ws: null, want: false, desired: [], authFrame: null,
    ix: 0, failures: 0, reconnectT: 0, pingT: 0, lastRx: 0, closing: false,
  };

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
    if (c.ws && c.ws.readyState === 1) {
      try { c.ws.send(JSON.stringify({ t: 'sub', scope: c.desired })); } catch (e) { /* reconnect handles it */ }
    }
  }

  function close() {
    c.closing = true; clearTimers();
    if (c.ws) { try { c.ws.close(); } catch (e) { /* already */ } c.ws = null; }
  }

  c._open = open; c._close = close; c._sendSub = sendSub;
  return c;
}

const conns = [];   // every managed connection, for the shared idle policy
let hidden = false;
let idleT = 0;

/* board — the always-available forum feed. */
const board = Conn('/api/comments/live', function (m) {
  document.dispatchEvent(new CustomEvent('mc-live', { detail: m }));
});
conns.push(board);

const boardApi = {
  /* A forum view calls this on mount with its scope(s). Replaces the desired
     subscription (one forum view is shown at a time) and ensures the socket. */
  sub: function (scopes) {
    board.desired = Array.isArray(scopes) ? scopes : [];
    board.want = true;
    if (board.ws) board._sendSub(); else if (!hidden) board._open();
  },
  /* On unmount: stop receiving. A short grace keeps the socket for the next
     forum view; if none arrives, it closes (reopens instantly on the next sub). */
  leave: function () {
    board.desired = [];
    board._sendSub();
    setTimeout(function () {
      if (board.desired.length === 0) { board.want = false; board._close(); }
    }, 3000);
  },
};

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
  window.mcLive = { board: boardApi, _conns: conns };

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
