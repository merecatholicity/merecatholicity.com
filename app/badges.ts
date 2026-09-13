/* Badges everywhere (2026-09-12): the Inbox count and the bell are the
   SHELL's — refreshed on every page the moment a live frame says something
   changed, and on every reconnect. Before this the refresh lived inside the
   per-page classic boot (client/dm.ts, client/profile.ts), which runs only on
   the platform pages: a member on Home, in the Bible reader or in a book had
   the socket open (the "badges everywhere" contract of app/live.ts) but
   nobody listening — a friend's message lit nothing until the next platform
   page (the owner's report). The caches are the ones the chrome reads
   (mc-dm-unread, mc-notif-unread: {n, at}); a write dispatches mc-badge and
   every bar repaints. Two triggers, both event-driven — never a poller:
     · a `dm` frame not for the thread on screen (that thread appends the
       word itself and pings seen) → the Inbox count, and one bell sound;
     · a `notification` frame, unless the notifications list is open (it
       reloads itself and marks read) → the bell count, and the sound;
     · mc-live-resync (the socket reopened after a hidden or idle spell —
       frames it missed are not replayed) → both, when their cache is stale.
   The classic client's own live handlers defer to this when it stands.
   Only ever for a member (a key in storage); one read per trigger, debounced,
   on the shared read budget like any keyed read. */
const API = '/api/comments';
const DM_CACHE = 'mc-dm-unread', NOTIF_CACHE = 'mc-notif-unread', TTL = 90000;

function readKey(): string {
  try { return localStorage.getItem('mc-comment-key') || ''; } catch (e) { return ''; }
}
function cacheGet(name: string): { n: number; at: number } | null {
  try { return JSON.parse(localStorage.getItem(name) as string) || null; } catch (e) { return null; }
}
function cacheSet(name: string, n: number) {
  try { localStorage.setItem(name, JSON.stringify({ n: n, at: Date.now() })); } catch (e) { /* storage blocked: the bars read 0 */ }
  document.dispatchEvent(new CustomEvent('mc-badge', { detail: { from: 'shell', which: name === DM_CACHE ? 'dm' : 'notif', n: n } }));
}
function openThreadWith(): string {
  try {
    if ((location.pathname.split('/').pop() || '') !== 'messages.html') return '';
    return String(new URLSearchParams(location.search).get('dm') || '');
  } catch (e) { return ''; }
}
function notifListOpen(): boolean {
  try { return new URLSearchParams(location.search).get('notifications') === '1'; } catch (e) { return false; }
}

export function installBadges() {
  if ((window as any).mcBadges) return;
  const timers: Record<string, any> = { dm: 0, notif: 0 };
  let lastBell = 0;
  function bell() {
    /* one sound per burst — a message and its bell row arrive as two frames */
    const now = Date.now();
    if (now - lastBell < 1500) return;
    lastBell = now;
    try { if (window.mcSound) window.mcSound.play('bell'); } catch (e) { /* silent */ }
  }
  function refresh(which: string) {
    const key = readKey();
    if (!key) return;
    clearTimeout(timers[which]);
    timers[which] = setTimeout(() => {
      const path = which === 'dm' ? '/dm/unread' : '/notifications/unread';
      const name = which === 'dm' ? DM_CACHE : NOTIF_CACHE;
      fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
        .then((r) => r.json())
        .then((d: any) => { if (d && d.ok && typeof d.unread === 'number') cacheSet(name, d.unread); })
        .catch(() => { /* the next frame or the next page settles it */ });
    }, 300);
  }
  function stale(name: string) { const c = cacheGet(name); return !c || Date.now() - c.at > TTL; }
  document.addEventListener('mc-live', (ev: any) => {
    const m = ev.detail;
    if (!m || !readKey()) return;
    if (m.t === 'dm') {
      if (m.from && openThreadWith() === m.from) return;   // the thread on screen takes it
      bell(); refresh('dm');
    } else if (m.t === 'notification') {
      if (notifListOpen()) return;   // the list reloads itself and marks read
      bell(); refresh('notif');
    }
  });
  document.addEventListener('mc-live-resync', () => {
    if (!readKey()) return;
    if (stale(DM_CACHE)) refresh('dm');
    if (stale(NOTIF_CACHE)) refresh('notif');
  });
  (window as any).mcBadges = {
    refresh,
    set: (which: string, n: number) => cacheSet(which === 'dm' ? DM_CACHE : NOTIF_CACHE, n),
  };
}
