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

/** A link-preview image: site-relative, with its size and its words. */
interface Image { src: string; width: number; height: number; alt: string }

export interface Meta {
  title: string;
  description: string;
  path: string;
  image: Image;
  book?: Title;
}

/** The covers' .jpg (make covers) and the lockup preview (make brand). */
const OG_IMAGE: Image = { src: "/brand/og.jpg", width: 1200, height: 630,
  alt: "The Lérins Press shield, the name, and Vincent's rule" };
const coverImage = (t: Title): Image => ({ src: `/covers/${t.cover}.jpg`, width: 800, height: 1199,
  alt: `Cover of ${t.title}` });

export function metaOf(route: Route, cat: Catalogue): Meta {
  const { press } = cat;
  switch (route.kind) {
    case "home":
      return { title: `${press.name} · ${press.tagline}`, description: press.about[0],
        path: "/", image: OG_IMAGE };
    case "about":
      return { title: `About · ${press.name}`, description: press.about[0],
        path: "/about/", image: OG_IMAGE };
    case "title": {
      const t = route.title;
      return { title: `${t.title} · ${press.name}`, description: t.lead.join(" "),
        path: pathOf(route), image: coverImage(t), book: t };
    }
    case "missing":
      return { title: `No such page · ${press.name}`, description: press.tagline,
        path: "/404.html", image: OG_IMAGE };
  }
}

/** Every <meta> the head carries for a page: the description, Open Graph and the X card,
 *  the same set the main site writes (scripts/inject_social.py there). The build writes
 *  them; the browser rewrites them on a hop. [attribute, key, content], URLs absolute. */
export function headTags(meta: Meta, cat: Catalogue): [string, string, string][] {
  const abs = (p: string) => new URL(p, cat.press.url + "/").href;
  const tags: [string, string, string][] = [
    ["name", "description", meta.description],
    ["property", "og:site_name", cat.press.name],
    ["property", "og:type", meta.book ? "book" : "website"],
    ["property", "og:locale", "en_US"],
    ["property", "og:title", meta.title],
    ["property", "og:description", meta.description],
    ["property", "og:url", abs(meta.path)],
    ["property", "og:image", abs(meta.image.src)],
    ["property", "og:image:width", String(meta.image.width)],
    ["property", "og:image:height", String(meta.image.height)],
    ["property", "og:image:alt", meta.image.alt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.title],
    ["name", "twitter:description", meta.description],
    ["name", "twitter:image", abs(meta.image.src)],
    ["name", "twitter:image:alt", meta.image.alt],
  ];
  if (meta.book) tags.push(["property", "book:author", meta.book.author]);
  return tags;
}

/** schema.org for search engines: the press as an Organization on every page, and on a
 *  title's page the Book, its paperback and Kindle editions, and where to buy them. */
export function jsonLd(route: Route, cat: Catalogue): object {
  const { press } = cat;
  const abs = (p: string) => new URL(p, press.url + "/").href;
  const org = {
    "@type": "Organization", "@id": abs("/#press"), name: press.name, url: abs("/"),
    logo: abs("/brand/shield-400.webp"), slogan: press.motto.latin,
    parentOrganization: { "@type": "Organization", name: press.parent.name, url: press.parent.url },
    sameAs: [press.parent.url, ...press.social.map(s => s.url)],
  };
  if (route.kind !== "title") return { "@context": "https://schema.org", ...org };
  const t = route.title;
  const edition = (bookFormat: string, url: string) =>
    ({ "@type": "Book", bookFormat: `https://schema.org/${bookFormat}`, url, publisher: { "@id": org["@id"] } });
  return {
    "@context": "https://schema.org",
    "@graph": [org, {
      "@type": "Book", "@id": abs(pathOf(route)) + "#book", url: abs(pathOf(route)),
      name: t.title, ...(t.subtitle ? { alternativeHeadline: t.subtitle } : {}),
      author: { "@type": "Person", name: t.author }, publisher: { "@id": org["@id"] },
      image: abs(`/covers/${t.cover}.jpg`), description: t.description.join(" "), inLanguage: "en",
      workExample: [edition("Paperback", t.amazon), ...(t.kindle ? [edition("EBook", t.kindle)] : [])],
      sameAs: [t.amazon, ...(t.kindle && t.kindle !== t.amazon ? [t.kindle] : []), ...(t.readFree ? [t.readFree] : [])],
    }],
  };
}

/** The press's mark: the shield from the owner's logo (content/brand, `make brand`). */
const SHIELD_W = 288;
const SHIELD_H = 469;
const mark = (cls: string, size: 144 | 400 = 144) => html`<img class=${cls}
  src="/brand/shield-${size}.webp" width=${SHIELD_W} height=${SHIELD_H} alt="">`;

const cover = (t: Title, sizes: string, eager = false) => html`<picture class="cover">
  <source type="image/avif" srcset="/covers/${t.cover}.avif">
  <img src="/covers/${t.cover}.jpg" width=${COVER_W} height=${COVER_H} sizes=${sizes}
    alt="Cover of ${t.title}" loading=${eager ? "eager" : "lazy"} decoding="async">
</picture>`;

