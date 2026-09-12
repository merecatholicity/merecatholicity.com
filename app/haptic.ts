/* Haptics (2026-09-12): the small buzz a phone gives under a hold, a pick, an
   armed swipe or pull, and the pattern of a ringing call — tastefully, and
   only where the device can. Android (Chrome, Samsung, Firefox) has the
   Vibration API. iOS Safari has NONE, in a tab or the installed app: the one
   known road is the haptic iOS 17.4+ plays when a `switch` checkbox toggles,
   so a hidden one is toggled — best-effort, silent where it does nothing, and
   never for the ring (a pattern needs the API). Chrome refuses (and logs an
   intervention for) a vibrate before the frame's first real tap, so
   userActivation is asked first. Shell-owned, one for the page:
   window.mcHaptic for the client. */
const PATTERNS: Record<string, number | number[]> = {
  tap: 6, pick: 6, arm: 8, hold: 12, ring: [300, 150, 300],
};
let sw: HTMLInputElement | null = null;
let ringT: any = 0;
let buzzed = false;   // a ring pattern actually went to the device (the cancel is only for that)

function canVibrate(): boolean {
  try {
    const ua: any = (navigator as any).userActivation;
    if (ua && !ua.hasBeenActive) return false;
    return typeof navigator.vibrate === 'function';
  } catch (e) { return false; }
}
function iosSwitch(): HTMLInputElement | null {
  if (sw) return sw;
  try {
    const i = document.createElement('input');
    i.type = 'checkbox';
    if (!('switch' in i)) return null;   // no haptic switch on this engine
    i.setAttribute('switch', '');
    i.tabIndex = -1; i.setAttribute('aria-hidden', 'true');
    const l = document.createElement('label');
    l.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    l.appendChild(i);
    document.body.appendChild(l);
    sw = i;
    return i;
  } catch (e) { return null; }
}
function iosTap(): boolean {
  try {
    if (!window.matchMedia('(hover: none)').matches) return false;
    const i = iosSwitch();
    if (!i) return false;
    i.click();
    return true;
  } catch (e) { return false; }
}
export function haptic(kind: string): boolean {
  const p = PATTERNS[kind];
  if (p == null) return false;
  if (canVibrate()) { try { navigator.vibrate(p); return true; } catch (e) { /* fall through */ } }
  if (typeof navigator.vibrate === 'function') return false;   // Android without activation yet: no hack needed
  return kind === 'ring' ? false : iosTap();
}
/* The ring's pattern, repeated while a call rings; stopped by every exit. */
export function ringStart() {
  ringStop();
  if (typeof navigator.vibrate !== 'function') return;
  const tick = () => { if (canVibrate()) { try { navigator.vibrate(PATTERNS.ring); buzzed = true; } catch (e) { /* fine */ } } };
  tick();
  ringT = setInterval(tick, 2200);
}
/* Chrome logs an intervention for ANY vibrate before the frame's first tap —
   a cancel included (the live call webtest's callee console, 2026-09-12) —
   so the cancel goes only after a pattern actually went out. */
export function ringStop() {
  if (ringT) { clearInterval(ringT); ringT = 0; }
  if (!buzzed) return;
  buzzed = false;
  try { if (canVibrate()) navigator.vibrate(0); } catch (e) { /* fine */ }
}
export function installHaptic() {
  if ((window as any).mcHaptic) return;
  (window as any).mcHaptic = { haptic, ringStart, ringStop };
}
