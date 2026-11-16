// The mailing list's panel on a desktop (views.ts `signup`): it floats at the page's corner,
// opened a moment after arrival, and its × closes it until the page is next loaded (a
// refresh or a new visit brings it back; the client's hops between pages do not). A join is
// remembered for good, in this browser alone (localStorage, and nothing if storage is refused).
// A hop that draws a page anew draws the panel anew (the home page holds it in its body, every
// other page in the shell), so the panel's state is kept here and laid on each new one.
// A phone shows the list inline on the home page instead, so none of this runs there. The panel
// is the shell's, kept across the client's hops, so it is bound once.

const WIDE = "(min-width: 721px)";
const KEY = "press-list";
const DELAY = 1200;

const read = (): { joined?: boolean } => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
};
const write = (v: { joined?: boolean }) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* the panel just returns */ }
};

const panel = () => document.querySelector<HTMLElement>(".signup");
/** Waiting for its moment, open, or closed by the reader (until the next load). */
let state: "waiting" | "open" | "closed" = "waiting";
const close = () => { state = "closed"; panel()?.classList.remove("is-open"); };
const open = () => {
  if (state !== "waiting" || !matchMedia(WIDE).matches) return;
  state = "open";
  panel()?.classList.add("is-open");
};

export function bindSignup() {
  document.addEventListener("click", e => {
    if (!(e.target as Element).closest?.(".signup-close")) return;
    close();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && panel()?.classList.contains("is-open") && matchMedia(WIDE).matches) {
      close();
    }
  });
  // Joined: thanked in the panel, which then goes and stays gone.
  document.addEventListener("press-form-ok", e => {
    if ((e.target as Element).id !== "press-list") return;
    write({ ...read(), joined: true });
    setTimeout(close, 3500);
  });
  if (read().joined) return;
  setTimeout(open, DELAY);
  // A page drawn on a hop: an open panel stays open, without rising again.
  const app = document.getElementById("app");
  if (app) new MutationObserver(() => {
    const p = panel();
    if (state === "open" && p && !p.classList.contains("is-open")) p.classList.add("is-open", "is-kept");
  }).observe(app, { childList: true, subtree: true });
}
