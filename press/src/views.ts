// Every page of the press as lit-html templates. The build renders them to HTML on the
// server (@lit-labs/ssr), and the browser renders the same templates when it navigates,
// so the first paint and every later one come from one source.
import { html, nothing, type TemplateResult } from "lit";
import type { Catalogue, Collection, Route, Title } from "./types.ts";

/** The shelf draws this many cards at first, and this many more each time the reader nears
 *  its end (app.ts watches for that), so a long catalogue costs a phone only what it shows. */
export const SHELF_BATCH = 12;

/** The collection a title belongs to, if any. */
export const collectionOf = (t: Title, cat: Catalogue): Collection | undefined =>
  t.collection && cat.press.collections.find(c => c.slug === t.collection!.slug);

/** A collection's series line for a title in it: "Lérins Newman · No. 31". */
export function seriesLine(t: Title, cat: Catalogue): string | undefined {
  const c = collectionOf(t, cat);
  return c ? `${c.name} · No. ${t.collection!.no}` : undefined;
}

/** What a shelf is called wherever the site speaks of it: a collection is always "Lérins
 *  Newman Collection", never bare "Lérins Newman" (that is the series line printed on its
 *  books, "Lérins Newman · No. 31"). The books in no collection are Miscellaneous. */
export const shelfName = (c: Collection, cat: Catalogue) =>
  c === cat.press.originals ? c.name : `${c.name} Collection`;

/** Every shelf of the catalogue, in order: each collection, then Miscellaneous last. */
export const shelves = (cat: Catalogue): Collection[] => [...cat.press.collections, cat.press.originals];

/** Whether a title stands on a shelf: Miscellaneous holds every title in no collection. */
const belongs = (t: Title, c: Collection, cat: Catalogue) =>
  c === cat.press.originals ? !t.collection : t.collection?.slug === c.slug;

/** A shelf's titles: a collection's by number, Miscellaneous newest first. */
const inCollection = (c: Collection, cat: Catalogue) => cat.titles.filter(t => belongs(t, c, cat))
  .sort((a, b) => a.collection && b.collection ? a.collection.no - b.collection.no : b.listed.localeCompare(a.listed));

/** The cards a page's shelf draws, in order: on the home page every shelf in turn; on a
 *  shelf's own page, that shelf alone. The shelf draws them a batch at a time (`shown`), so
 *  this order is what "the next batch" means. */
export function shelfOrder(route: Route, cat: Catalogue): Title[] {
  if (route.kind === "collection") return inCollection(route.collection, cat);
  if (route.kind !== "home") return [];
  return shelves(cat).flatMap(c => inCollection(c, cat));
}

/** The client's own navigation, which app.ts installs: the collection menu calls it, so a pick
 *  hops like a link. Without the client it is a plain page load. */
export const nav = { go(path: string) { location.assign(path); } };

/** The path a route lives at. Every page path ends in a slash. */
export function pathOf(route: Route): string {
  switch (route.kind) {
    case "home": return "/";
    case "about": return "/about/";
    case "contact": return "/contact/";
    case "collection": return `/collections/${route.collection.slug.replace(/^lerins-/, "")}/`;
    case "title": return `/titles/${route.title.slug}/`;
    case "missing": return "/404.html";
  }
}

