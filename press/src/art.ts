// The painting behind every page turns: merecatholicity.com's paintings in a slow ring, each
// fading into the next every FOURTEEN seconds, twice the carousel's turn (owner, 2026-11-24).
// The first is Augustine, drawn by the stylesheet (body::before) so the first paint needs no
// script; once the page has loaded, two fixed layers take turns over it. Each painting is fetched
// and decoded before its fade begins, one ahead, never the whole set at once, and only the size
// the window shows (the -d file from 900px, the -m below, as the stylesheet chooses). The ring
// waits while the tab is hidden, and under prefers-reduced-motion it never turns: Augustine stays.
// The layers live outside #app, so a hop between pages never interrupts a fade.
//
// A shelf may have a ring of its own (owner, 2026-11-26: Lérins America's, src/theme.ts). When
// the reader comes to it the ring changes at once, the new ring's first painting fading in over
// whatever was showing, and when they leave the old ring comes back the same way. A page served
// on such a shelf names its ring on <html data-art>, so the stylesheet's first paint is already
// that ring's first painting.

/** Each painting, by its files' name under static/art/, and whether it is wide (it then stands
 *  at the bottom right on a desktop, not in the right margin). Augustine first: the stylesheet's. */
const PAINTINGS: [name: string, wide: boolean][] = [
  ["augustine", false], ["feed", false], ["community", true], ["inbox", false],
  ["hagia", true], ["credo", false], ["peter", true], ["profile", false],
  ["merecat", true], ["lexorandi", false], ["geneva", true], ["luther", false],
  ["stgiles", true],
];
/** Lérins America's ring: Trumbull's Declaration (1819) and paintings made for the press after it
 *  and after Church's Our Banner in the Sky (c. 1861), which is not in the ring but hangs in the
 *  top left corner while the theme is on (press.css, am-sky). The first is the stylesheet's. */
const AMERICA: [name: string, wide: boolean][] = [
  ["am-meetinghouse", false], ["am-whitefield", true], ["am-statehouse", false],
  ["am-declaration", true], ["am-eagle", false], ["am-capitol", false], ["am-basilica", false],
];
const RINGS: Record<string, [string, boolean][]> = { "": PAINTINGS, america: AMERICA };
const TURN = 14000;

const desk = matchMedia("(min-width: 900px)");
const url = (name: string) => `/art/${name}-${desk.matches ? "d" : "m"}.webp`;

/** The painting's file in hand and decoded, so its fade never shows it arriving. */
function ready(name: string): Promise<void> {
  const img = new Image();
  img.src = url(name);
  return img.decode().catch(() => undefined);
}

/** The ring the stylesheet's first paint shows (body::before), and the ring wanted now. */
const painted = RINGS[document.documentElement.dataset.art ?? ""] ?? PAINTINGS;
let ring = painted;
let layers: HTMLElement[] = [];
let at = 0;        // the painting shown, in `ring`
let top = 0;       // the layer it is on (none yet: the first is the stylesheet's)
let first = true;
let timer = 0;
let lap = 0;       // bumped on each change of ring, so a fetch begun for the old ring is dropped

function show(i: number) {
  const [name, wide] = ring[i];
  const next = layers[first ? 0 : 1 - top];
  next.style.setProperty("--art-m", `url(/art/${name}-m.webp)`);
  next.style.setProperty("--art-d", `url(/art/${name}-d.webp)`);
  next.toggleAttribute("data-wide", wide);
  next.classList.add("on");
  if (first) document.body.classList.add("art-turns");   // the stylesheet's painting fades out
  else layers[top].classList.remove("on");
  top = layers.indexOf(next);
  first = false;
  at = i;
}

const later = () => { clearTimeout(timer); timer = window.setTimeout(turn, TURN); };

async function turn() {
  const mine = lap;
  const i = (at + 1) % ring.length;
  await ready(ring[i][0]);
  if (mine !== lap) return;
  // a hidden tab holds the ring where it is; it turns again a turn after the reader is back
  if (document.hidden) {
    await new Promise(r => document.addEventListener("visibilitychange", r, { once: true }));
    if (mine === lap) later();
    return;
  }
  show(i);
  later();
}

/** Change to a shelf's ring (or back to the press's own, with no name): its first painting
 *  fades in as soon as it is decoded, and the ring turns on from there. */
export function setRing(name?: string) {
  const next = RINGS[name ?? ""] ?? PAINTINGS;
  if (next === ring) return;
  ring = next;
  const mine = ++lap;
  if (!layers.length) return;            // not bound yet: bindArt starts on this ring
  clearTimeout(timer);
  ready(ring[0][0]).then(() => {
    if (mine !== lap) return;
    show(0);
    later();
  });
}

export function bindArt() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || layers.length) return;
  layers = [0, 1].map(() => {
    const el = document.createElement("div");
    el.className = "art";
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
    return el;
  });
  if (ring !== painted) {                // the reader reached a shelf's ring before the load
    const want = ring;
    ring = painted;
    setRing(Object.keys(RINGS).find(k => RINGS[k] === want));
    return;
  }
  later();
}
