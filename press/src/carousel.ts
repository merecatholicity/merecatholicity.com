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
//   - from the last slide to the first (or back) a quick fade, never a long rewind
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
  let index = 0;
  let held = false;

  section.classList.add("is-live");
  const mark = (i: number) => {
    index = i;
    slides.forEach((s, k) => {
      s.classList.toggle("is-active", k === i);
      // The slides out of view are out of the tab order and the reading order too.
      s.inert = k !== i;
    });
    dots.forEach((d, k) => d.toggleAttribute("aria-current", k === i));
  };
  mark(0);

  const seen = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) mark(slides.indexOf(e.target as HTMLElement));
  }, { root: track, threshold: 0.6 });
  slides.forEach(s => seen.observe(s));

  const go = (i: number) => {
    const n = slides.length;
    const k = ((i % n) + n) % n;
    const left = slides[k].offsetLeft - slides[0].offsetLeft;
    if (still || Math.abs(k - index) <= 1) {
      track.scrollTo({ left, behavior: still ? "auto" : "smooth" });
      return;
    }
    // A wrap: fade out, jump, fade in.
    track.classList.add("is-wrapping");
    setTimeout(() => {
      track.style.scrollBehavior = "auto";
      track.scrollTo({ left, behavior: "auto" });
      track.style.scrollBehavior = "";
      track.classList.remove("is-wrapping");
    }, 260);
  };

  section.addEventListener("click", e => {
    const b = (e.target as Element).closest<HTMLElement>("[data-step], [data-to]");
    if (!b) return;
    go(b.dataset.to !== undefined ? Number(b.dataset.to) : index + Number(b.dataset.step));
    restart();
  });
  track.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      go(index + (e.key === "ArrowRight" ? 1 : -1));
      restart();
    }
  });

  // The slow turn.
  const hold = (v: boolean) => () => { held = v; };
  section.addEventListener("pointerenter", hold(true));
  section.addEventListener("pointerleave", hold(false));
  section.addEventListener("focusin", hold(true));
  section.addEventListener("focusout", hold(false));
  track.addEventListener("touchstart", () => { held = true; restart(); }, { passive: true });
  track.addEventListener("touchend", () => { held = false; restart(); }, { passive: true });
  track.addEventListener("touchcancel", () => { held = false; }, { passive: true });
  track.addEventListener("wheel", e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) restart(); }, { passive: true });

  // A mouse drags the row. Snapping is off while it moves (the row would fight the hand), and
  // the release turns one slide in the drag's direction once it has gone a fifth of the way
  // (or was thrown quickly), else settles back where it was.
  let drag: { x: number; left: number; t: number; moved: boolean } | undefined;
  // A link or a cover pressed and moved would start the browser's own drag-and-drop, which
  // takes the mouse away from the row: there is nothing here to drop anywhere.
  track.addEventListener("dragstart", e => e.preventDefault());
  track.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
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
    const w = slides[0].offsetWidth || 1;
    const far = Math.abs(dx) > w / 5 || (Math.abs(dx) > 40 && e.timeStamp - d.t < 300);
    const to = far ? index + (dx < 0 ? 1 : -1) : index;
    // Snapping comes back only after the glide, or it would yank the row to the nearest stop.
    track.scrollTo({ left: Math.max(0, Math.min(slides.length - 1, to)) * w, behavior: still ? "auto" : "smooth" });
    setTimeout(() => track.classList.remove("is-dragging"), still ? 0 : 450);
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
    if (still || slides.length < 2) return;
    timer = setInterval(() => {
      if (!track!.isConnected) { clearInterval(timer); seen.disconnect(); return; }
      if (!held && !document.hidden) go(index + 1);
    }, TURN);
  }
  restart();
}
