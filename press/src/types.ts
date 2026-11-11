// The catalogue's data, as content/press.json and content/titles.json hold it.
// The build embeds both in every page, so the browser never fetches them.

export interface Press {
  name: string;
  tagline: string;
  url: string;
  parent: { name: string; url: string };
  motto: { latin: string; english: string; source: string };
  about: string[];
}

export interface Title {
  slug: string;
  title: string;
  subtitle?: string;
  author: string;
  format: string;
  /** ISO date the title joined the catalogue: the RSS item's date and the sitemap's lastmod. */
  listed: string;
  amazon: string;
  /** A free reading copy, where one exists (the site keeps many). */
  readFree?: string;
  /** Basename under covers/: an .avif for the page and a .jpg for feeds and link previews. */
  cover: string;
  /** The short blurb: the card and the head of the title's page. */
  lead: string[];
  description: string[];
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
