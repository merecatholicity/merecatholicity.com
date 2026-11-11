// Every page of the press as lit-html templates. The build renders them to HTML on the
// server (@lit-labs/ssr), and the browser renders the same templates when it navigates,
// so the first paint and every later one come from one source.
import { html, nothing, type TemplateResult } from "lit";
import type { Catalogue, Route, Title } from "./types.ts";

export const COVER_W = 1000;
export const COVER_H = 1499;

/** The path a route lives at. Every page path ends in a slash. */
export function pathOf(route: Route): string {
  switch (route.kind) {
    case "home": return "/";
    case "about": return "/about/";
    case "title": return `/titles/${route.title.slug}/`;
    case "missing": return "/404.html";
  }
}

export function routeOf(path: string, cat: Catalogue): Route {
  const p = path.replace(/index\.html$/, "").replace(/\/?$/, "/");
  if (p === "/") return { kind: "home" };
  if (p === "/about/") return { kind: "about" };
  const m = /^\/titles\/([a-z0-9-]+)\/$/.exec(p);
  const title = m ? cat.titles.find(t => t.slug === m[1]) : undefined;
  return title ? { kind: "title", title } : { kind: "missing" };
}

export interface Meta {
  title: string;
  description: string;
  path: string;
  /** Site-relative image for link previews. */
  image: string;
}

export function metaOf(route: Route, cat: Catalogue): Meta {
  const { press } = cat;
  const first = cat.titles[0];
  switch (route.kind) {
    case "home":
      return { title: `${press.name} · ${press.tagline}`, description: press.about[0],
        path: "/", image: first ? `/covers/${first.cover}.jpg` : "/favicon.svg" };
    case "about":
      return { title: `About · ${press.name}`, description: press.about[0],
        path: "/about/", image: first ? `/covers/${first.cover}.jpg` : "/favicon.svg" };
    case "title": {
      const t = route.title;
      return { title: `${t.title} · ${press.name}`, description: t.lead.join(" "),
        path: pathOf(route), image: `/covers/${t.cover}.jpg` };
    }
    case "missing":
      return { title: `No such page · ${press.name}`, description: press.tagline,
        path: "/404.html", image: "/favicon.svg" };
  }
}

/** The press's mark. A placeholder until the owner's logo arrives (_series/art/logo). */
const mark = html`<svg class="mark" viewBox="0 0 48 48" aria-hidden="true">
  <circle cx="24" cy="24" r="22.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M14 33h20M17 33V20l7-6 7 6v13M21.5 33v-6.5a2.5 2.5 0 0 1 5 0V33" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M10 37.5c3 0 3-1.5 6-1.5s3 1.5 6 1.5 3-1.5 6-1.5 3 1.5 6 1.5 3-1.5 4-1.5" fill="none"
    stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

const cover = (t: Title, sizes: string, eager = false) => html`<picture class="cover">
  <source type="image/avif" srcset="/covers/${t.cover}.avif">
  <img src="/covers/${t.cover}.jpg" width=${COVER_W} height=${COVER_H} sizes=${sizes}
    alt="Cover of ${t.title}" loading=${eager ? "eager" : "lazy"} decoding="async">
</picture>`;

const amazon = (t: Title, short = false) => html`<a class=${short ? "btn btn-small" : "btn"}
  href=${t.amazon} rel="noopener" target="_blank"><span>${short ? "Buy" : "Buy the paperback"}<span
  class="sr"> ${t.title}</span> on Amazon</span></a>`;

function home(cat: Catalogue): TemplateResult {
  const { press, titles } = cat;
  return html`
    <section class="hero">
      <p class="motto-latin" lang="la">${press.motto.latin}</p>
      <p class="motto-english">${press.motto.english}</p>
      <p class="motto-source">${press.motto.source}</p>
    </section>
    <h1 class="rule-head" tabindex="-1"><span>Books</span></h1>
    <ul class="shelf">
      ${titles.map((t, i) => html`<li class="card">
        <a class="card-link" href="/titles/${t.slug}/">
          ${cover(t, "(max-width: 600px) 45vw, 240px", i < 4)}
          <span class="card-title">${t.title}</span>
          ${t.subtitle ? html`<span class="card-sub">${t.subtitle}</span>` : nothing}
          <span class="card-author">${t.author}</span>
        </a>
        ${amazon(t, true)}
      </li>`)}
    </ul>`;
}

function titlePage(t: Title): TemplateResult {
  return html`
    <p class="back"><a href="/">All books</a></p>
    <article class="book">
      <div class="book-cover">${cover(t, "(max-width: 720px) 70vw, 340px", true)}</div>
      <div class="book-text">
        <h1 tabindex="-1">${t.title}</h1>
        ${t.subtitle ? html`<p class="book-sub">${t.subtitle}</p>` : nothing}
        <p class="book-by">${t.author} · ${t.format}</p>
        ${t.description[0]?.startsWith(t.lead[0]) ? nothing
          : html`<div class="book-lead">${t.lead.map(p => html`<p>${p}</p>`)}</div>`}
        <p class="actions">
          ${amazon(t)}
          ${t.readFree ? html`<a class="btn btn-outline" href=${t.readFree} rel="noopener">Read it free online</a>` : nothing}
        </p>
        <div class="book-desc">${t.description.map(p => html`<p>${p}</p>`)}</div>
      </div>
    </article>`;
}

function about(cat: Catalogue): TemplateResult {
  const { press } = cat;
  return html`
    <article class="prose">
      <h1 tabindex="-1">About the press</h1>
      ${press.about.map(p => html`<p>${p}</p>`)}
      <blockquote class="motto-block">
        <p lang="la">${press.motto.latin}</p>
        <p>${press.motto.english}</p>
        <footer>${press.motto.source}</footer>
      </blockquote>
      <p><a href=${press.parent.url} rel="noopener">Visit ${press.parent.name}</a></p>
    </article>`;
}

function missing(): TemplateResult {
  return html`<article class="prose">
    <h1 tabindex="-1">No such page</h1>
    <p><a href="/">See all books</a></p>
  </article>`;
}

/** The whole page: masthead, the route's body, footer. */
export function page(route: Route, cat: Catalogue): TemplateResult {
  const { press } = cat;
  const body = route.kind === "home" ? home(cat)
    : route.kind === "title" ? titlePage(route.title)
    : route.kind === "about" ? about(cat)
    : missing();
  const here = (k: Route["kind"]) => route.kind === k ? "page" : undefined;
  return html`
    <a class="skip" href="#main">Skip to content</a>
    <header class="masthead">
      <a class="brand" href="/" aria-label="${press.name}, home">
        ${mark}
        <span class="brand-text">
          <span class="brand-name">${press.name}</span>
          <span class="brand-tag">${press.tagline}</span>
        </span>
      </a>
      <nav class="nav" aria-label="Site">
        <a href="/" aria-current=${here("home") ?? nothing}>Books</a>
        <a href="/about/" aria-current=${here("about") ?? nothing}>About</a>
        <a href=${press.parent.url} rel="noopener">${press.parent.url.replace(/^https:\/\//, "")}</a>
      </nav>
    </header>
    <main id="main">${body}</main>
    <footer class="colophon">
      ${mark}
      <p class="colophon-name">${press.name}</p>
      <p class="colophon-links">
        <a href=${press.parent.url} rel="noopener">${press.parent.name}</a>
        <a href="/rss.xml">RSS</a>
        <a href="/sitemap.xml">Sitemap</a>
      </p>
    </footer>`;
}
