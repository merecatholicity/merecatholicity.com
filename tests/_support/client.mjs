/* The browser client's sources, for the source-rule tests (Wave F, 2026-09-11).
   client/comments.ts is the root (the boot, the router, the kit, the core
   helpers) and client/{composer,profile,board,wall,surface,dm,merecat,admin}.ts are the
   feature modules installed per boot. A rule that used to grep one file greps
   the concatenation now — every module body is per-boot code exactly as the
   boot's own was, so the same rules apply to every file. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLIENT_MODULES = ['composer', 'profile', 'board', 'wall', 'surface', 'dm', 'merecat', 'admin'];
export const CLIENT_FILES = ['client/comments.ts', ...CLIENT_MODULES.map((m) => `client/${m}.ts`)];

export const clientRoot = () => readFileSync(join(root, 'client', 'comments.ts'), 'utf8');
export const clientModule = (name) => readFileSync(join(root, 'client', name + '.ts'), 'utf8');
/* every client source, in file order, each preceded by a marker line */
export const clientAll = () => CLIENT_FILES.map((f) => `\n/* ==== ${f} ==== */\n` + readFileSync(join(root, f), 'utf8')).join('\n');
