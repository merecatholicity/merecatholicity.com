// Every page of the press as lit-html templates. The build renders them to HTML on the
// server (@lit-labs/ssr), and the browser renders the same templates when it navigates,
// so the first paint and every later one come from one source.
import { html, nothing, type TemplateResult } from "lit";
import { type Catalogue, type Collection, type Recommendations, type Recommended, type Route, type Title } from "./types.ts";

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
 *  books, "Lérins Newman · No. 31"). The books in no collection are Originals. */
export const shelfName = (c: Collection, cat: Catalogue) =>
  c === cat.press.originals ? c.name : `${c.name} Collection`;

/** The shelves that dress the site in their own colours while the reader is on them (src/theme.ts,
 *  press.css "Shelf themes"), by collection slug. Lérins Schoolhouse, the old American
 *  schoolbooks, wears America's (owner, 2026-11-26), so scrolling from one shelf to the next
 *  never leaves the theme. Lérins Reformation wears the colours of the Reformation Wall and the
 *  Reformed churches its books are drawn from (owner, 2026-11-26). */
export const THEMED: Record<string, string> = {
  "lerins-america": "america", "lerins-schoolhouse": "america", "lerins-reformation": "reformation",
  // the classics theme (owner, 2026-11-26): the great books, and Originals beside them (whose slug
  // is the originals' own)
  "lerins-classics": "classics", "miscellaneous": "classics",
  // three shelves with their author's portrait in the top left (owner, 2026-11-26): Newman under
  // the press's own ring and colours, Chesterton and MacDonald under the classics' (press.css,
  // "The corners"; src/art.ts RINGS)
  "lerins-newman": "newman", "lerins-chesterton": "chesterton", "lerins-macdonald": "macdonald",
};

/** Which of <html>'s two corner slots each theme's picture hangs in, "a" its ::after and "b" its
 *  ::before (press.css, "The corners"); "plain" is no theme's, the Deësis Christ. Neighbours on
 *  the home page's run of shelves (no theme, Newman, no theme, Reformation, America and the
 *  Schoolhouse, Chesterton, MacDonald, the classics) alternate, so one fades out as the next
 *  fades in. A new theme with a corner takes the slot its neighbours leave free. */
export const CORNER_SLOT: Record<string, "a" | "b"> = {
  plain: "a", america: "a", macdonald: "a",
  newman: "b", reformation: "b", chesterton: "b", classics: "b",
};

/** Each corner's picture, by its files' name under static/art/ (-m, and -d from 900px): what
 *  src/theme.ts fetches and decodes before it hangs it, the stylesheet naming the same files. */
export const CORNER_ART: Record<string, string> = {
  plain: "pt-christ", america: "am-sky", macdonald: "pt-macdonald",
  newman: "pt-newman", reformation: "geneva", chesterton: "pt-chesterton", classics: "cl-eyes",
};

/** A page's own theme: a themed shelf's page, or a page of one of its books. The home page has
 *  none of its own: there the shelf in view decides (src/theme.ts). */
export function themeOf(route: Route): string | undefined {
  if (route.kind === "collection") return THEMED[route.collection.slug];
  // a book with no collection stands on Originals
  if (route.kind === "title") return THEMED[route.title.collection?.slug ?? "miscellaneous"];
  return undefined;
}

/** Every shelf of the catalogue, in order: each collection, then Originals last. */
export const shelves = (cat: Catalogue): Collection[] => [...cat.press.collections, cat.press.originals];

/** Whether a title stands on a shelf: Originals holds every title in no collection. */
const belongs = (t: Title, c: Collection, cat: Catalogue) =>
  c === cat.press.originals ? !t.collection : t.collection?.slug === c.slug;

/** Where a title's part stands in its collection (a collection without parts is one run). */
const partRank = (c: Collection, t: Title) => {
  const i = c.parts.findIndex(p => p.slug === t.collection?.part);
  return i < 0 ? c.parts.length : i;
};