export function routeOf(path: string, cat: Catalogue): Route {
  const p = path.replace(/index\.html$/, "").replace(/\/?$/, "/");
  if (p === "/") return { kind: "home" };
  if (p === "/about/") return { kind: "about" };
  if (p === "/contact/") return { kind: "contact" };
  const c = /^\/collections\/([a-z0-9-]+)\/$/.exec(p);
  const collection = c ? shelves(cat).find(x => x.slug.replace(/^lerins-/, "") === c[1]) : undefined;
  if (collection) return { kind: "collection", collection };
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

/** The lockup preview (make brand), and each title's card, which the build makes from its
 *  cover (scripts/cards.ts). The cover itself is the fallback: portrait, so a large card crops it. */
const OG_IMAGE: Image = { src: "/brand/og.jpg", width: 1200, height: 630,
  alt: "The Lérins Press shield, the name, and Vincent's rule" };
const cardImage = (t: Title, press: string): Image => t.card
  ? { src: t.card, width: 1200, height: 630, alt: `The cover of ${t.title} beside its title, from ${press}` }
  : { src: `/covers/${t.cover}.jpg`, width: 800, height: 1199, alt: `Cover of ${t.title}` };

export function metaOf(route: Route, cat: Catalogue): Meta {
  const { press } = cat;
  switch (route.kind) {
    case "home":
      return { title: `${press.name} · ${press.tagline}`, description: press.about[0],
        path: "/", image: OG_IMAGE };
    case "about":
      return { title: `About · ${press.name}`, description: press.about[0],
        path: "/about/", image: OG_IMAGE };
    case "contact":
      return { title: `Correspondence · ${press.name}`, description: press.about[0],
        path: "/contact/", image: OG_IMAGE };
    case "collection": {
      const c = route.collection;
      return { title: `${shelfName(c, cat)} · ${press.name}`, description: c.about[0] ?? c.tagline,
        path: pathOf(route), image: OG_IMAGE };
    }
    case "title": {
      const t = route.title;
      const c = collectionOf(t, cat);
      return { title: `${t.title} · ${press.name}`,
        description: t.lead.join(" ") || (c ? `${seriesLine(t, cat)}. ${c.tagline}.` : press.tagline),
        path: pathOf(route), image: cardImage(t, press.name), book: t };
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
      ...(t.author ? { author: { "@type": "Person", name: t.author } } : {}), publisher: { "@id": org["@id"] },
      image: abs(`/covers/${t.cover}.jpg`), inLanguage: "en",
      ...(t.description.length ? { description: t.description.join(" ") } : {}),
      ...(t.amazon ? {
        workExample: [edition("Paperback", t.amazon), ...(t.kindle ? [edition("EBook", t.kindle)] : [])],
        sameAs: [t.amazon, ...(t.kindle && t.kindle !== t.amazon ? [t.kindle] : [])],
      } : {}),
    }],
  };
}

/** The press's mark: the shield from the owner's logo (content/brand, `make brand`). */
const SHIELD_W = 288;
const SHIELD_H = 469;
const mark = (cls: string, size: 144 | 400 = 144) => html`<img class=${cls}
  src="/brand/shield-${size}.webp" width=${SHIELD_W} height=${SHIELD_H} alt="">`;

/** A cover in WebP at two widths (480 for a card, 1000 for a book's page: `make cover`), the
 *  browser choosing by `sizes`; the .jpg is the fallback. Below the first row it waits for the
 *  reader to scroll near it (native lazy loading), and its width and height hold its place. */
const cover = (t: Title, sizes: string, eager = false) => {
  const [w, h] = t.coverSize ?? [1000, 1510];
  return html`<picture class="cover">
  <source type="image/webp" sizes=${sizes}
    srcset="/covers/${t.cover}-480.webp 480w, /covers/${t.cover}.webp 1000w">
  <img src="/covers/${t.cover}.jpg" width=${w} height=${h} sizes=${sizes}
    style="aspect-ratio: ${w} / ${h}" alt="Cover of ${t.title}"
    loading=${eager ? "eager" : "lazy"} fetchpriority=${eager ? "high" : "auto"} decoding="async">
</picture>`;
};

/** The buy buttons: green for the paperback, gold for the Kindle edition. A title not out yet
 *  has one pill in their place, in the charcoal theme's red, and no link. */
const buy = (t: Title, short = false) => !t.amazon
  ? html`<span class=${short ? "soon soon-small" : "soon"}>Coming soon</span>`
  : html`
  <a class=${short ? "btn btn-paper btn-small" : "btn btn-paper"} href=${t.amazon} rel="noopener"
    target="_blank"><span>${short ? "Paperback" : "Paperback on Amazon"}<span
    class="sr"> of ${t.title}${short ? " on Amazon" : ""}</span></span></a>
  ${t.kindle ? html`<a class=${short ? "btn btn-kindle btn-small" : "btn btn-kindle"} href=${t.kindle}
    rel="noopener" target="_blank"><span>${short ? "Kindle" : "Kindle on Amazon"}<span
    class="sr"> edition of ${t.title}${short ? " on Amazon" : ""}</span></span></a>` : nothing}`;

