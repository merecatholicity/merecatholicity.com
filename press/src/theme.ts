// A shelf may dress the whole site in its own colours while the reader is on it (owner,
// 2026-11-26: Lérins America "almost like an easter egg"). The theme follows the reader three
// ways: on the shelf's own page, on any of its books' pages, and on the home page while the
// shelf's run of covers holds the middle of the window. Leaving, by a hop or by scrolling on to
// the next shelf, restores the press's own look. The stylesheet does the fading (each colour is a
// registered custom property with a transition, press.css "Shelf themes"); this module only says
// which theme is on, and turns the painting's ring with it (src/art.ts).
import type { Route } from "./types.ts";
import { CORNER_ART, CORNER_SLOT, themeOf } from "./views.ts";
import { setRing } from "./art.ts";

const root = document.documentElement;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
let current = root.dataset.theme;

/** Hang a theme's corner picture in its slot (data-a, data-b; press.css "The corners"), where it
 *  stays after the theme, so it can still fade out as the next comes in. No theme is "plain",
 *  the Deësis Christ's. */
function hang(name: string) {
  const slot = CORNER_SLOT[name];
  if (slot) root.dataset[slot] = name;
}

/** After the load: the page's corner (its theme's, or the Deësis Christ with none), fetched and
 *  decoded, then hung, so it fades in (press.css, --ca and --cb). It waits like the ring's later
 *  paintings: it is decoration, and the first paint's pictures (the shield, a cover, the ring's
 *  first painting) have the network to themselves. After this, a change of theme hangs its
 *  corner at once (setTheme). */
export function bindCorner() {
  const name = current ?? "plain";
  const img = new Image();
  img.src = `/art/${CORNER_ART[name]}-${matchMedia("(min-width: 900px)").matches ? "d" : "m"}.webp`;
  img.decode().catch(() => undefined).then(() => { if ((current ?? "plain") === name) hang(name); });
}

function setTheme(name?: string) {
  if (name === current) return;
  current = name;
  if (name) root.dataset.theme = name;
  else delete root.dataset.theme;
  hang(name ?? "plain");
  // With no motion the ring never turns, so the stylesheet's own painting is changed instead.
  if (still) {
    if (name) root.dataset.art = name;
    else delete root.dataset.art;
  }
  setRing(name);
}

/** The home page's themed shelves in the middle band of the window, newest sighting last. */
const seen = new Map<Element, string>();
const band = new IntersectionObserver(entries => {
  for (const e of entries) {
    const name = (e.target as HTMLElement).dataset.theme;
    if (e.isIntersecting && name) seen.set(e.target, name);
    else seen.delete(e.target);
  }
  setTheme([...seen.values()].pop());
}, { rootMargin: "-45% 0px -45% 0px" });

/** After every draw: the page's own theme, or on a page of many shelves the one in view. */
export function bindTheme(app: HTMLElement, route: Route) {
  band.disconnect();
  seen.clear();
  const own = themeOf(route);
  if (own || route.kind !== "home") return setTheme(own);
  const shelves = app.querySelectorAll("section.collection[data-theme]");
  if (!shelves.length) return setTheme(undefined);
  shelves.forEach(s => band.observe(s));
}
