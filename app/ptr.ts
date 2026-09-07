/* Pull to refresh — the gesture everyone already knows from Facebook and
   Instagram, which is exactly why it has to feel right: a half-implemented one
   reads as a broken app rather than a missing feature.

   Installed by the shell on EVERY page (like app/call.ts), so it works on a
   paper and in the Library as well as on the forum.

   WHAT A PULL DOES (the owner's rule): an ordinary pull refetches the current
   view's data IN PLACE — the page stays, scroll position is kept, and rows
   update under you. That is what the apps people compare us to actually do; a
   full reload would white-flash, re-parse ~280 KB of client, and lose your
   place. But three pulls in quick succession mean "this still looks wrong", and
   that earns the real thing: a document reload.

   The arithmetic — resistance curve, threshold, escalation — is Domain.Ptr, so
   the fiddly part is checked without a browser. This file is the hands: touch
   events, one indicator element, and the decision about what "refresh" means
   for whatever is on screen.

   DELIBERATELY TOUCH-ONLY. A mouse has a scrollbar and a keyboard has F5; a
   desktop pull gesture would be a novelty nobody reaches for. */

import { ptrTravel, ptrStage, ptrEscalates } from './core.ts';

const CSS = 'mc-ptr-css';
const STYLE =
  '.mc-ptr{position:fixed;left:50%;top:0;z-index:9994;transform:translate(-50%,-100%);' +
  'width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
  'background:var(--surface,#fffdf7);border:1px solid var(--rule,#d9cfb8);' +
  'box-shadow:0 2px 10px rgba(0,0,0,.18);pointer-events:none;opacity:0}' +
  '.mc-ptr-arrow{width:16px;height:16px;border:2px solid var(--maroon,#8b1a1a);' +
  'border-radius:50%;border-top-color:transparent;transition:transform .18s ease}' +
  /* Ready to fire: the ring completes and squares up, so the change is felt
     before it is read. */
  '.mc-ptr.ready .mc-ptr-arrow{transform:rotate(135deg) scale(1.08)}' +
  '.mc-ptr.spin .mc-ptr-arrow{animation:mc-ptr-spin .7s linear infinite}' +
  '@keyframes mc-ptr-spin{to{transform:rotate(360deg)}}' +
  /* The escalation tell: the third pull says what it is about to do. */
  '.mc-ptr-note{position:fixed;left:0;right:0;top:52px;z-index:9994;text-align:center;' +
  'font-size:.78rem;color:var(--faint,#757068);pointer-events:none;opacity:0;transition:opacity .2s ease}' +
  '.mc-ptr-note.on{opacity:1}';

export function installPtr() {
  if (!('ontouchstart' in window)) return;   // touch only, on purpose
  if (document.getElementById(CSS)) return;

  const st = document.createElement('style');
  st.id = CSS;
  st.textContent = STYLE;
  document.head.appendChild(st);

  const pill = document.createElement('div');
  pill.className = 'mc-ptr';
  pill.setAttribute('data-mc-app', '');      // survives a <main> swap
  pill.setAttribute('role', 'status');
  const arrow = document.createElement('div');
  arrow.className = 'mc-ptr-arrow';
  pill.appendChild(arrow);
  const note = document.createElement('div');
  note.className = 'mc-ptr-note';
  note.setAttribute('data-mc-app', '');
  document.body.appendChild(pill);
  document.body.appendChild(note);

  let startY = 0;
  let pulling = false;
  let armed = false;
  let busy = false;
  /* The escalation run: how many refreshes have completed back to back, and
     when the run began. Reset by any pull that is not part of a run. */
  let runN = 0;
  let runAt = 0;

  function paint(t: number, stageTag: string) {
    pill.style.transform = 'translate(-50%,' + (t - 34) + 'px)';
    pill.style.opacity = String(Math.min(1, t / 40));
    pill.classList.toggle('ready', stageTag === 'ready');
  }
  function hide() {
    pill.style.transform = 'translate(-50%,-100%)';
    pill.style.opacity = '0';
    pill.classList.remove('ready', 'spin');
    note.classList.remove('on');
  }

  /* Is this touch allowed to become a pull? Only at the very top of the page,
     and never inside something the reader is already manipulating — a composer
     they are typing in, the draggable audio dock, an open media theater, a
     horizontally scrolling table. */
  function eligible(target: EventTarget | null) {
    if (busy) return false;
    if (window.scrollY > 0) return false;
    const el = target as Element | null;
    if (el && el.closest && el.closest('textarea,input,select,[data-no-ptr],.mc-dock,.wall-lightbox,.mc-sheet')) return false;
    /* A scrolled inner pane owns the gesture, not us. */
    let n: any = el;
    while (n && n !== document.body) {
      if (n.scrollTop > 0) return false;
      n = n.parentElement;
    }
    return true;
  }

  document.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1 || !eligible(e.target)) { pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
    armed = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e: TouchEvent) => {
    if (!pulling || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { if (armed) { hide(); armed = false; } return; }
    const t = ptrTravel(dy);
    const stage = ptrStage(t);
    if (stage === 'idle') return;
    armed = true;
    /* Own the gesture: without this the page rubber-bands under the indicator
       (and on Android the browser's own pull-to-refresh fires as well). */
    if (e.cancelable) e.preventDefault();
    paint(t, stage);
    /* Say what a third pull is about to do, before it happens. */
    const willReload = stage === 'ready' && ptrEscalates(runN, Date.now() - runAt);
    note.textContent = willReload ? 'Release to reload the page' : '';
    note.classList.toggle('on', willReload);
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!pulling || !armed) { pulling = false; hide(); return; }
    pulling = false;
    armed = false;
    const fire = pill.classList.contains('ready');
    if (!fire) { hide(); return; }

    /* Is this the third of a run? Count and recency together, so three pulls
       spread over a minute stay three ordinary refreshes. */
    const inRun = runAt && ptrEscalates(runN, Date.now() - runAt);
    if (!runAt || Date.now() - runAt > 6000) { runN = 0; runAt = Date.now(); }

    if (inRun) {
      note.textContent = 'Reloading…';
      note.classList.add('on');
      pill.classList.add('spin');
      location.reload();
      return;
    }

    runN += 1;
    busy = true;
    pill.classList.add('spin');
    pill.style.transform = 'translate(-50%,26px)';
    pill.style.opacity = '1';
    refresh().then(() => {
      busy = false;
      hide();
    });
  }, { passive: true });

  /* What "refresh" means for whatever is on screen.
     A view that knows better answers `mc-refresh` and does its own thing; the
     default is the honest general case — drop what we have cached for this
     route and re-run the router, which re-renders in place with fresh data. */
  function refresh(): Promise<void> {
    const started = Date.now();
    let handled = false;
    try {
      const ev = new CustomEvent('mc-refresh', { detail: { done: () => { handled = true; } } });
      document.dispatchEvent(ev);
    } catch (e) { /* ignore */ }
    try {
      if (window.mcStore) window.mcStore.invalidate();
    } catch (e) { /* ignore */ }
    try {
      const kit: any = window.mcKit;
      if (!handled && kit && kit.reroute) kit.reroute();
    } catch (e) { /* a throwing view must not leave the spinner up forever */ }
    /* Hold the spinner briefly even on an instant refresh: a gesture that
       produces no visible response reads as ignored, and the reader needs to
       see that their pull did something. */
    const min = 550 - (Date.now() - started);
    return new Promise((res) => setTimeout(res, Math.max(0, min)));
  }
}