const card = (t: Title, i: number) => html`<li class="card">
  <a class="card-link" href="/titles/${t.slug}/">
    ${cover(t, "(max-width: 600px) 45vw, 230px", i < 4)}
    ${t.collection ? html`<span class="card-no">No. ${t.collection.no}</span>` : nothing}
    <span class="card-title">${t.title}</span>
    ${t.subtitle ? html`<span class="card-sub">${t.subtitle}</span>` : nothing}
    ${t.author ? html`<span class="card-author">${t.author}</span>` : nothing}
  </a>
  <p class="card-buy">${buy(t, true)}</p>
</li>`;

type Placed = { t: Title; i: number };

/** One collection's run of the shelf, a head per part: only the cards the reader has scrolled
 *  to so far (`shown` of the page's order), and nothing of a part not yet reached. On the home
 *  page it carries the collection's name, a link to its own page; on that page the head is
 *  the page's own. */
function collectionShelf(c: Collection, cat: Catalogue, placed: Placed[], named: boolean) {
  const name = shelfName(c, cat);
  const mine = placed.filter(({ t }) => belongs(t, c, cat));
  if (!mine.length) return nothing;
  const run = (cards: Placed[]) => html`<ul class="shelf">${cards.map(({ t, i }) => card(t, i))}</ul>`;
  return html`<section class="collection" aria-labelledby="c-${c.slug}">
    ${named ? html`<h3 class="collection-head" id="c-${c.slug}">
      <a href=${pathOf({ kind: "collection", collection: c })}>${name}</a></h3>
      <p class="collection-tag">${c.tagline}</p>` : nothing}
    ${c.parts.length ? c.parts.map(p => {
      const cards = mine.filter(({ t }) => t.collection!.part === p.slug);
      return cards.length ? html`<h4 class="part-head">${p.name}</h4>${run(cards)}` : nothing;
    }) : run(mine)}
  </section>`;
}

/** The catalogue's filter: All, then each shelf. Links, so every view has its own address;
 *  chips where there is room, a menu on a phone, where a dozen chips would stack. */
function filter(cat: Catalogue, current?: Collection): TemplateResult {
  const all = "/#books";
  const go = (e: Event) => nav.go((e.target as HTMLSelectElement).value);
  return html`<nav class="filter" aria-label="Collections">
    <ul class="chips">
      <li><a href=${all} aria-current=${current ? nothing : "page"}>All</a></li>
      ${shelves(cat).map(c => html`<li><a href=${pathOf({ kind: "collection", collection: c })}
        aria-current=${c === current ? "page" : nothing}>${c.short}</a></li>`)}
    </ul>
    <label class="filter-menu"><span>Show</span>
      <select @change=${go}>
        <option value=${all} ?selected=${!current}>All books</option>
        ${shelves(cat).map(c => html`<option value=${pathOf({ kind: "collection", collection: c })}
          ?selected=${c === current}>${shelfName(c, cat)}</option>`)}
      </select>
    </label>
  </nav>`;
}

const more = (shown: number, order: Title[]) =>
  shown < order.length ? html`<p class="shelf-more" aria-hidden="true"></p>` : nothing;

/** Featured reads: the home page's carousel, the titles press.json names, each a large cover
 *  on a blurred wash of itself, its words beside it. A row of slides that scrolls and snaps
 *  (a phone swipes it natively); src/carousel.ts adds the arrows, the dots, the slow turn and
 *  the entrance of each slide's words. */
function featured(cat: Catalogue): TemplateResult {
  const items = cat.press.featured.map(s => cat.titles.find(t => t.slug === s)).filter((t): t is Title => !!t);
  if (!items.length) return html``;
  const n = items.length;
  return html`<section class="featured" aria-roledescription="carousel" aria-labelledby="featured-head">
    <h2 class="rule-head" id="featured-head"><span>Featured reads</span></h2>
    <div class="featured-track" tabindex="0" aria-live="off">
      ${items.map((t, i) => {
        const href = `/titles/${t.slug}/`;
        const c = collectionOf(t, cat);
        return html`<article class="slide" aria-roledescription="slide" aria-label="${i + 1} of ${n}: ${t.title}">
          <div class="slide-wash" aria-hidden="true"><img src="/covers/${t.cover}-480.webp" alt=""
            loading=${i ? "lazy" : "eager"} decoding="async" width="480" height="725"></div>
          <a class="slide-cover" href=${href} tabindex="-1" aria-hidden="true">
            ${cover(t, "(max-width: 720px) 56vw, 300px", i === 0)}</a>
          <div class="slide-text">
            <p class="slide-kicker">${c ? seriesLine(t, cat) : t.amazon ? "Now in paperback and Kindle" : "Lérins Press"}</p>
            <h3 class="slide-title"><a href=${href}>${t.title}</a></h3>
            ${t.subtitle ? html`<p class="slide-sub">${t.subtitle}</p>` : nothing}
            ${t.author ? html`<p class="slide-author">${t.author}</p>` : nothing}
            ${t.lead[0] ? html`<p class="slide-lead">${t.lead[0]}</p>` : nothing}
            <p class="slide-actions">${buy(t)}<a class="slide-more" href=${href}>About this book</a></p>
          </div>
        </article>`;
      })}
    </div>
    <div class="featured-nav">
      <button type="button" class="featured-step" data-step="-1" aria-label="Previous book">‹</button>
      <span class="featured-dots">${items.map((t, i) => html`<button type="button" class="featured-dot"
        data-to=${i} aria-label="Show ${t.title}" aria-current=${i === 0 ? "true" : nothing}></button>`)}</span>
      <button type="button" class="featured-step" data-step="1" aria-label="Next book">›</button>
    </div>
  </section>`;
}

