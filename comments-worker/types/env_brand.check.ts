/* comments-worker/types/env_brand.check.ts — the env's brand, proven at compile
   time (2026-09-17). Never imported or bundled: `make jscheck` type-checks it
   (comments-worker/tsconfig.json includes types/), and every line marked
   @ts-expect-error MUST be an error — if the brand ever stopped refusing, the
   directive would be unused and tsc would fail. The first line is the bug that
   served the whole env from GET /api/comments/recent for six weeks. */
import { json, publishUser } from '../src/lib.ts';
import { withNames } from '../src/db.ts';
import type { Env } from '../src/env.ts';

declare const env: Env;
declare const rows: Array<{ author_hash: string }>;

// @ts-expect-error — the env is never a row
withNames(env, 1);
// @ts-expect-error — nor a copy of it
withNames({ ...env }, 1);
// @ts-expect-error — the env is never an answer
json(env);
// @ts-expect-error — nor a copy of it
json({ ...env });
// @ts-expect-error — nor one field of an answer that copies it
json({ ok: true, items: withNames({ ...env }) });
// @ts-expect-error — the env is never a live event
void publishUser(env, [{ v: 1, t: 'x', scopes: [], ...env }]);

/* and what the worker does every day still compiles */
json({ ok: true, items: rows.map((r) => withNames(r, 0)) });
json({ ok: false, error: 'No.' }, 403);
void publishUser(env, [{ v: 1, t: 'notification', scopes: ['user:x'], kind: 'dm' }]);
