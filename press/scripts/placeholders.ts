// A placeholder front for every collection whose books have no cover yet: the press's cream and
// gold frame, the collection's name in its own accent, the shield, "Cover coming soon", and
// LÉRINS PRESS at the foot. The divider (a crimson rule with a diamond) is used exactly twice,
// as on the press's drawn fronts: above the collection's name and above the press's.
//
//   node scripts/placeholders.ts      (make placeholders: then the WebP and JPEG are cut)
//
// Writes content/covers/soon-<collection>.png, 1000x1510 (a 6x9 front with bleed), which
// `make placeholders` turns into the cover's three files and removes.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Press } from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1000, H = 1510;
const PAPER = "#f9f3e6", GOLD = "#8a6d3b", INK = "#1a1a1a", SOFT = "#5a5248", CRIMSON = "#8b1a1a";

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, string | number>, ...children: (Node | string)[]): Node =>
  ({ type, props: { style, children } });

const font = (pkg: string, file: string) => readFileSync(join(ROOT, "node_modules/@fontsource", pkg, "files", file));
const fonts = [
  { name: "Cinzel", data: font("cinzel", "cinzel-latin-500-normal.woff"), weight: 500 as const, style: "normal" as const },
  { name: "Gelasio", data: font("gelasio", "gelasio-latin-400-italic.woff"), weight: 400 as const, style: "italic" as const },
];
const shield = `data:image/png;base64,${readFileSync(join(ROOT, "content/brand/shield.png")).toString("base64")}`;

const divider = () => el("div", { display: "flex", alignItems: "center", width: 360, margin: "0 0 34px" },
  el("div", { flex: 1, height: 2, background: CRIMSON }),
  el("div", { width: 14, height: 14, background: CRIMSON, transform: "rotate(45deg)", margin: "0 16px" }),
  el("div", { flex: 1, height: 2, background: CRIMSON }));

const press = JSON.parse(readFileSync(join(ROOT, "content/press.json"), "utf8")) as Press;
const titles = JSON.parse(readFileSync(join(ROOT, "content/titles.json"), "utf8")) as { cover: string }[];
const wanted = new Set(titles.map(t => t.cover).filter(c => c.startsWith("soon-")));

for (const c of press.collections) {
  const name = `soon-${c.slug}`;
  if (!wanted.has(name)) continue;
  // The two gold rules are boxes pinned by their edges: flex sizing lets a border run off the page.
  const inset = (n: number, rest: Record<string, string | number>, ...children: (Node | string)[]) =>
    el("div", { position: "absolute", top: n, left: n, right: n, bottom: n, display: "flex", ...rest }, ...children);
  const front = el("div", { width: W, height: H, display: "flex", position: "relative", background: PAPER },
    inset(34, { border: `5px solid ${GOLD}` }),
    inset(52, { border: `1.5px solid ${GOLD}`, flexDirection: "column", alignItems: "center",
        padding: "110px 70px 70px" },
        divider(),
        el("div", { fontFamily: "Cinzel", fontSize: 62, letterSpacing: 6, color: c.accent, textAlign: "center",
          lineHeight: 1.15 }, c.name.toUpperCase()),
        el("div", { fontFamily: "Gelasio", fontStyle: "italic", fontSize: 32, color: SOFT, textAlign: "center",
          lineHeight: 1.35, marginTop: 22, maxWidth: 680 }, c.tagline),
        el("div", { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
          { type: "img", props: { src: shield, height: 380, width: Math.round(380 * 288 / 469),
            style: { opacity: 0.9 } } }),
        el("div", { fontFamily: "Gelasio", fontStyle: "italic", fontSize: 44, color: INK, marginBottom: 90 },
          "Cover coming soon"),
        divider(),
        el("div", { fontFamily: "Cinzel", fontSize: 40, letterSpacing: 8, color: INK }, "LÉRINS PRESS")));
  const svg = await satori(front as never, { width: W, height: H, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: false } }).render().asPng();
  writeFileSync(join(ROOT, "content/covers", `${name}.png`), png);
  console.log(`drew ${name}.png`);
}
