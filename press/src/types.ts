// The catalogue's data, as content/press.json and content/titles.json hold it.
// The build embeds both in every page, so the browser never fetches them.

export interface Press {
  name: string;
  tagline: string;
  url: string;
  parent: { name: string; url: string };
  motto: { latin: string; english: string; source: string };
  about: string[];
  /** The privacy policy's and the terms' paragraphs (/privacy/, /terms/). */
  privacy: string[];
  terms: string[];
  /** The press's own accounts (none yet): the footer's links and the JSON-LD sameAs. */
  social: { name: string; url: string }[];
  /** The titles the home page's carousel shows, in order, by slug. */
  featured: string[];
  /** Originals, the last shelf: every title in no collection (the press's own books).
   *  Shaped as a collection so the filter and its page treat it as one, but it has no numbers
   *  and no series line. */
  originals: Collection;
  /** The press's collections, in shelf order: a title joins one by its slug. */
  collections: Collection[];
}

/** A named group of books inside the press (Lérins Newman), its parts in order. Defined once
 *  on the publishing side (its collection.yml) and copied here. */
export interface Collection {
  slug: string;
  name: string;
  /** The filter's label: the name less "Lérins". */
  short: string;
  tagline: string;
  /** Its colour on the publishing side: the placeholder cover's frame (make placeholders). */
  accent: string;
  about: string[];
  /** Its parts in order. A collection without parts is one run. */
  parts: { slug: string; name: string }[];
}

export interface Title {
  slug: string;
  title: string;
  subtitle?: string;
  /** Empty for a work with no one author (the Didache, a confession). */
  author: string;
  format: string;
  /** ISO date the title joined the catalogue: the RSS item's date and the sitemap's lastmod. */
  listed: string;
  /** ISO date it went on sale, set with `amazon`: the RSS item's date. The feed carries only the
   *  titles on sale, so a subscriber hears of a book the week it can be bought, not when it is
   *  announced as coming soon. */
  released?: string;
  /** The paperback's Amazon page. A title without one is not out yet: it shows "Coming soon". */
  amazon?: string;
  /** The hardcover's Amazon page, where there is one. */
  hardcover?: string;
  /** The Kindle edition's Amazon page, where there is one. */
  kindle?: string;
  /** Basename under covers/: an .avif for the page and a .jpg for feeds and link previews. */
  cover: string;
  /** Who the front's picture is after, when its licence asks for credit (CC BY): shown under the
   *  cover on the title's own page. `source` is the picture's page, `licenceUrl` its licence. */
  coverCredit?: { by: string; source: string; licence: string; licenceUrl: string };
  /** The short blurb: the card and the head of the title's page. Empty until it is written: the
   *  page then shows the collection's own words. */
  lead: string[];
  description: string[];
  /** The table of contents, shown under the description: groups in the book's order, each with
   *  its part's heading where the book has one. No page numbers. */
  contents?: { part?: string; items: string[] }[];
  /** Its place in a collection: the collection's slug, its number there, and its part. */
  collection?: { slug: string; no: number; part: string };
  /** The link-preview card's path (1200x630, scripts/cards.ts). The build fills it: never
   *  written in titles.json. */
  card?: string;
  /** The cover's size in pixels at 1000 wide, read from its .jpg by the build: never written in
   *  titles.json. Every cover is a 6x9 front, but their bleeds differ by a few pixels. */
  coverSize?: [number, number];
}

export interface Catalogue {
  press: Press;
  titles: Title[];
}

export type Route =
  | { kind: "home" }
  | { kind: "about" }
  | { kind: "contact" }
  | { kind: "privacy" }
  | { kind: "terms" }
  | { kind: "collection"; collection: Collection }
  | { kind: "title"; title: Title }
  | { kind: "missing" };

