/* db.ts — the comments worker's repository layer.
 *
 * Single-sources the bind bookkeeping and identity mappers that were spread
 * across index.ts: the placeholder-list loops that were hand-rolled as
 * `chunk.map((_, j) => '?' + (j + 1)).join(',')` at 15 sites (now `inList`), a
 * small `?`-renumbering Query builder for new code, and the identity mappers
 * (rankFor/withNames/postCountsFor), moved verbatim.
 *
 * SAFETY: `inList` is unit-tested (tests/worker/db.test.mjs) to emit the EXACT
 * `?N,…` strings the hand-rolled loops did, and the mappers are moved verbatim,
 * so nothing here changes query behavior — it removes duplication and gives the
 * repository layer a home. (SQL fragment consolidation — the profile join, the
 * DM visibility clauses — is a later, separately-verified slice.) */

import * as Rank from '../../purescript/output/Domain.Rank/index.js';
import * as Pseudonym from '../../purescript/output/Domain.Pseudonym/index.js';

/* ---- Bind-placeholder helpers (retire the hand-rolled `?N` loops) ---- */

/** `'?start,?start+1,…'` for an IN-list of `n` items whose first bind is `?start`
 *  (default 1). Exactly what `chunk.map((_, j) => '?' + (j + 1)).join(',')` and
 *  its `+ offset` variants produced. `n <= 0` → `''`. */
export function inList(n: number, start = 1): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push('?' + (start + i));
  return out.join(',');
}

/** A tiny accumulating query builder for NEW code: append fragments (each may
 *  carry its own `?` placeholders) with their binds, and `.build()` renumbers
 *  every `?` to a sequential `?N` and returns `{ sql, binds }`. This lets a
 *  caller compose a query without tracking bind indices by hand. Fragments that
 *  already use explicit `?N` should NOT be mixed in (this numbers bare `?`). */
export class Query {
  private frags: string[] = [];
  private args: unknown[] = [];
  add(fragment: string, ...binds: unknown[]): this {
    this.frags.push(fragment);
    for (const b of binds) this.args.push(b);
    return this;
  }
  build(): { sql: string; binds: unknown[] } {
    let n = 0;
    const sql = this.frags.join(' ').replace(/\?/g, () => '?' + (++n));
    return { sql, binds: this.args.slice() };
  }
}

/* ---- Identity mappers (moved verbatim from index.ts) ---- */

/** Rank ladder label for a post count (Domain.Rank). */
export function rankFor(n: any): string {
  return Rank.rankLabel(Rank.rankFor((Number(n) || 0) | 0));
}

/** Attach server-resolved identity to an author-bearing row: `assigned` is the
 *  pseudonym the client would otherwise derive itself (displayName), and `rank`
 *  the ladder label — supplied whenever the post count is known. Additive: the
 *  existing `nick`/`posts` fields are unchanged. */
export function withNames(row: any, posts?: any): any {
  const out = Object.assign({}, row);
  out.assigned = row.author_hash ? Pseudonym.displayName(row.author_hash) : null;
  if (posts != null) { out.posts = posts; out.rank = rankFor(posts); }
  return out;
}

/** Total live-forum post count per author hash (topics always; replies only
 *  under a live topic; back room excluded), keyed by hash. Moved verbatim. */
export async function postCountsFor(env: any, hashes: any): Promise<any> {
  const uniq = [...new Set((hashes || []).filter((h: any) => /^[0-9a-f]{64}$/.test(h)))];
  const out: any = {};
  if (!uniq.length) return out;
  const ph = inList(uniq.length);
  const rows = await env.DB.prepare(
    'SELECT c.author_hash AS h, COUNT(*) AS n FROM comments c ' +
    'LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) ' +
    'WHERE c.author_hash IN (' + ph + ") AND c.page LIKE 'board:%' AND c.page != 'board:adminsonly' AND c.status = 'live' " +
    "AND (c.parent_id IS NULL OR t.status = 'live') GROUP BY c.author_hash"
  ).bind(...uniq).all();
  uniq.forEach((h: any) => { out[h] = 0; });
  (rows.results || []).forEach((r: any) => { out[r.h] = r.n; });
  return out;
}