function home(cat: Catalogue, shown: number): TemplateResult {
  const { press } = cat;
  const order = shelfOrder({ kind: "home" }, cat);
  const placed = order.map((t, i) => ({ t, i })).filter(({ i }) => i < shown);
  return html`
    <section class="hero">
      ${mark("hero-shield", 400)}
      <h1 class="wordmark" tabindex="-1">${press.name}</h1>
      <p class="ornament" aria-hidden="true"><span></span></p>
      <p class="motto-latin" lang="la">${press.motto.latin}</p>
      <p class="motto-english">${press.motto.english}</p>
      <p class="motto-source">${press.motto.source}</p>
    </section>
    ${featured(cat)}
    <h2 class="rule-head rule-head-books" id="books"><span>The books of Lérins Press</span></h2>
    ${filter(cat)}
    ${shelves(cat).map(c => collectionShelf(c, cat, placed, true))}
    ${more(shown, order)}`;
}

function collectionPage(c: Collection, cat: Catalogue, shown: number): TemplateResult {
  const order = shelfOrder({ kind: "collection", collection: c }, cat);
  const placed = order.map((t, i) => ({ t, i })).filter(({ i }) => i < shown);
  return html`
    ${filter(cat, c)}
    <header class="collection-intro">
      <p class="collection-kicker">${c === cat.press.originals ? "Lérins Press" : "A collection of Lérins Press"} · ${
        order.length} ${order.length === 1 ? "title" : "titles"}</p>
      <h1 tabindex="-1">${shelfName(c, cat)}</h1>
      <p class="collection-tagline">${c.tagline}</p>
      <p class="ornament" aria-hidden="true"><span></span></p>
      ${c.about.map(p => html`<p>${p}</p>`)}
    </header>
    ${collectionShelf(c, cat, placed, false)}
    ${more(shown, order)}`;
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
  const body = t.lead[0] ? `${t.lead[0]}\n\n${url}` : url;
  return html`<div class="share" role="group" aria-label="Share this book">
    <span class="share-label">Share</span>
    <a href="https://x.com/intent/post?text=${q(text)}&url=${q(url)}" rel="noopener" target="_blank">X</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${q(url)}" rel="noopener" target="_blank">Facebook</a>
    <a href="mailto:?subject=${q(text)}&body=${q(body)}">Email</a>
    <button type="button" data-url=${url} @click=${copyLink}>Copy link</button>
  </div>`;
}

const partName = (t: Title, cat: Catalogue) =>
  collectionOf(t, cat)?.parts.find(p => p.slug === t.collection!.part)?.name;

