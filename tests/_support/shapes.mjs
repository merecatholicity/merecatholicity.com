/* The shape of every answer, as the leak sweep saw it (2026-09-17).

   The /api/comments/recent disclosure changed the SHAPE of its answer —
   `items` went from a list of rows to one object with thirty new keys — and
   nothing looked. This reads the sweep's answers into a committed snapshot
   (tests/_support/response_shapes.json, written by
   `node scripts/response_shapes.mjs --write`): for every route, every key
   path with the JSON types it took, the top-level fields that were a list in
   every successful answer (held to Domain.Wire.listFields), and the text
   types of the answers that were not JSON. tests/worker/response_shapes.test
   holds the worker to it, and webtest/test_public_shapes.py holds production
   to its public half every night.

   A path is dotted; `[]` steps into a list; `*` stands for a key that is data
   rather than schema (a hash, a number, an emoji code, a category). */
export const DYNAMIC = {
  'GET /api/comments/board': ['cats'],
  'GET /api/comments/config': ['emoji.custom', 'emoji.named'],
  'POST /api/comments/admin/settings': ['settings'],
  'POST /api/comments/board/unread': ['byCat'],
  'POST /api/comments/dm/presence': ['seen'],
  'POST /api/comments/meta': ['identities'],
  'POST /api/comments/rdns': ['rdns'],
  'POST /api/comments/reacts': ['mine'],
};
const DATA_KEY = /^([0-9a-f]{64}|\d+)$/;
const DEPTH = 8;

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/* every key path under a JSON value, with the types it took */
export function pathsOf(json, route, into = new Map()) {
  const dyn = new Set(DYNAMIC[route] || []);
  const add = (path, v) => {
    if (!path) return;
    if (!into.has(path)) into.set(path, new Set());
    into.get(path).add(typeOf(v));
  };
  const walk = (v, path, bare, depth) => {
    if (depth > DEPTH) return;
    if (Array.isArray(v)) {
      for (const x of v) { add(path + '[]', x); walk(x, path + '[]', bare + '[]', depth + 1); }
      return;
    }
    if (!v || typeof v !== 'object') return;
    const dataKeys = dyn.has(bare);
    for (const [k, x] of Object.entries(v)) {
      const name = dataKeys || DATA_KEY.test(k) ? '*' : k;
      const p = path ? path + '.' + name : name;
      const b = bare ? bare + '.' + k : k;
      add(p, x);
      walk(x, p, dataKeys ? bare + '.*' : b, depth + 1);
    }
  };
  walk(json, '', '', 0);
  return into;
}

/* the snapshot of one sweep: { 'M /path': { json: [...], lists: [...], text: [...] } } */
export function shapeSnapshot(calls) {
  const routes = new Map();
  const entry = (key) => {
    if (!routes.has(key)) routes.set(key, { paths: new Map(), lists: null, text: new Set() });
    return routes.get(key);
  };
  for (const c of calls) {
    if (c.road !== 'table' && !c.road.startsWith('mode ')) continue;
    if (!c.status || c.status === 101) continue;
    const e = entry(c.m + ' ' + c.p);
    if (c.json && typeof c.json === 'object' && !Array.isArray(c.json)) {
      pathsOf(c.json, c.m + ' ' + c.p, e.paths);
      if (c.json.ok !== false && c.status >= 200 && c.status < 300) {
        const arr = Object.keys(c.json).filter((k) => Array.isArray(c.json[k]));
        e.lists = e.lists === null ? new Set(arr) : new Set([...e.lists].filter((k) => arr.includes(k)));
      }
    } else if (c.text !== undefined) {
      e.text.add(c.contentType || 'text');
    }
  }
  const out = {};
  for (const key of [...routes.keys()].sort()) {
    const e = routes.get(key);
    out[key] = {
      json: [...e.paths.entries()].map(([p, t]) => p + ':' + [...t].sort().join('|')).sort(),
      lists: [...(e.lists || [])].sort(),
      text: [...e.text].sort(),
    };
  }
  return out;
}

/* what differs between two snapshots, as sentences */
export function shapeDiff(want, got) {
  const out = [];
  for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const w = want[key];
    const g = got[key];
    if (!w) { out.push(`${key}: a route the snapshot does not know`); continue; }
    if (!g) { out.push(`${key}: in the snapshot, never answered`); continue; }
    for (const field of ['json', 'lists', 'text']) {
      const ws = new Set(w[field]);
      const gs = new Set(g[field]);
      const added = [...gs].filter((x) => !ws.has(x));
      const gone = [...ws].filter((x) => !gs.has(x));
      if (added.length) out.push(`${key} ${field}: new ${added.join(', ')}`);
      if (gone.length) out.push(`${key} ${field}: gone ${gone.join(', ')}`);
    }
  }
  return out;
}