/** A shelf's titles: a collection's by part, in the parts' order, then by number (the shelf draws
 *  its parts in that order, so its batches must come in it too: Lérins America's numbers run in
 *  the order made, not in history's, and a batch by number alone drew the Colonies, Nos. 39-41,
 *  above a reader who had already scrolled past where they stand); Originals newest first. */
const inCollection = (c: Collection, cat: Catalogue) => cat.titles.filter(t => belongs(t, c, cat))
  .sort((a, b) => a.collection && b.collection
    ? partRank(c, a) - partRank(c, b) || a.collection.no - b.collection.no
    : b.listed.localeCompare(a.listed));

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
    case "privacy": return "/privacy/";
    case "terms": return "/terms/";
    case "collection": return `/collections/${route.collection.slug.replace(/^lerins-/, "")}/`;
    case "recs": return `/${route.shelf.slug}/`;
    case "rec": return `/${route.shelf.slug}/${route.item.slug}/`;
    case "title": return `/titles/${route.title.slug}/`;
    case "missing": return "/404.html";
  }
}

export function routeOf(path: string, cat: Catalogue): Route {
  const p = path.replace(/index\.html$/, "").replace(/\/?$/, "/");
  if (p === "/") return { kind: "home" };
  if (p === "/about/") return { kind: "about" };
  if (p === "/contact/") return { kind: "contact" };
  if (p === "/privacy/") return { kind: "privacy" };
  if (p === "/terms/") return { kind: "terms" };
  const rm = /^\/([a-z0-9-]+)\/(?:([a-z0-9-]+)\/)?$/.exec(p);
  const shelf = rm ? cat.press.recommended.find(r => r.slug === rm[1]) : undefined;
  if (shelf && !rm![2]) return { kind: "recs", shelf };
  const item = shelf?.items.find(r => r.slug === rm![2]);
  if (shelf && item) return { kind: "rec", shelf, item };
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
    case "privacy":
      return { title: `Privacy policy · ${press.name}`, description: press.privacy[0],
        path: "/privacy/", image: OG_IMAGE };
    case "terms":
      return { title: `Terms of use · ${press.name}`, description: press.terms[0],
        path: "/terms/", image: OG_IMAGE };
    case "collection": {
      const c = route.collection;
      return { title: `${shelfName(c, cat)} · ${press.name}`, description: c.about[0] ?? c.tagline,
        path: pathOf(route), image: OG_IMAGE };
    }
    case "recs": {
      const b = route.shelf;
      return { title: `${b.name} · ${press.name}`, description: `${b.tagline}. ${b.about[0] ?? ""}`.trim(),
        path: pathOf(route), image: OG_IMAGE };
    }
    case "rec": {
      const r = route.item;
      const [w, h] = r.coverSize ?? [1000, 1510];
      return { title: `${r.title} · ${route.shelf.name} · ${press.name}`,
        description: r.lead.join(" ") || route.shelf.tagline, path: pathOf(route),
        image: { src: `/covers/${r.cover}.jpg`, width: 800, height: Math.round(h * 800 / w), alt: `Cover of ${r.title}` } };
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
        workExample: [edition("Paperback", t.amazon), ...(t.hardcover ? [edition("Hardcover", t.hardcover)] : []),
          ...(t.kindle ? [edition("EBook", t.kindle)] : [])],
        sameAs: [t.amazon, ...[t.hardcover, t.kindle].filter((u): u is string => !!u && u !== t.amazon)],
      } : {}),
    }],
  };
}

/** The press's mark: the shield from the owner's logo (content/brand, `make brand`). */
const SHIELD_W = 288;
const SHIELD_H = 469;
const mark = (cls: string) => html`<img class=${cls}
  src="/brand/shield-144.webp" width=${SHIELD_W} height=${SHIELD_H} alt="">`;
