// Featured reads: the behaviour of the carousel views.ts draws. The slides are a row that
// scrolls and snaps, so a phone swipes it with no help from here; this adds the rest:
//   - which slide is in view (an IntersectionObserver on the row), marked `is-active`, which
//     the stylesheet uses to bring its words in, and the dots follow
//   - the arrows and dots, which scroll the row to a slide
//   - a slow turn, every SEVEN seconds, paused while the reader hovers, focuses or touches
//     it, while the tab is hidden, and never at all under prefers-reduced-motion; any hand on
//     it (a touch, a trackpad's swipe, a mouse drag) starts the wait again
//   - a mouse drags the row like a finger (a finger needs nothing: the row is native), and a
//     drag is never also a click on the link it began on
//   - a ring, not a row: a swipe, an arrow or the turn past the last slide arrives at the first
//     (and back), sliding on as if the row went round. The row carries a copy of the last
//     slide before the first and of the first after the last; once it comes to rest on a copy
//     it jumps, unseen, to the slide the copy stands for (both are lit alike, so nothing moves)
// The long-press menus that would steal a held swipe (iOS's link preview, Android's image
// menu, a text selection) are switched off in the stylesheet.
// A drawn page keeps its carousel across redraws (the shelf growing), so it is bound once;
// a hop away removes it, and its timer and observer stop with it.

const TURN = 7000;
const bound = new WeakSet<Element>();

