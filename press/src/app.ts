// The browser half: take over the server-rendered page and navigate without reloads.
// The catalogue rides the page itself (#press-data), so a hop fetches nothing.
import { render } from "lit";
import { hydrate } from "@lit-labs/ssr-client";
import type { Catalogue, Route } from "./types.ts";
import { bindContact } from "./contact.ts";
import { bindCarousel } from "./carousel.ts";
import { SHELF_BATCH, headTags, metaOf, nav, page, routeOf, shelfOrder } from "./views.ts";

const dataEl = document.getElementById("press-data");
const root = document.getElementById("app");

if (dataEl && root) {
  const cat = JSON.parse(dataEl.textContent ?? "{}") as Catalogue;

  const setMeta = (sel: string, attr: string, value: string) =>
    document.querySelector(sel)?.setAttribute(attr, value);

  // How many shelf cards each page draws (the home page, each collection's). It only grows,
  // and survives a hop, so coming back from a book finds the shelf as long as it was and the
  // browser can restore the scroll.
  const shown = new Map<string, number>();
  let path = location.pathname;
  const count = () => shown.get(path) ?? SHELF_BATCH;

  // The shelf grows as the reader nears its end: the marker after the last card is watched,
  // well before it is on screen, and each sighting adds a batch. No scroll listener runs.
  const more = new IntersectionObserver(entries => {
    const total = shelfOrder(routeOf(path, cat), cat).length;
    if (!entries.some(e => e.isIntersecting) || count() >= total) return;
    shown.set(path, Math.min(total, count() + SHELF_BATCH));
    draw();
  }, { rootMargin: "0px 0px 1200px 0px" });

  const watch = () => {
    bindCarousel(root);
    more.disconnect();
    const marker = root.querySelector(".shelf-more");
    if (marker) more.observe(marker);
  };

  const draw = () => {
    render(page(routeOf(path, cat), cat, count()), root);
    watch();
  };

  const show = (to: string, hop: boolean, hash = "") => {
    path = to;
    draw();
    head(routeOf(to, cat), hop && !hash);
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  };

  /** A hop, as a link press makes one: the collection menu uses it too. */
  const go = (href: string) => {
    const url = new URL(href, location.href);
    if (url.pathname !== location.pathname || url.hash !== location.hash)
      history.pushState(null, "", url.pathname + url.hash);
    show(url.pathname, true, url.hash);
  };
  nav.go = go;

  /** The head and the focus follow the page: title, description, canonical, link preview. */
  const head = (route: Route, hop: boolean) => {
    const meta = metaOf(route, cat);
    document.title = meta.title;
    setMeta('link[rel="canonical"]', "href", new URL(meta.path, cat.press.url).href);
    // The tags the build wrote, rewritten for this page: one added where the page has a
    // tag the last did not (book:author), one dropped where it has fewer. The JSON-LD stays
    // as the server wrote it: crawlers read the served page, not a hop.
    const tags = headTags(meta, cat);
    const keep = new Set(tags.map(([a, k]) => `${a}=${k}`));
    for (const el of document.head.querySelectorAll("meta[property], meta[name]")) {
      const a = el.hasAttribute("property") ? "property" : "name";
      const k = el.getAttribute(a) ?? "";
      if ((k.includes(":") || k === "description") && !keep.has(`${a}=${k}`)) el.remove();
    }
    for (const [a, k, v] of tags) {
      let el = document.head.querySelector(`meta[${a}="${k}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(a, k);
        document.head.append(el);
      }
      el.setAttribute("content", v);
    }
    if (hop) {
      window.scrollTo(0, 0);
      root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
  };

  // The server's markup is this same template: adopt it in place rather than redraw it, so
  // nothing the first paint showed (a cover mid-load) is thrown away and fetched again.
  const first = routeOf(location.pathname, cat);
  hydrate(page(first, cat), root);
  head(first, false);
  watch();

  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || /\.[a-z0-9]+$/i.test(url.pathname)) return;
    if (url.hash && url.pathname === location.pathname) return;
    e.preventDefault();
    go(url.href);
  });

  window.addEventListener("popstate", () => show(location.pathname, false));
  bindContact();
}