/** The home page's large shield, at the width it is drawn (150 to 210 px tall, press.css). */
const heroMark = () => html`<img class="hero-shield" src="/brand/shield-400.webp" fetchpriority="high"
  srcset="/brand/shield-280.webp 172w, /brand/shield-400.webp 246w"
  sizes="(max-width: 625px) 92px, (max-width: 875px) 15vw, 129px"
  width=${SHIELD_W} height=${SHIELD_H} alt="">`;

/** A cover in WebP at three widths (360 for a card on a phone, 480 for a card, 1000 for a
 *  book's page: `make cover`), the browser choosing by `sizes`; the .jpg is the fallback. Below the first row it waits for the
 *  reader to scroll near it (native lazy loading), and its width and height hold its place.
 *  Only the picture that is the page's largest paint asks for high priority (`high`): the
 *  shelf's first row loads at once but waits its turn behind it. */
const cover = (t: Pick<Title, "cover" | "title" | "coverSize">, sizes: string, eager = false, high = eager) => {
  const [w, h] = t.coverSize ?? [1000, 1510];
  return html`<picture class="cover">
  <source type="image/webp" sizes=${sizes}
    srcset="/covers/${t.cover}-360.webp 360w, /covers/${t.cover}-480.webp 480w, /covers/${t.cover}.webp 1000w">
  <img src="/covers/${t.cover}.jpg" width=${w} height=${h} sizes=${sizes}
    style="aspect-ratio: ${w} / ${h}" alt="Cover of ${t.title}"
    loading=${eager ? "eager" : "lazy"} fetchpriority=${high ? "high" : "auto"} decoding="async">
</picture>`;
};

/** A title not out yet: one pill in the charcoal theme's red, and no link. */
const soon = (short = false) => html`<span class=${short ? "soon soon-small" : "soon"}>Coming soon</span>`;

/** A title on sale, on its shelf card: the same pill in the paperback's green, and no link, since
 *  the shelves carry no buy buttons (owner, 2026-11-13). It replaced the card's silence (owner,
 *  2026-11-26). */
const avail = () => html`<span class="soon soon-small avail">Available now</span>`;

/** The paperback's button, the green. */
const paperback = (t: Title) => html`<a class="btn btn-paper" href=${t.amazon} rel="noopener"
  target="_blank"><span>Paperback on Amazon<span class="sr"> of ${t.title}</span></span></a>`;

/** The buy buttons, in the order the press would sell them: green for the paperback, blue for
 *  the hardcover, gold for the Kindle edition. All three stand on the title's own page only, the
 *  featured reads carry the paperback alone, and the shelves none (owner, 2026-11-13). */
const buy = (t: Title) => !t.amazon ? soon() : html`
  ${paperback(t)}
  ${t.hardcover ? html`<a class="btn btn-hard" href=${t.hardcover} rel="noopener" target="_blank"><span>Hardcover
    on Amazon<span class="sr"> of ${t.title}</span></span></a>` : nothing}
  ${t.kindle ? html`<a class="btn btn-kindle" href=${t.kindle} rel="noopener" target="_blank"><span>Kindle on
    Amazon<span class="sr"> edition of ${t.title}</span></span></a>` : nothing}`;

/** A shelf's card. On a shelf's own page the first row loads at once (`eager`), it being the
 *  page's largest paint on a desktop, and a phone's row of two first of all (`high`: on a shelf
 *  of few books, the Originals, a cover is the phone's largest paint too); everywhere else, the home page's shelves included (they
 *  begin below the first screen), a cover waits for the reader to near it. */
