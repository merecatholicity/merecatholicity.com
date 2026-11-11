// The browser half: take over the server-rendered page and navigate without reloads.
// The catalogue rides the page itself (#press-data), so a hop fetches nothing.
import { render } from "lit";
import { hydrate } from "@lit-labs/ssr-client";
import type { Catalogue, Route } from "./types.ts";
import { headTags, metaOf, page, routeOf } from "./views.ts";

const dataEl = document.getElementById("press-data");
const root = document.getElementById("app");

if (dataEl && root) {
  const cat = JSON.parse(dataEl.textContent ?? "{}") as Catalogue;

  const setMeta = (sel: string, attr: string, value: string) =>
    document.querySelector(sel)?.setAttribute(attr, value);

  const show = (path: string, hop: boolean) => {
    const route = routeOf(path, cat);
    render(page(route, cat), root);
    head(route, hop);
  };

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

  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || /\.[a-z0-9]+$/i.test(url.pathname)) return;
    if (url.hash && url.pathname === location.pathname) return;
    e.preventDefault();
    if (url.pathname !== location.pathname) history.pushState(null, "", url.pathname);
    show(url.pathname, true);
  });

  window.addEventListener("popstate", () => show(location.pathname, false));
}
