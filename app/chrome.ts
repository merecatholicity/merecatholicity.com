/* app/chrome.ts — the early bundle: the two fixed bars, and nothing else
   (2026-09-17).

   docs/chrome.js is ~25 KB against app.js's ~290, and nav.js loads it first,
   so on a cold open a phone has its app bar and tab bar within a round trip of
   the first paint instead of after the whole shell. The stylesheet draws the
   bars' surfaces before even this lands (styles/main.css, the pre-shell rules),
   so the sequence a reader sees is: the app's frame, then the real bars in the
   same places, then the page's own content — never a page that grows an app
   around itself, which is what the owner reported as a flash like an extra
   reload.

   It respects the one latch the chrome has: a reader who asked for the plain
   site (?app=0, remembered as mc-app=0) gets no bars here either, exactly as
   installChrome would refuse them. app.js mounts everything else and calls
   mountBars again, which finds these two and leaves them where they are. */
import { mountBars } from './chromebits.ts';

function wanted(): boolean {
  try { return localStorage.getItem('mc-app') !== '0'; } catch (e) { return true; }
}

if (wanted()) {
  if (document.body) mountBars();
  else document.addEventListener('DOMContentLoaded', () => { mountBars(); }, { once: true });
}
