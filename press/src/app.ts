// The browser half: take over the server-rendered page and navigate without reloads.
// The catalogue rides the page itself (#press-data), so a hop fetches nothing.
import { render } from "lit";
import type { Catalogue } from "./types.ts";
import { metaOf, page, routeOf } from "./views.ts";

const dataEl = document.getElementById("press-data");
const root = document.getElementById("app");

if (dataEl && root) {
  const cat = JSON.parse(dataEl.textContent ?? "{}") as Catalogue;

  const setMeta = (sel: string, attr: string, value: string) =>
    document.querySelector(sel)?.setAttribute(attr, value);

  const show = (path: string, hop: boolean) => {
    const route = routeOf(path, cat);
    render(page(route, cat), root);
    const meta = metaOf(route, cat);
    document.title = meta.title;
    const url = new URL(meta.path, cat.press.url).href;
    setMeta('meta[name="description"]', "content", meta.description);
    setMeta('link[rel="canonical"]', "href", url);
    setMeta('meta[property="og:title"]', "content", meta.title);
    setMeta('meta[property="og:description"]', "content", meta.description);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:image"]', "content", new URL(meta.image, cat.press.url).href);
    if (hop) {
      window.scrollTo(0, 0);
      root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
  };

  // The server's markup is the same page; replace it once with the live render.
  root.replaceChildren();
  show(location.pathname, false);

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