const card = (t: Title, eager: boolean, high = false) => html`<li class="card">
  <a class="card-link" href="/titles/${t.slug}/">
    ${cover(t, "(max-width: 600px) 45vw, 230px", eager, high)}
    ${t.collection ? html`<span class="card-no">No. ${t.collection.no}</span>` : nothing}
    <span class="card-title">${t.title}</span>
    ${t.subtitle ? html`<span class="card-sub">${t.subtitle}</span>` : nothing}
    ${t.author ? html`<span class="card-author">${t.author}</span>` : nothing}
  </a>
  <p class="card-buy">${t.amazon ? avail() : soon(true)}</p>
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
  const run = (cards: Placed[]) => html`<ul class="shelf">${cards.map(({ t, i }) => card(t, !named && i < 4, !named && i < 2))}</ul>`;
  return html`<section class="collection" aria-labelledby="c-${c.slug}" data-theme=${THEMED[c.slug] ?? nothing}>
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
function filter(cat: Catalogue, current?: Collection | Recommendations): TemplateResult {
  const all = "/#books";
  const go = (e: Event) => nav.go((e.target as HTMLSelectElement).value);
  return html`<nav class="filter" aria-label="Collections">
    <ul class="chips">
      <li><a href=${all} aria-current=${current ? nothing : "page"}>All</a></li>
      ${shelves(cat).map(c => html`<li><a href=${pathOf({ kind: "collection", collection: c })}
        aria-current=${c === current ? "page" : nothing}>${c.short}</a></li>`)}
      ${cat.press.recommended.map(r => html`<li><a href="/${r.slug}/"
        aria-current=${r === current ? "page" : nothing}>${r.short}</a></li>`)}
    </ul>
    <label class="filter-menu"><span>Show</span>
      <select @change=${go}>
        <option value=${all} ?selected=${!current}>All books</option>
        ${shelves(cat).map(c => html`<option value=${pathOf({ kind: "collection", collection: c })}
          ?selected=${c === current}>${shelfName(c, cat)}</option>`)}
        ${cat.press.recommended.map(r => html`<option value="/${r.slug}/" ?selected=${r === current}>${r.name}</option>`)}
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
          <div class="slide-wash" aria-hidden="true"><img src="/covers/${t.cover}-wash.webp" alt=""
            loading=${i ? "lazy" : "eager"} decoding="async" width="48" height="72"></div>
          <a class="slide-cover" href=${href} tabindex="-1" aria-hidden="true">
            ${cover(t, "(max-width: 720px) 46vw, 300px", i === 0)}</a>
          <div class="slide-text">
            <p class="slide-kicker">${[c ? seriesLine(t, cat) : "", t.amazon ? "Now available" : c ? "" : "Lérins Press"]
              .filter(Boolean).join(" · ")}</p>
            <h3 class="slide-title"><a href=${href}>${t.title}</a></h3>
            ${t.subtitle ? html`<p class="slide-sub">${t.subtitle}</p>` : nothing}
            ${t.author ? html`<p class="slide-author">${t.author}</p>` : nothing}
            ${t.lead[0] ? html`<p class="slide-lead">${t.lead[0]}</p>` : nothing}
            <p class="slide-actions">${t.amazon ? paperback(t) : soon()}<a class="slide-more" href=${href}>About this book</a></p>
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
      ${heroMark()}
      <h1 class="wordmark" tabindex="-1">${press.name}</h1>
      <p class="ornament" aria-hidden="true"><span></span></p>
      <p class="motto-latin" lang="la">${press.motto.latin}</p>
      <p class="motto-english">${press.motto.english}</p>
      <p class="motto-source">${press.motto.source}</p>
    </section>
    ${featured(cat)}
    ${signup()}
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
      <h1 tabindex="-1">${c === cat.press.originals ? html`<span>${c.name}</span>`
        : html`<span>${c.name}</span> <span>Collection</span>`}</h1>
      <p class="collection-tagline">${c.tagline}</p>
      <p class="ornament" aria-hidden="true"><span></span></p>
      ${c.about.map(p => html`<p>${p}</p>`)}
    </header>
    ${collectionShelf(c, cat, placed, false)}
    ${more(shown, order)}`;
}

/** An Amazon page as an affiliate link: the press's Associates tag added to its address (any tag
 *  already on it replaced), the form SiteStripe makes, less its tracking extras. */
export const affiliate = (url: string, tag: string) => {
  const u = new URL(url);
  u.searchParams.set("tag", tag);
  return u.href;
};

