// The catalogue's data, as content/press.json and content/titles.json hold it.
// The build embeds both in every page, so the browser never fetches them.

export interface Press {
  name: string;
  tagline: string;
  url: string;
  parent: { name: string; url: string };
  motto: { latin: string; english: string; source: string };
  about: string[];
  /** The press's own accounts (none yet): the footer's links and the JSON-LD sameAs. */
  social: { name: string; url: string }[];
}

export interface Title {
  slug: string;
  title: string;
  subtitle?: string;
  author: string;
  format: string;
  /** ISO date the title joined the catalogue: the RSS item's date and the sitemap's lastmod. */
  listed: string;
  /** The paperback's Amazon page. */
  amazon: string;
  /** The Kindle edition's Amazon page, where there is one. */
  kindle?: string;
  /** Basename under covers/: an .avif for the page and a .jpg for feeds and link previews. */
  cover: string;
  /** The short blurb: the card and the head of the title's page. */
  lead: string[];
  description: string[];
  /** The link-preview card's path (1200x630, scripts/cards.ts). The build fills it: never
   *  written in titles.json. */
  card?: string;
}

export interface Catalogue {
  press: Press;
  titles: Title[];
}

export type Route =
  | { kind: "home" }
  | { kind: "about" }
  | { kind: "title"; title: Title }
  | { kind: "missing" };