/** The buy buttons: green for the paperback, gold for the Kindle edition. */
const buy = (t: Title, short = false) => html`
  <a class=${short ? "btn btn-paper btn-small" : "btn btn-paper"} href=${t.amazon} rel="noopener"
    target="_blank"><span>${short ? "Paperback" : "Paperback on Amazon"}<span
    class="sr"> of ${t.title}${short ? " on Amazon" : ""}</span></span></a>
  ${t.kindle ? html`<a class=${short ? "btn btn-kindle btn-small" : "btn btn-kindle"} href=${t.kindle}
    rel="noopener" target="_blank"><span>${short ? "Kindle" : "Kindle on Amazon"}<span
    class="sr"> edition of ${t.title}${short ? " on Amazon" : ""}</span></span></a>` : nothing}`;

function home(cat: Catalogue): TemplateResult {
  const { press, titles } = cat;
  return html`
    <section class="hero">
      ${mark("hero-shield", 400)}
      <h1 class="wordmark" tabindex="-1">${press.name}</h1>
      <p class="ornament" aria-hidden="true"><span></span></p>
      <p class="motto-latin" lang="la">${press.motto.latin}</p>
      <p class="motto-english">${press.motto.english}</p>
      <p class="motto-source">${press.motto.source}</p>
    </section>
    <h2 class="rule-head"><span>Books</span></h2>
    <ul class="shelf">
      ${titles.map((t, i) => html`<li class="card">
        <a class="card-link" href="/titles/${t.slug}/">
          ${cover(t, "(max-width: 600px) 45vw, 240px", i < 4)}
          <span class="card-title">${t.title}</span>
          ${t.subtitle ? html`<span class="card-sub">${t.subtitle}</span>` : nothing}
          <span class="card-author">${t.author}</span>
        </a>
        <p class="card-buy">${buy(t, true)}</p>
      </li>`)}
    </ul>`;
}

/** Copy a page's address; the button says it worked (or that it could not). */
function copyLink(e: Event) {
  const button = e.currentTarget as HTMLButtonElement;
  const done = (word: string) => {
    button.textContent = word;
    setTimeout(() => { button.textContent = "Copy link"; }, 2000);
  };
  navigator.clipboard?.writeText(button.dataset.url ?? location.href)
    .then(() => done("Copied"), () => done("Could not copy"));
}

/** Share a title: X, Facebook, email, or the bare address. Plain links, no scripts of theirs. */
function share(t: Title, cat: Catalogue): TemplateResult {
  const url = new URL(`/titles/${t.slug}/`, cat.press.url + "/").href;
  const text = t.subtitle ? `${t.title}: ${t.subtitle}` : t.title;
  const q = encodeURIComponent;
  return html`<div class="share" role="group" aria-label="Share this book">
    <span class="share-label">Share</span>
    <a href="https://x.com/intent/post?text=${q(text)}&url=${q(url)}" rel="noopener" target="_blank">X</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${q(url)}" rel="noopener" target="_blank">Facebook</a>
    <a href="mailto:?subject=${q(text)}&body=${q(`${t.lead[0]}\n\n${url}`)}">Email</a>
    <button type="button" data-url=${url} @click=${copyLink}>Copy link</button>
  </div>`;
}

function titlePage(t: Title, cat: Catalogue): TemplateResult {
  return html`
    <p class="back"><a href="/">All books</a></p>
    <article class="book">
      <div class="book-cover">${cover(t, "(max-width: 720px) 70vw, 340px", true)}</div>
      <div class="book-text">
        <h1 tabindex="-1">${t.title}</h1>
        ${t.subtitle ? html`<p class="book-sub">${t.subtitle}</p>` : nothing}
        <p class="book-by">${t.author} · ${t.kindle ? `${t.format} and Kindle` : t.format}</p>
        ${t.description[0]?.startsWith(t.lead[0]) ? nothing
          : html`<div class="book-lead">${t.lead.map(p => html`<p>${p}</p>`)}</div>`}
        <p class="actions">
          ${buy(t)}
          ${t.readFree ? html`<a class="btn btn-outline" href=${t.readFree} rel="noopener">Read it free online</a>` : nothing}
        </p>
        ${share(t, cat)}
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
    : route.kind === "title" ? titlePage(route.title, cat)
    : route.kind === "about" ? about(cat)
    : missing();
  const here = (k: Route["kind"]) => route.kind === k ? "page" : undefined;
  return html`
    <a class="skip" href="#main">Skip to content</a>
    <header class="masthead">
      <a class="brand" href="/" aria-label="${press.name}, home">
        ${mark("mark")}
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
      ${mark("mark")}
      <p class="colophon-name">${press.name}</p>
      <p class="colophon-links">
        <a href=${press.parent.url} rel="noopener">${press.parent.name}</a>
        ${press.social.map(s => html`<a href=${s.url} rel="me noopener">${s.name}</a>`)}
        <a href="/rss.xml">RSS</a>
        <a href="/sitemap.xml">Sitemap</a>
      </p>
    </footer>`;
}