/** A paragraph of press.json's with its **marked** words set in bold. */
const strong = (p: string) => p.split("**").map((part, i) => i % 2 ? html`<strong>${part}</strong>` : part);

/** The thanks and the affiliate disclosure, from the heart: a gold heart, the thanks in the
 *  press's script, the words with their heart in bold, and Amazon's required line beneath. On a shelf it stands above the
 *  cards; on a book's page, beside its Amazon buttons (`small`). */
const thanks = (cat: Catalogue, small = false) => html`<aside class=${small ? "rec-thanks rec-thanks-small" : "rec-thanks"}
  aria-label="About these links">
  <p class="rec-heart" aria-hidden="true">♥</p>
  <p class="rec-thanks-head">With our thanks</p>
  ${cat.press.affiliate.thanks.map(p => html`<p>${strong(p)}</p>`)}
</aside>`;

/** A recommended book's Amazon buttons, each its format's, green then blue, marked sponsored (affiliate
 *  links). They stand on the shelf's cards too, as no book's do (owner, 2026-11-28), there
 *  small, a button to a row. */
const recBuy = (r: Recommended, tag: string, small = false) => r.buy.map((b, i) => html`<a
  class=${(i ? "btn btn-hard" : "btn btn-paper") + (small ? " btn-small" : "")} href=${affiliate(b.url, tag)}
  rel="sponsored noopener" target="_blank"><span>${b.format} on Amazon<span class="sr"> (affiliate link):
  ${r.title}</span></span></a>`);

/** A recommended book's card on its shelf: as a book's card is, opening its own page, with its
 *  buttons and, as on its page, the words that they are affiliate links. */
const recCard = (shelf: Recommendations, r: Recommended, tag: string, eager: boolean, high = false) => html`<li
  class="card rec-card">
  <a class="card-link" href="/${shelf.slug}/${r.slug}/">
    ${cover(r, "(max-width: 600px) 45vw, 230px", eager, high)}
    <span class="card-no">${r.publisher}</span>
    <span class="card-title">${r.title}</span>
    ${r.subtitle ? html`<span class="card-sub">${r.subtitle}</span>` : nothing}
  </a>
  <p class="card-buy rec-buy">${recBuy(r, tag, true)}
    <span class="rec-aff" aria-hidden="true">Affiliate link</span></p>
</li>`;

/** A recommendation shelf (Bibles, Catechisms): other publishers' books, the thanks first, then
 *  the cards. */
function recsPage(b: Recommendations, cat: Catalogue): TemplateResult {
  return html`
    ${filter(cat, b)}
    <header class="collection-intro">
      <p class="collection-kicker">Recommended by Lérins Press · ${b.items.length} ${b.items.length === 1 ? "edition" : "editions"}</p>
      <h1 tabindex="-1"><span>${b.name}</span></h1>
      <p class="collection-tagline">${b.tagline}</p>
      <p class="ornament" aria-hidden="true"><span></span></p>
      ${b.about.map(p => html`<p>${p}</p>`)}
    </header>
    ${thanks(cat)}
    <section class="collection" aria-label=${b.name}>
      <ul class="shelf">${b.items.map((r, i) => recCard(b, r, cat.press.affiliate.tag, i < 4, i < 2))}</ul>
    </section>`;
}

/** A recommended book's own page: laid out as a book's, its Amazon links marked sponsored
 *  (affiliate links) and the thanks beside them. */