function titlePage(t: Title, cat: Catalogue): TemplateResult {
  const c = collectionOf(t, cat);
  // Two ways back, stacked: to the whole catalogue, and to the shelf this book stands on.
  const shelf = c ?? cat.press.originals;
  return html`
    <nav class="back" aria-label="Back">
      <a href="/#books">Back to All Books</a>
      <a href=${pathOf({ kind: "collection", collection: shelf })}>Back to ${shelfName(shelf, cat)}</a>
    </nav>
    <article class="book">
      <div class="book-cover">${cover(t, "(max-width: 720px) 70vw, 340px", true)}</div>
      <div class="book-text">
        ${c ? html`<p class="book-series"><a href=${pathOf({ kind: "collection", collection: c })}>${seriesLine(t, cat)}</a>${
          partName(t, cat) ? html`<span> · ${partName(t, cat)}</span>` : nothing}</p>` : nothing}
        <h1 tabindex="-1">${t.title}</h1>
        ${t.subtitle ? html`<p class="book-sub">${t.subtitle}</p>` : nothing}
        <p class="book-by">${t.author ? `${t.author} · ` : ""}${!t.amazon ? "Paperback and Kindle" : t.kindle ? `${t.format} and Kindle` : t.format}</p>
        ${!t.lead.length || t.description[0]?.startsWith(t.lead[0]) ? nothing
          : html`<div class="book-lead">${t.lead.map(p => html`<p>${p}</p>`)}</div>`}
        <p class="actions">
          ${buy(t)}
        </p>
        ${share(t, cat)}
        ${t.description.length ? html`<div class="book-desc">${t.description.map(p => html`<p>${p}</p>`)}</div>`
          : c ? html`<div class="book-desc">
            <p class="book-pending">This edition is in preparation. From the collection:</p>
            ${c.about.map(p => html`<p>${p}</p>`)}</div>` : nothing}
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
      <h2>${press.hope.heading}</h2>
      ${press.hope.paragraphs.map(p => html`<p>${p}</p>`)}
      <ul class="further">
        ${press.hope.further.map(f => html`<li><a href=${f.url} rel="noopener">${f.label}</a>: ${f.note}.</li>`)}
      </ul>
      <p class="about-close"><a href="/#books">See the books of ${press.name}</a></p>
    </article>`;
}

function missing(): TemplateResult {
  return html`<article class="prose">
    <h1 tabindex="-1">No such page</h1>
    <p><a href="/">See all books</a></p>
  </article>`;
}

/** Correspondence: the press's contact page, posted to merecatholicity.com's contact worker
 *  (src/contact.ts binds it). The honeypot is for bots, the challenge's slot fills on intent. */
const contact = () => html`<article class="prose contact">
  <h1 tabindex="-1">Correspondence</h1>
  <p>A question about a book, a correction, or a word for the editors.</p>
  <form id="press-contact" action="https://contact-api.merecatholicity.com/" method="POST">
    <div class="contact-row">
      <label>Name<input type="text" name="name" maxlength="200" autocomplete="name"></label>
      <label>Email, if you want a reply<input type="email" name="email" maxlength="200" autocomplete="email"></label>
    </div>
    <label>Message<textarea name="message" maxlength="5000" rows="8" required></textarea></label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="contact-ts"></div>
    <div class="contact-foot">
      <button type="submit" class="btn btn-send">Send</button>
      <p class="contact-status" role="status"></p>
    </div>
  </form>
</article>`;

/** The whole page: masthead, the route's body, footer. `shown` is how many of the shelf's
 *  cards the page draws: the first batch on the server, more as the reader scrolls. */
export function page(route: Route, cat: Catalogue, shown = SHELF_BATCH): TemplateResult {
  const { press } = cat;
  const body = route.kind === "home" ? home(cat, shown)
    : route.kind === "collection" ? collectionPage(route.collection, cat, shown)
    : route.kind === "title" ? titlePage(route.title, cat)
    : route.kind === "about" ? about(cat)
    : route.kind === "contact" ? contact()
    : missing();
  const here = (...k: Route["kind"][]) => k.includes(route.kind) ? "page" : nothing;
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
        <a href="/" aria-current=${here("home", "collection")}>Books</a>
        <a href="/about/" aria-current=${here("about")}>About</a>
        <a href="/contact/" aria-current=${here("contact")}>Contact</a>
        <a href=${press.parent.url} rel="noopener">${press.parent.url.replace(/^https:\/\//, "")}</a>
      </nav>
    </header>
    <main id="main">${body}</main>
    <footer class="colophon">
      ${mark("mark")}
      <p class="colophon-name">${press.name}</p>
      <p class="colophon-links">
        <a href=${press.parent.url} rel="noopener">${press.parent.name}</a>
        <a href="/contact/">Contact</a>
        ${press.social.map(s => html`<a href=${s.url} rel="me noopener">${s.name}</a>`)}
        <a href="/rss.xml">RSS</a>
        <a href="/sitemap.xml">Sitemap</a>
      </p>
    </footer>`;
}