export function bindCarousel(root: ParentNode) {
  const section = root.querySelector<HTMLElement>(".featured");
  const track = section?.querySelector<HTMLElement>(".featured-track");
  if (!section || !track || bound.has(track)) return;
  bound.add(track);
  const slides = [...track.querySelectorAll<HTMLElement>(".slide")];
  const dots = [...section.querySelectorAll<HTMLElement>(".featured-dot")];
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const n = slides.length;
  let held = false;
  let touching = false;
  let drag: { x: number; left: number; t: number; moved: boolean } | undefined;

  // The ring's two copies, hidden from a reader and out of the tab order: slot 0 stands for the
  // last slide, slot n + 1 for the first, slot k + 1 is slide k. A lone slide has no ring.
  const copy = (s: HTMLElement) => {
    const c = s.cloneNode(true) as HTMLElement;
    c.classList.add("is-copy");
    c.setAttribute("aria-hidden", "true");
    c.querySelectorAll<HTMLElement>("a, button").forEach(a => { a.tabIndex = -1; });
    return c;
  };
  const ring = n > 1 ? [copy(slides[n - 1]), ...slides, copy(slides[0])] : slides;
  if (n > 1) { track.prepend(ring[0]); track.append(ring[n + 1]); }
  const real = (slot: number) => (n > 1 ? (slot - 1 + n) % n : 0);
  const width = () => track.clientWidth || 1;
  const slotNow = () => Math.round(track.scrollLeft / width());
  // To a slot at once, whatever the stylesheet's smooth scrolling says.
  const jump = (slot: number) => {
    track.style.scrollBehavior = "auto";
    track.scrollLeft = slot * width();
    track.style.scrollBehavior = "";
  };
  const glide = (slot: number) => track.scrollTo({ left: slot * width(), behavior: still ? "instant" : "smooth" });

  section.classList.add("is-live");
  const mark = (i: number) => {
    ring.forEach((s, slot) => {
      const on = real(slot) === i;
      s.classList.toggle("is-active", on);
      // The slides out of view are out of the tab order and the reading order too.
      s.inert = !on;
    });
    dots.forEach((d, k) => d.toggleAttribute("aria-current", k === i));
  };
  mark(0);
  // Before the observer looks, or it would see the copy of the last slide first.
  if (n > 1) jump(1);

  const seen = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) mark(real(ring.indexOf(e.target as HTMLElement)));
  }, { root: track, threshold: 0.6 });
  ring.forEach(s => seen.observe(s));

  // At rest on a copy, the jump to the slide it stands for. Never under a finger or a drag (it
  // would take the gesture), never mid-glide (only when the row sits exactly on the copy).
  const settle = () => {
    if (n < 2 || touching || drag) return;
    const slot = slotNow();
    if (Math.abs(track.scrollLeft - slot * width()) > 2) return;
    if (slot === 0) jump(n);
    else if (slot === n + 1) jump(1);
  };
  let quiet: ReturnType<typeof setTimeout> | undefined;
  track.addEventListener("scroll", () => { clearTimeout(quiet); quiet = setTimeout(settle, 120); }, { passive: true });
  track.addEventListener("scrollend", settle);

  // One slide on (or back) from where the row is; a dot straight to its slide.
  const step = (d: number) => {
    settle();
    glide(Math.max(0, Math.min(n + 1, slotNow() + d)));
  };
  const go = (i: number) => glide(i + 1);

  section.addEventListener("click", e => {
    const b = (e.target as Element).closest<HTMLElement>("[data-step], [data-to]");
    if (!b) return;
    if (b.dataset.to !== undefined) go(Number(b.dataset.to));
    else step(Number(b.dataset.step));
    restart();
  });
  track.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
      restart();
    }
  });

  // The slow turn.
  const hold = (v: boolean) => () => { held = v; };
  section.addEventListener("pointerenter", hold(true));
  section.addEventListener("pointerleave", hold(false));
  section.addEventListener("focusin", hold(true));
  section.addEventListener("focusout", hold(false));
  // A finger landing on a copy at rest is moved to its slide first, so the swipe goes on round.
  track.addEventListener("touchstart", () => { settle(); held = touching = true; restart(); }, { passive: true });
  track.addEventListener("touchend", () => { held = touching = false; restart(); }, { passive: true });
  track.addEventListener("touchcancel", () => { held = touching = false; }, { passive: true });
  track.addEventListener("wheel", e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) restart(); }, { passive: true });

  // A mouse drags the row. Snapping is off while it moves (the row would fight the hand), and
  // the release turns one slide in the drag's direction once it has gone a fifth of the way
  // (or was thrown quickly), else settles back where it was.
  // A link or a cover pressed and moved would start the browser's own drag-and-drop, which
  // takes the mouse away from the row: there is nothing here to drop anywhere.
  track.addEventListener("dragstart", e => e.preventDefault());
  track.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    settle();
    drag = { x: e.clientX, left: track.scrollLeft, t: e.timeStamp, moved: false };
  });
  track.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      track.setPointerCapture(e.pointerId);
      track.classList.add("is-dragging");
    }
    track.scrollLeft = drag.left - dx;
  });
  const release = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = undefined;
    if (!d.moved) return;
    const dx = e.clientX - d.x;
    const w = width();
    const from = Math.round(d.left / w);
    const far = Math.abs(dx) > w / 5 || (Math.abs(dx) > 40 && e.timeStamp - d.t < 300);
    // Snapping comes back only after the glide, or it would yank the row to the nearest stop.
    glide(Math.max(0, Math.min(ring.length - 1, far ? from + (dx < 0 ? 1 : -1) : from)));
    setTimeout(() => { track.classList.remove("is-dragging"); settle(); }, still ? 0 : 450);
    // The click that follows a drag's release is the drag's, not the link's.
    // The browser sends that click in the same turn as the release, so the guard comes off
    // straight after: a drag that ends with no click leaves nothing behind.
    const swallow = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
    track.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => track.removeEventListener("click", swallow, { capture: true }), 0);
    restart();
  };
  track.addEventListener("pointerup", release);
  track.addEventListener("pointercancel", release);

  let timer: ReturnType<typeof setInterval> | undefined;
  function restart() {
    clearInterval(timer);
    if (still || n < 2) return;
    timer = setInterval(() => {
      if (!track!.isConnected) { clearInterval(timer); seen.disconnect(); return; }
      if (!held && !document.hidden) step(1);
    }, TURN);
  }
  restart();
}