function recPage(shelf: Recommendations, r: Recommended, cat: Catalogue): TemplateResult {
  return html`
    <nav class="back" aria-label="Back">
      <a href="/#books">Back to All Books</a>
      <a href="/${shelf.slug}/">Back to ${shelf.name}</a>
    </nav>
    <article class="book">
      <div class="book-cover rec-cover">${cover(r, "(max-width: 720px) 70vw, 340px", true)}</div>
      <div class="book-text">
        <p class="book-series"><a href="/${shelf.slug}/">Recommended ${shelf.name}</a><span> · ${r.publisher}</span></p>
        <h1 tabindex="-1">${r.title}</h1>
        ${r.subtitle ? html`<p class="book-sub">${r.subtitle}</p>` : nothing}
        ${r.binding ? html`<p class="book-by">${r.binding}</p>` : nothing}
        ${r.lead.length ? html`<div class="book-lead">${r.lead.map(p => html`<p>${p}</p>`)}</div>` : nothing}
        <p class="actions rec-actions">
          ${recBuy(r, cat.press.affiliate.tag)}
          <span class="rec-aff" aria-hidden="true">${r.buy.length > 1 ? "Affiliate links" : "Affiliate link"}</span>
        </p>
        ${r.description.length ? html`<div class="book-desc">${r.description.map(p => html`<p>${p}</p>`)}</div>` : nothing}
        ${thanks(cat, true)}
      </div>
    </article>`;
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
      <div class="book-cover">${cover(t, "(max-width: 720px) 70vw, 340px", true)}${t.coverCredit ? html`
        <p class="cover-credit">Front after <a href=${t.coverCredit.source} rel="noopener" target="_blank">a photograph</a>
          by ${t.coverCredit.by}, <a href=${t.coverCredit.licenceUrl} rel="license noopener" target="_blank">${
          t.coverCredit.licence}</a>, adapted.</p>` : nothing}</div>
      <div class="book-text">
        ${c ? html`<p class="book-series"><a href=${pathOf({ kind: "collection", collection: c })}>${seriesLine(t, cat)}</a>${
          partName(t, cat) ? html`<span> · ${partName(t, cat)}</span>` : nothing}</p>` : nothing}
        <h1 tabindex="-1">${t.title}</h1>
        ${t.subtitle ? html`<p class="book-sub">${t.subtitle}</p>` : nothing}
        ${t.author ? html`<p class="book-by">${t.author}</p>` : nothing}
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
        ${t.contents?.length ? html`<section class="book-toc" aria-labelledby="toc-head">
          <h2 id="toc-head">Contents</h2>
          ${t.contents.map(g => html`${g.part ? html`<h3>${g.part}</h3>` : nothing}
            <ul>${g.items.map(i => html`<li>${i}</li>`)}</ul>`)}
        </section>` : nothing}
      </div>
    </article>`;
}

function about(cat: Catalogue): TemplateResult {
  const { press } = cat;
  return html`
    <article class="prose">
      <h1 tabindex="-1">About the press</h1>
      ${press.about.map(p => html`<p>${p}</p>`)}
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

/** The mailing list: new books and the press's news by email. On a phone it stands in the home
 *  page between the featured reads and the shelves (`away` pages leave it out); on a desktop it
 *  is a small panel floating at the corner of every page, opened a moment after arrival and
 *  closed with its × until the next page load (src/signup.ts). Both forms post
 *  to merecatholicity.com's contact worker, which keeps an address with the wording it agreed
 *  to, deletes one on request, and answers nothing about the list (src/contact.ts binds them,
 *  each challenge filling its slot on intent as on Contact). The consent line's words are the
 *  worker's CONSENT: change them together, with a migration naming the new wording. */
const signup = (away = false) => html`<section class="signup" aria-labelledby="signup-head"
  data-away=${away ? "" : nothing}>
  <button type="button" class="signup-close" aria-label="Close">×</button>
  <h2 class="rule-head" id="signup-head"><span>New books by email</span></h2>
  <div class="signup-card">
    <form id="press-list" class="signup-form" action="https://contact-api.merecatholicity.com/subscribe" method="POST">
      <p class="signup-lead">Hear when a new book is out.</p>
      <div class="signup-row">
        <label class="sr" for="signup-email">Email address</label>
        <input id="signup-email" type="email" name="email" required maxlength="254" autocomplete="email"
          inputmode="email" placeholder="Your email address">
        <button type="submit" class="btn btn-paper">Subscribe</button>
      </div>
      <label class="signup-consent">
        <input type="checkbox" name="consent" value="yes" required>
        <span>Email me about new books and news from Lérins Press. Unsubscribe anytime.
          <a href="/privacy/">Privacy</a></span>
      </label>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="contact-ts"></div>
      <p class="contact-status" role="status"></p>
    </form>
    <details class="signup-leave">
      <summary>Unsubscribe</summary>
      <form id="press-unlist" class="signup-form" action="https://contact-api.merecatholicity.com/unsubscribe" method="POST">
        <div class="signup-row">
          <label class="sr" for="unlist-email">Email address to remove from the list</label>
          <input id="unlist-email" type="email" name="email" required maxlength="254" autocomplete="email"
            inputmode="email" placeholder="Email address to remove">
          <button type="submit" class="btn btn-quiet">Unsubscribe</button>
        </div>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="contact-ts"></div>
        <p class="contact-status" role="status"></p>
      </form>
    </details>
  </div>
</section>`;

/** The privacy policy and the terms: plain paragraphs from content/press.json. */
const plain = (title: string, paras: string[]) => html`<article class="prose legal">
  <h1 tabindex="-1">${title}</h1>
  ${paras.map(p => html`<p>${p}</p>`)}
</article>`;

/** The whole page: masthead, the route's body, footer. `shown` is how many of the shelf's
 *  cards the page draws: the first batch on the server, more as the reader scrolls. */
export function page(route: Route, cat: Catalogue, shown = SHELF_BATCH): TemplateResult {
  const { press } = cat;
  const body = route.kind === "home" ? home(cat, shown)
    : route.kind === "collection" ? collectionPage(route.collection, cat, shown)
    : route.kind === "recs" ? recsPage(route.shelf, cat)
    : route.kind === "rec" ? recPage(route.shelf, route.item, cat)
    : route.kind === "title" ? titlePage(route.title, cat)
    : route.kind === "about" ? about(cat)
    : route.kind === "contact" ? contact()
    : route.kind === "privacy" ? plain("Privacy policy", press.privacy)
    : route.kind === "terms" ? plain("Terms of use", press.terms)
    : missing();
  const here = (...k: Route["kind"][]) => k.includes(route.kind) ? "page" : nothing;
  // The site's doors, one list: the masthead's menu draws the main ones, and the colophon draws
  // those and the rest (the legal pages and the feeds), so the two never differ where they meet.
  const links = (all = false) => html`
    <a href="/" aria-current=${here("home", "collection", "recs", "rec")}>Books</a>
    <a href="/about/" aria-current=${here("about")}>About</a>
    <a href="/contact/" aria-current=${here("contact")}>Contact</a>
    ${all ? html`
      <a href="/privacy/" aria-current=${here("privacy")}>Privacy</a>
      <a href="/terms/" aria-current=${here("terms")}>Terms</a>
      ${press.social.map(s => html`<a href=${s.url} rel="me noopener">${s.name}</a>`)}
      <a href="/rss.xml">RSS</a>
      <a href="/sitemap.xml">Sitemap</a>` : nothing}
    <a href=${press.parent.url} rel="noopener">${press.parent.url.replace(/^https:\/\//, "")}</a>`;
  return html`
    <a class="skip" href="#main">Skip to content</a>
    <header class="masthead">
      <a class="brand" href="/">
        ${mark("mark")}
        <span class="brand-text">
          <span class="brand-name">${press.name}</span>
          <span class="brand-tag">${press.tagline}</span>
        </span>
      </a>
      <nav class="nav" aria-label="Site">${links()}</nav>
    </header>
    <main id="main">${body}</main>
    ${route.kind === "home" ? nothing : signup(true)}
    <footer class="colophon">
      ${mark("mark")}
      <p class="colophon-name">${press.name}</p>
      <nav class="colophon-links" aria-label="Footer">${links(true)}</nav>
    </footer>`;
}
