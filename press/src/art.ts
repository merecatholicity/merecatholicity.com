// The painting behind every page turns: merecatholicity.com's paintings in a slow ring, each
// fading into the next every FOURTEEN seconds, twice the carousel's turn (owner, 2026-11-24).
// The first is Augustine, drawn by the stylesheet (body::before) so the first paint needs no
// script; once the page has loaded, two fixed layers take turns over it. Each painting is fetched
// and decoded before its fade begins, one ahead, never the whole set at once, and only the size
// the window shows (the -d file from 900px, the -m below, as the stylesheet chooses). The ring
// waits while the tab is hidden, and under prefers-reduced-motion it never turns: Augustine stays.
// The layers live outside #app, so a hop between pages never interrupts a fade.

/** Each painting, by its files' name under static/art/, and whether it is wide (it then stands
 *  at the bottom right on a desktop, not in the right margin). Augustine first: the stylesheet's. */
const PAINTINGS: [name: string, wide: boolean][] = [
  ["augustine", false], ["feed", false], ["community", true], ["inbox", false],
  ["hagia", true], ["credo", false], ["peter", true], ["profile", false],
  ["merecat", true], ["lexorandi", false], ["geneva", true], ["luther", false],
  ["stgiles", true],
];
const TURN = 14000;

const desk = matchMedia("(min-width: 900px)");
const url = (name: string) => `/art/${name}-${desk.matches ? "d" : "m"}.webp`;

/** The painting's file in hand and decoded, so its fade never shows it arriving. */
function ready(name: string): Promise<void> {
  const img = new Image();
  img.src = url(name);
  return img.decode().catch(() => undefined);
}

export function bindArt() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.querySelector(".art")) return;
  const layers = [0, 1].map(() => {
    const el = document.createElement("div");
    el.className = "art";
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
    return el;
  });
  let at = 0;        // the painting shown
  let top = 0;       // the layer it is on (none yet: Augustine is the stylesheet's)
  let first = true;

  const show = (i: number) => {
    const [name, wide] = PAINTINGS[i];
    const next = layers[first ? 0 : 1 - top];
    next.style.setProperty("--art-m", `url(/art/${name}-m.webp)`);
    next.style.setProperty("--art-d", `url(/art/${name}-d.webp)`);
    next.toggleAttribute("data-wide", wide);
    next.classList.add("on");
    if (first) document.body.classList.add("art-turns");   // Augustine's own layer fades out
    else layers[top].classList.remove("on");
    top = layers.indexOf(next);
    first = false;
    at = i;
  };

  const turn = async () => {
    const i = (at + 1) % PAINTINGS.length;
    await ready(PAINTINGS[i][0]);
    // a hidden tab holds the ring where it is; it turns again a turn after the reader is back
    if (document.hidden) {
      await new Promise(r => document.addEventListener("visibilitychange", r, { once: true }));
      return setTimeout(turn, TURN);
    }
    show(i);
    setTimeout(turn, TURN);
  };
  setTimeout(turn, TURN);
}
