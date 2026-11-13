// Serve dist/ the way a static host would, on 127.0.0.1 only, and rebuild on a save.
//
//   node scripts/serve.ts        (PORT=8090 by default)
//
// A path without a file serves its index.html, a page path without its trailing slash
// redirects to it, and anything else gets 404.html with a 404. A save under src/,
// content/ or static/ reruns the build; reload the page to see it.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 8090);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".avif": "image/avif", ".jpg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".ico": "image/x-icon",
};

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, path);
  let status = 200;
  if (!isFile(file)) {
    if (isFile(join(file, "index.html"))) {
      if (!path.endsWith("/")) {
        res.writeHead(301, { Location: path + "/" + url.search }).end();
        return;
      }
      file = join(file, "index.html");
    } else {
      file = join(DIST, "404.html");
      status = 404;
    }
  }
  // A request that lands while a rebuild has emptied dist/ gets a 503, not a dead server.
  const stream = createReadStream(file);
  stream
    .on("open", () => {
      res.writeHead(status, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      stream.pipe(res);
    })
    .on("error", () => { if (!res.headersSent) res.writeHead(503).end("rebuilding, reload"); else res.end(); });
}).listen(PORT, "127.0.0.1", () => console.log(`Lérins Press at http://127.0.0.1:${PORT}/`));

let timer: NodeJS.Timeout | undefined;
let running = false;
const rebuild = () => {
  if (running) { timer = setTimeout(rebuild, 200); return; }
  running = true;
  spawn(process.execPath, [join(ROOT, "scripts/build.ts")], { stdio: "inherit" })
    .on("exit", () => { running = false; });
};
for (const dir of ["src", "content", "static"]) {
  watch(join(ROOT, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
}
