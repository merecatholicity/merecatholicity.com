// A link-preview card per title, 1200x630: the cover on the press's dark ground, beside the
// press's name in Cinzel, the title, the subtitle and the editions. The build makes one for
// every entry in content/titles.json, so a new book needs nothing beyond its entry and its cover.
//
// A cover alone is a poor preview: it is portrait, and X, Facebook, iMessage and Discord crop
// a large card to about 1.91:1, which leaves a strip across its middle.
//
// satori lays the card out (text set from the font files given, never the system's) and resvg
// paints it; jpeg-js encodes it, since a PNG of a cover runs past what WhatsApp will show.
// Nothing reads the clock or the machine's fonts, so the same sources give the same bytes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import type { Press, Title } from "../src/types.ts";

export const CARD_W = 1200;
export const CARD_H = 630;

type Node = { type: string; props: { style?: Record<string, string | number>; src?: string;
  width?: number; height?: number; children?: (Node | string)[] | Node | string } };
const el = (type: string, style: Record<string, string | number>, ...children: (Node | string)[]): Node =>
  ({ type, props: { style, children } });

/** The palette and faces of press.css: the gold, the ink, Cinzel for the name. Gelasio stands
 *  in for Georgia, the page's serif, with the same metrics. */
const GOLD = "#cba36a";
const INK = "#e6e8ea";
const SOFT = "#c6cace";

export function cardMaker(root: string, press: Press) {
  const font = (pkg: string, file: string) =>
    readFileSync(join(root, "node_modules/@fontsource", pkg, "files", file));
  const fonts = [
    { name: "Cinzel", data: font("cinzel", "cinzel-latin-500-normal.woff"), weight: 500 as const, style: "normal" as const },
    { name: "Gelasio", data: font("gelasio", "gelasio-latin-400-normal.woff"), weight: 400 as const, style: "normal" as const },
    { name: "Gelasio", data: font("gelasio", "gelasio-latin-400-italic.woff"), weight: 400 as const, style: "italic" as const },
    { name: "Gelasio", data: font("gelasio", "gelasio-latin-600-normal.woff"), weight: 600 as const, style: "normal" as const },
  ];

  return async (t: Title, coverJpg: Buffer): Promise<Buffer> => {
    // The cover's height fills the card less its margins; its width keeps the cover's ratio.
    const [w, h] = t.coverSize ?? [1000, 1510];
    const ch = 530, cw = Math.round(ch * w / h);
    const titleSize = t.title.length > 40 ? 50 : t.title.length > 22 ? 58 : 68;
    const subSize = (t.subtitle?.length ?? 0) > 70 ? 26 : 30;
    const cover: Node = { type: "img", props: {
      src: `data:image/jpeg;base64,${coverJpg.toString("base64")}`, width: cw, height: ch,
      style: { borderRadius: 4, boxShadow: "0 18px 40px rgba(0,0,0,0.65)" } } };
    const rule = el("div", { display: "flex", alignItems: "center", width: 220, margin: "26px 0 22px" },
      el("div", { flex: 1, height: 1, background: GOLD, opacity: 0.7 }),
      el("div", { width: 6, height: 6, borderRadius: 3, background: GOLD, margin: "0 12px" }),
      el("div", { flex: 1, height: 1, background: GOLD, opacity: 0.7 }));
    // The text takes what the cover and the margins leave, and wraps inside it.
    const text = el("div", { display: "flex", flexDirection: "column", width: CARD_W - 64 - 72 - cw - 64,
      marginLeft: 64 },
      el("div", { fontFamily: "Cinzel", fontSize: 26, letterSpacing: 4, color: GOLD, marginBottom: 26 },
        press.name.toUpperCase()),
      el("div", { fontFamily: "Gelasio", fontWeight: 600, fontSize: titleSize, lineHeight: 1.08, color: INK },
        t.title),
      ...(t.subtitle ? [el("div", { fontFamily: "Gelasio", fontStyle: "italic", fontSize: subSize,
        lineHeight: 1.3, color: SOFT, marginTop: 18 }, t.subtitle)] : []),
      rule,
      el("div", { fontFamily: "Gelasio", fontSize: 26, color: SOFT },
        !t.amazon ? "Paperback and Kindle · Coming soon" : `${t.format}${t.kindle ? " and Kindle" : ""}`));
    const card = el("div", { width: CARD_W, height: CARD_H, display: "flex", alignItems: "center",
      padding: "0 72px 0 64px",
      backgroundColor: "#0f1113",
      backgroundImage: "radial-gradient(circle at 30% 45%, #262b32 0%, #191c20 45%, #0f1113 100%)" },
      cover, text);

    const svg = await satori(card, { width: CARD_W, height: CARD_H, fonts });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_W }, font: { loadSystemFonts: false } }).render();
    return Buffer.from(jpeg.encode({ data: png.pixels, width: png.width, height: png.height }, 88).data);
  };
}
