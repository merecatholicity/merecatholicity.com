/* The key floor reaches EVERY write, not just the shared preambles (the P0's
 * layer two, 2026-09-18). The floor lives in lib.ts `keyFloor` and is called
 * from `gated`/`keyed`/`adminGated` — but sixteen write roads roll their own
 * preamble (posting a comment, a feed post, a profile edit, the three uploads,
 * and more) and never touch those functions, so a floor wired only into the
 * shared ones would leave the site's MAIN writes open. This file is the reach
 * proof, in two parts, because a floor with a hole is not a floor (the lesson
 * of the DM-only Turnstile test, 2026-09-16 — a law named at one call site is
 * a list, not a law).
 *
 *  1. Behaviour: a weak identity is driven down a representative write from
 *     every route file and must be refused with `weak_key`.
 *  2. Completeness (textual): every handler that rate-limits on POST_LIMIT must
 *     also call keyFloor, so a NEW write road cannot be added without it and
 *     go quietly unprotected. This is a source law, locked as text on purpose. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, freshDb, weakIdentity, call, resetCaches } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routesDir = join(root, 'comments-worker', 'src', 'routes');

let worker, weak;
before(async () => {
  ({ worker } = await loadWorker());
  weak = await weakIdentity('reach');
});

/* Every switch the roads read, on — so each reaches its floor, not an earlier
   "turned off" refusal. The floor fires in the preamble, before the body is
   validated, so a minimal body is enough: the weak key never gets that far. */
function env() {
  const db = freshDb();
  const e = makeEnv({ db });
  db.prepare("INSERT INTO app_settings (k,v,updated_at,updated_by) VALUES "
    + "('social_enabled','1',1,'t'),('media_enabled','1',1,'t'),('comments_pages','/credo.html',1,'t'),"
    + "('journal_enabled','1',1,'t'),('calls_enabled','1',1,'t')").run();
  return { db, e };
}

test('a weak identity is refused with weak_key on a write from every route file', async () => {
  resetCaches();
  /* one representative POST_LIMIT write per route file; the body is minimal
     because the floor answers before the handler reads it */
  const writes = [
    ['/api/comments', { page: 'board:pub', body: 'x', title: '' }],                 // board.ts  handlePost
    ['/api/comments/wall/post', { body: 'x' }],                                      // wall.ts   handleWallPost
    ['/api/comments/react', { target: 'wall', id: 1, emoji: '❤️' }],                // wall.ts   handleReact
    ['/api/comments/profile', { set: { bio: 'x' } }],                               // profile.ts handleProfileSave
    ['/api/merecat/ask-init', { q: 'hello' }],                                       // merecat.ts handleMerecatAskInit
  ];
  for (const [path, extra] of writes) {
    const { db, e } = env();
    const r = await call(worker, e, 'POST', path, { key: weak.key, ...extra });
    assert.equal(r.status, 400, path + ' should refuse a weak key');
    assert.equal(r.json.weak_key, true, path + ' names the reason');
    assert.match(r.json.error, /guess/, path + ' says why');
    db.close();
  }
});

test('a weak identity is refused on the uploads, which read the key from the form', async () => {
  resetCaches();
  for (const path of ['/api/comments/wall/media', '/api/comments/avatar']) {
    const { db, e } = env();
    const form = new FormData();
    form.append('key', weak.key);
    form.append(path.endsWith('avatar') ? 'avatar' : 'file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'x');
    const r = await call(worker, e, 'POST', path, form);
    assert.equal(r.status, 400, path + ' should refuse a weak key');
    assert.equal(r.json.weak_key, true, path + ' names the reason');
    db.close();
  }
});

test('a generated key still writes: the floor refuses the weak, never the strong', async () => {
  resetCaches();
  const { db, e } = env();
  /* a generated key posting a feed post is not stopped by the floor (it may be
     stopped later — Turnstile, validation — but never with weak_key) */
  const good = (await import('../_support/worker.mjs')).identity;
  const strong = await good('reach-strong');
  const r = await call(worker, e, 'POST', '/api/comments/wall/post', { key: strong.key, body: 'a real post' });
  assert.notEqual(r.json && r.json.weak_key, true, 'a generated key is never refused as weak');
  db.close();
});

/* ---- completeness: the source law that keeps the floor whole ---- */

/* Split a route file into its handler function bodies (from one `function` to
   the next), so a POST_LIMIT throttle and its floor are checked in the SAME
   handler however far apart they sit (an upload reads its key after formData). */
function handlers(src) {
  const starts = [...src.matchAll(/^(?:export\s+)?async function (\w+)/gm)];
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index;
    const to = i + 1 < starts.length ? starts[i + 1].index : src.length;
    out.push({ name: starts[i][1], body: src.slice(from, to) });
  }
  return out;
}

test('every handler that rate-limits a WRITE also calls keyFloor — no write road added without it', () => {
  const offenders = [];
  for (const f of readdirSync(routesDir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(routesDir, f), 'utf8');
    for (const h of handlers(src)) {
      const throttles = /throttle\(env, 'POST_LIMIT'/.test(h.body);
      const floors = /keyFloor\(env, 'POST_LIMIT'/.test(h.body);
      /* a handler that reaches the shared preamble (gated/keyed/keyedGated) is
         floored there, and does NOT call throttle itself — so the rule is
         simply: a hand-rolled POST_LIMIT throttle implies a keyFloor beside it */
      if (throttles && !floors) offenders.push(f + ' :: ' + h.name);
    }
  }
  assert.deepEqual(offenders, [], 'these write handlers throttle POST_LIMIT but never call keyFloor — a weak key writes through them: '
    + offenders.join(', '));
});

test('the shared preambles carry the floor, so the roads that DO use them are covered too', () => {
  const lib = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
  for (const fn of ['gated', 'keyed', 'adminGated']) {
    const m = new RegExp('export async function ' + fn + '\\b[\\s\\S]*?\\n}').exec(lib);
    assert.ok(m, fn + ' is in lib.ts');
    assert.match(m[0], /keyFloor\(env, /, fn + ' must call keyFloor');
  }
});
