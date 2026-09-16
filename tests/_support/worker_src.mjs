/* The worker's sources, for the source-rule tests (2026-09-16). Mirrors
   tests/_support/client.mjs: a rule that used to read index.ts alone reads the
   concatenation of the route files and index.ts now, each preceded by a marker
   line, so a handler keeps its lock wherever it lives. Reading source is for
   LAWS that are genuinely textual (the privacy sweep, the Turnstile sweep, the
   one-fragment rule); behaviour is proven by running the handler through
   tests/_support/worker.mjs. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'comments-worker', 'src');
const marked = (rel) => `\n/* ==== comments-worker/src/${rel} ==== */\n` + readFileSync(join(src, rel), 'utf8');

/* comments-worker/src/routes/*.ts (sorted), then index.ts last — the handlers and the table */
export function routeFiles() {
  const dir = join(src, 'routes');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ts')).sort().map((f) => 'routes/' + f) : [];
}
export const routesSource = () => [...routeFiles(), 'index.ts'].map(marked).join('\n');
export const libSource = () => readFileSync(join(src, 'lib.ts'), 'utf8');
export const hubSource = () => readFileSync(join(src, 'durable.ts'), 'utf8');
/* routes + index + lib: every handler and every helper */
export const workerSource = () => routesSource() + marked('lib.ts');

/* The body of one top-level function, from its declaration line to the next
   top-level declaration, an export list, or the next file's marker — so a
   handler that ends a file never bleeds into the next file's header. */
export function handlerBody(name, text = routesSource()) {
  const decl = new RegExp('\\n(?:export )?(?:async )?function ' + name.replace(/\$/g, '\\$') + '\\(').exec(text);
  if (!decl) throw new Error(name + ' not found in the worker sources');
  const start = decl.index + 1;
  const rest = text.slice(start + decl[0].length);
  const end = /\n(?:export )?(?:async )?function |\nexport \{|\n\/\* ==== /.exec(rest);
  return end ? text.slice(start, start + decl[0].length + end.index) : text.slice(start);
}
