// The catalogue's data, as content/press.json and content/titles.json hold it.
// The build embeds both in every page, so the browser never fetches them.

export interface Press {
  name: string;
  tagline: string;
  url: string;
  parent: { name: string; url: string };
  motto: { latin: string; english: string; source: string };
  about: string[];
  /** The About page after the motto: the rule applied to the press's work, and where to read
   *  the case at length. The rule itself is stated once, in the motto, and never again. */
  hope: { heading: string; paragraphs: string[]; further: { label: string; url: string; note: string }[] };
  /** The press's own accounts (none yet): the footer's links and the JSON-LD sameAs. */
  social: { name: string; url: string }[];
  /** The titles the home page's carousel shows, in order, by slug. */
  featured: string[];
  /** Miscellaneous, the last shelf: every title in no collection (the press's own books).
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
  /** The paperback's Amazon page. A title without one is not out yet: it shows "Coming soon". */
  amazon?: string;
  /** The hardcover's Amazon page, where there is one. */
  hardcover?: string;
  /** The Kindle edition's Amazon page, where there is one. */
  kindle?: string;
  /** Basename under covers/: an .avif for the page and a .jpg for feeds and link previews. */
  cover: string;
  /** The short blurb: the card and the head of the title's page. Empty until it is written: the
   *  page then shows the collection's own words. */
  lead: string[];
  description: string[];
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
  | { kind: "collection"; collection: Collection }
  | { kind: "title"; title: Title }
  | { kind: "missing" };

/** "Paperback, Hardcover and Kindle": the editions out, as the head of a title's page says them. */
export const editions = (t: Title) => {
  const all = [t.format, ...(t.hardcover ? ["Hardcover"] : []), ...(t.kindle ? ["Kindle"] : [])];
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}` : all[0];
};
