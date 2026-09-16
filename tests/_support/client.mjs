/* The browser client's sources, for the source-rule tests (Wave F, 2026-09-11).
   client/comments.ts is the root (the boot, the router, the kit, the core
   helpers) and client/<feature>.ts are the feature modules installed per boot (the DM
   family is six factories since 2026-09-16; admin, merecat and dm-thread are LAZY chunks
   since the same day, admin-core the eager remainder). A rule that used to grep one file greps
   the concatenation now — every module body is per-boot code exactly as the
   boot's own was, so the same rules apply to every file. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* the EAGER modules, in the root's install order */
export const CLIENT_MODULES = ['composer', 'profile', 'board', 'wall', 'surface', 'dm-crypto', 'dm-message', 'dm-pickers', 'dm-inbox', 'dm-styles', 'admin-core'];
/* the LAZY modules (P2-5, 2026-09-16): their own chunks, fetched by import() the first time a
   route needs them and installed by B.ensure(name); nothing eager may bind a name they export */
export const LAZY_MODULES = ['admin', 'merecat', 'dm-thread'];
export const ALL_MODULES = [...CLIENT_MODULES, ...LAZY_MODULES];
export const CLIENT_FILES = ['client/comments.ts', ...ALL_MODULES.map((m) => `client/${m}.ts`)];

export const clientRoot = () => readFileSync(join(root, 'client', 'comments.ts'), 'utf8');
export const clientModule = (name) => readFileSync(join(root, 'client', name + '.ts'), 'utf8');
/* the six DM factories as one text (the file they were, 2026-09-16), for the rules that span them */
export const DM_MODULES = ['dm-crypto', 'dm-message', 'dm-pickers', 'dm-inbox', 'dm-thread', 'dm-styles'];
export const clientDm = () => DM_MODULES.map((m) => `\n/* ==== client/${m}.ts ==== */\n` + clientModule(m)).join('\n');
/* every client source, in file order, each preceded by a marker line */
export const clientAll = () => CLIENT_FILES.map((f) => `\n/* ==== ${f} ==== */\n` + readFileSync(join(root, f), 'utf8')).join('\n');
