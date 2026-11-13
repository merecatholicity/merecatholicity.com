// Build the press into dist/: one prerendered HTML page per route, the client bundle,
// the stylesheet, the covers, each title's link-preview card, the sitemap, the RSS feed and
// robots.txt.
//
//   node scripts/build.ts            (PRESS_URL=... to build for another origin)
//
// Deterministic: nothing here reads the clock. Dates come from content/titles.json, and
// asset names carry content hashes, so a rebuild of the same sources gives the same bytes.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { render } from "@lit-labs/ssr";
import { collectResultSync } from "@lit-labs/ssr/lib/render-result.js";
import type { Catalogue, Press, Route, Title } from "../src/types.ts";
import { cardMaker } from "./cards.ts";
import { headTags, jsonLd, metaOf, page, pathOf, shelves } from "../src/views.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const press = JSON.parse(read("content/press.json")) as Press;
if (process.env.PRESS_URL) press.url = process.env.PRESS_URL.replace(/\/$/, "");
const titles = (JSON.parse(read("content/titles.json")) as Title[])
  .slice().sort((a, b) => b.listed.localeCompare(a.listed));
const cat: Catalogue = { press, titles };

/** A JPEG's width and height, from its first frame header (SOF0 to SOF15, less the markers
 *  that share the range: DHT, JPG and DAC). */
function jpegSize(buf: Buffer): [number, number] {
  for (let i = 2; i + 9 < buf.length; ) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("no JPEG frame header");
}

// Every cover in its three files (make cover), and its size scaled to the 1000-wide WebP the
// page names, so each <img> holds exactly its own place while it waits to load.
for (const t of titles) {
  for (const f of [`${t.cover}.webp`, `${t.cover}-480.webp`, `${t.cover}.jpg`]) {
    try { statSync(join(ROOT, "content/covers", f)); }
    catch { throw new Error(`${t.slug}: missing content/covers/${f} (make cover)`); }
  }
  const [w, h] = jpegSize(readFileSync(join(ROOT, "content/covers", `${t.cover}.jpg`)));
  t.coverSize = [1000, Math.round(h * 1000 / w)];
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, "assets"), { recursive: true });

const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 10);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const abs = (p: string) => new URL(p, press.url + "/").href;

// The client bundle.
const js = await build({
  entryPoints: [join(ROOT, "src/app.ts")], bundle: true, format: "esm", minify: true,
  target: "es2022", write: false, legalComments: "none", logLevel: "warning",
});
const jsText = js.outputFiles[0].text;
const jsName = `assets/app-${hash(jsText)}.js`;
writeFileSync(join(DIST, jsName), jsText);

// The wordmark's face, named by its hash like everything under assets/ (static/_headers
// makes those immutable). The stylesheet names it by a placeholder the build fills.
const FONTS = join(ROOT, "node_modules/@fontsource/cinzel");
const font = readFileSync(join(FONTS, "files/cinzel-latin-500-normal.woff2"));
const fontName = `assets/cinzel-500-${hash(font)}.woff2`;
writeFileSync(join(DIST, fontName), font);
cpSync(join(FONTS, "LICENSE"), join(DIST, "assets/cinzel-OFL.txt"));

const css = read("src/press.css").replaceAll("/assets/fonts/cinzel-latin-500-normal.woff2", `/${fontName}`);
const cssName = `assets/press-${hash(css)}.css`;
writeFileSync(join(DIST, cssName), css);

cpSync(join(ROOT, "content/covers"), join(DIST, "covers"), { recursive: true });
cpSync(join(ROOT, "static"), DIST, { recursive: true });

// Each title's link-preview card (scripts/cards.ts), named by its hash: a crawler caches a
// preview by its URL, so a changed cover or title must arrive under a new one. The name rides
// the catalogue, so the head a hop rewrites names it too.
mkdirSync(join(DIST, "cards"));
// Drawing a card is most of a build's time, so each is kept in .cache/ under a hash of all it is
// drawn from (the cover, the words it sets, cards.ts itself): a rebuild draws only what changed.
const card = cardMaker(ROOT, press);
const CACHE = join(ROOT, ".cache/cards");
mkdirSync(CACHE, { recursive: true });
const cardsSource = readFileSync(join(ROOT, "scripts/cards.ts"));
for (const t of titles) {
  const coverJpg = readFileSync(join(ROOT, "content/covers", `${t.cover}.jpg`));
  const key = hash(Buffer.concat([cardsSource, coverJpg, Buffer.from(JSON.stringify(
    [press.name, t.title, t.subtitle, t.format, t.amazon, t.kindle, t.coverSize]))]));
  const cached = join(CACHE, `${key}.jpg`);
  let jpg: Buffer;
  try { jpg = readFileSync(cached); }
  catch { jpg = await card(t, coverJpg); writeFileSync(cached, jpg); }
  t.card = `/cards/${t.slug}-${hash(jpg)}.jpg`;
  writeFileSync(join(DIST, t.card), jpg);
}

// The catalogue rides every page; "<" is escaped so no title can close the script.
const data = JSON.stringify(cat).replace(/</g, "\\u003c");

function document(route: Route): string {
  const meta = metaOf(route, cat);
  const body = collectResultSync(render(page(route, cat)));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<link rel="canonical" href="${abs(meta.path)}">
<meta name="theme-color" content="#0f1113">
${headTags(meta, cat).map(([a, k, v]) => `<meta ${a}="${k}" content="${esc(v)}">`).join("\n")}
<script type="application/ld+json">${JSON.stringify(jsonLd(route, cat)).replace(/</g, "\\u003c")}</script>
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/${fontName}" as="font" type="font/woff2" crossorigin>
<link rel="alternate" type="application/rss+xml" title="${esc(press.name)}" href="/rss.xml">
<link rel="stylesheet" href="/${cssName}">
<script type="module" src="/${jsName}"></script>
</head>
<body>
<div id="app">${body}</div>
<script type="application/json" id="press-data">${data}</script>
</body>
</html>
`;
}

const routes: Route[] = [{ kind: "home" }, { kind: "about" }, { kind: "contact" },
  ...shelves(cat).map(collection => ({ kind: "collection" as const, collection })),
  ...titles.map(title => ({ kind: "title" as const, title }))];
for (const route of routes) {
  const dir = join(DIST, pathOf(route));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), document(route));
}
writeFileSync(join(DIST, "404.html"), document({ kind: "missing" }));

// The sitemap: every page, with the date its newest title joined.
const newest = titles[0]?.listed ?? "2026-11-11";
const lastmod = (r: Route) => r.kind === "title" ? r.title.listed : newest;
writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map(r => `  <url><loc>${abs(pathOf(r))}</loc><lastmod>${lastmod(r)}</lastmod></url>`).join("\n")}
</urlset>
`);

// The feed: one item per title, newest first.
const rfc822 = (iso: string) => new Date(`${iso}T12:00:00Z`).toUTCString().replace("GMT", "+0000");
const item = (t: Title) => {
  const link = abs(`/titles/${t.slug}/`);
  const jpg = join(ROOT, "content/covers", `${t.cover}.jpg`);
  const full = t.subtitle ? `${t.title}: ${t.subtitle}` : t.title;
  return `  <item>
    <title>${esc(full)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
    <pubDate>${rfc822(t.listed)}</pubDate>
    <dc:creator>${esc(t.author)}</dc:creator>
    <description>${esc(metaOf({ kind: "title", title: t }, cat).description)}</description>
    <enclosure url="${abs(`/covers/${t.cover}.jpg`)}" length="${statSync(jpg).size}" type="image/jpeg"/>
  </item>`;
};
writeFileSync(join(DIST, "rss.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>${esc(press.name)}</title>
  <link>${abs("/")}</link>
  <description>${esc(press.tagline)}</description>
  <language>en</language>
  <lastBuildDate>${rfc822(newest)}</lastBuildDate>
  <atom:link href="${abs("/rss.xml")}" rel="self" type="application/rss+xml"/>
${titles.map(item).join("\n")}
</channel>
</rss>
`);

writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${abs("/sitemap.xml")}\n`);

const count = (d: string): number => readdirSync(d).reduce((n, f) =>
  n + (statSync(join(d, f)).isDirectory() ? count(join(d, f)) : 1), 0);
console.log(`built dist/: ${routes.length} pages, ${titles.length} titles, ${count(DIST)} files (${press.url})`);
