/* The social layer's global kill switch (app_settings `social_enabled`).
 *
 * Every failure this guards against is SILENT. A key missing from
 * handleAdminSettings' `allowed` map is dropped without a word, so the admin
 * ticks the box, the page reports success, and nothing changes. A handler that
 * forgets its guard leaves one door open in a wall of closed ones. A refusal
 * whose wording differs from the genuine not-found tells a prober the feature
 * exists and is merely switched off. And gating one of the three deliberately
 * open surfaces — /wall/delete, the SHARED GET /wall/media, the board upload
 * route — breaks the forum or strands content, which is worse than the bug.
 *
 * So these are drift guards over the shipping source, plus the schema check
 * that no migration is needed (the flag is a plain app_settings row). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');

test("the flag is seeded ON and read through the kernel's rule, not a bare compare", () => {
  assert.ok(libSrc.includes("social_enabled: '1',"),
    'APP_SETTING_DEFAULTS must seed social_enabled ON — a fresh database has no row');
  assert.ok(libSrc.includes(
    "export function socialEnabled(s: any) { return Wall.enabledFrom(String(s.social_enabled)); }"),
    'the membrane must go through Domain.Wall so client and worker share one polarity');
  /* The polarity is the trap: the codebase carries `!== '0'` (default-on) beside
     `=== '1'` (default-off). Reading this one as `=== '1'` would still pass a
     smoke test, because the seeded value IS '1' — it would only dark the feed on
     a database that has never had the row written. */
  assert.ok(!/s\.social_enabled\s*===\s*'1'/.test(idxSrc + libSrc),
    'no handler may re-derive the flag with a bare === compare');
});

test('an admin can actually save it: allowlist + boolean coercion', () => {
  const allowed = idxSrc.slice(idxSrc.indexOf('const allowed: any = {'));
  assert.ok(allowed.slice(0, allowed.indexOf('};')).includes('social_enabled: 1'),
    "handleAdminSettings drops any key not in `allowed` SILENTLY — the save would report success and do nothing");
  /* Assert the RULE, not the line. The first version of this pinned the exact
     coercion expression, so it broke the day a sibling boolean switch was added
     to the same chain — a green-to-red with nothing wrong, which teaches a
     reader to edit the test rather than read it. What matters is that
     social_enabled goes through the shared 1/0 normalisation. */
  const coercion = idxSrc.slice(idxSrc.indexOf("if (k === 'media_enabled'"));
  const chain = coercion.slice(0, coercion.indexOf(';') + 1);
  assert.ok(/k === 'social_enabled'/.test(chain),
    'social_enabled must sit in the boolean-coercion chain');
  assert.ok(/v = \(v === '1' \|\| v === 'true'\) \? '1' : '0';/.test(chain),
    'that chain must normalise to the same 1/0 strings every other boolean setting uses');
});

test('the client is told, so it can hide what it cannot have', () => {
  assert.ok(idxSrc.includes('social: { enabled: socialEnabled(s) },'),
    '/config must carry social.enabled — the Feed tab and the profile wall read it');
});

test('one guard, spelled one way, on every feed/wall surface', () => {
  assert.ok(idxSrc.includes("const noSuchPage = () => json({ ok: false, error: 'No such page.' }, 404);"));
  assert.ok(idxSrc.includes('async function socialOff(env: any) { return !socialEnabled(await getAppSettings(env)); }'));
  /* Nine gated surfaces: the two members-only reads, the two public reads, the
     four writes, and the wall media upload. */
  const guards = (idxSrc.match(/if \(await socialOff\(env\)\)/g) || []).length;
  assert.ok(guards >= 9, `expected every wall surface guarded, found ${guards}`);

  /* Each handler carries its own guard — checked by name, so moving code around
     cannot quietly leave one behind. */
  const body = (name) => {
    const i = idxSrc.indexOf(`async function ${name}(`);
    assert.ok(i > 0, `${name} not found`);
    return idxSrc.slice(i, i + 2400);
  };
  for (const h of ['handleWallFeed', 'handleWall', 'handleWallPostGet', 'handleWallLike',
    'handleWallCommentLike', 'handleWallLikers', 'handleWallPost', 'handleWallComment', 'handleWallEdit']) {
    assert.ok(/socialOff\(env\)/.test(body(h)), `${h} has no social gate`);
  }
});

test('a switched-off surface is indistinguishable from one that never existed', () => {
  /* A shared feed.html?post=<id> link must not be able to tell "turned off"
     from "deleted": the refusal is the SAME string the missing-post branch
     gives, and both are 404. */
  const post = idxSrc.slice(idxSrc.indexOf('async function handleWallPostGet('));
  assert.ok(post.includes("if (await socialOff(env)) return json({ ok: false, error: 'That post is gone.' }, 404);"));
  assert.ok(post.includes("if (!post) return json({ ok: false, error: 'That post is gone.' }, 404);"),
    'the genuine missing-post refusal must stay byte-identical to the gated one');
  /* Likers: an unknown post already answers with an empty list, so that is what
     "off" answers too — not an error a prober could distinguish. */
  assert.ok(idxSrc.includes("if (await socialOff(env)) return json({ ok: true, likers: [], more: false }, 200);"));
});

test('the three surfaces that must STAY open when the switch is off', () => {
  const between = (from, to) => {
    const i = idxSrc.indexOf(from);
    const j = idxSrc.indexOf(to, i);
    return idxSrc.slice(i, j > i ? j : i + 3000);
  };
  /* An author (or an admin) must always be able to retract their own content,
     and the admin queue discards held wall rows through this same route. */
  assert.ok(!/socialOff\(env\)/.test(between('async function handleWallDelete(', '\nasync function ')),
    '/wall/delete must never be gated — content would be un-retractable');
  /* GET /wall/media serves FORUM attachments too (ref_type 'board'): gating it
     would break board media for a feature that has nothing to do with the feed. */
  assert.ok(!/socialOff\(env\)/.test(between('async function handleWallMediaGet(', '\nasync function ')),
    'the shared media GET must never be gated — board attachments ride it');
  /* The gate rides the wall UPLOAD route, not mediaUpload itself, for the same
     reason: the board route shares that handler. */
  assert.ok(idxSrc.includes(
    "{ m: 'POST', p: '/api/comments/wall/media', fn: async (request, env, ctx, url) => (await socialOff(env)) ? noSuchPage() : mediaUpload(request, env, 'wall') },"));
  assert.ok(idxSrc.includes(
    "{ m: 'POST', p: '/api/comments/board/media', fn: (request, env, ctx, url) => mediaUpload(request, env, 'board') },"),
    'the board upload route must stay ungated');
  const mu = between('async function mediaUpload(', '\nasync function ');
  assert.ok(!/socialOff\(env\)/.test(mu), 'the gate belongs on the route, not inside the shared handler');
});

test('wall notifications leave no bell the reader can never clear', () => {
  /* A `wall` notification opens onto a feed post. With the feed unreachable,
     counting one would leave a badge with nothing behind it — so the counts and
     the list hide them. The rows themselves stay: read state and all, they come
     back with the switch. */
  assert.ok(idxSrc.includes(
    `const notifHideWall = (alias: string) => " AND " + alias + "kind NOT IN ('wall','wall-like') ";`));
  const unread = idxSrc.slice(idxSrc.indexOf('async function notifUnreadCount('));
  assert.ok(unread.slice(0, 400).includes("notifHideWallSql(env, '')"),
    'the badge count must exclude wall kinds when off');
  /* BOTH unread counts go through the one helper — there were two copies of
     this query, and a fix applied to one only is exactly how a badge sticks. */
  const rawCounts = (idxSrc.match(/SELECT COUNT\(\*\) AS n FROM notifications WHERE recipient_hash = \?1 AND read_at IS NULL/g) || []).length;
  assert.equal(rawCounts, 1, 'the unread-count query must exist in exactly one place');
  assert.ok((idxSrc.match(/notifUnreadCount\(env, me\)/g) || []).length >= 2,
    'every unread-count caller must use the helper');
  /* Saved feed posts drop out of the mixed bookmarks list, and 'wall' stops
     being a valid bookmark kind (falling into the pre-existing 'Bad request.'). */
  assert.ok(idxSrc.includes(`(socialOn ? '' : "AND b.kind <> 'wall' ") +`));
  assert.ok(idxSrc.includes("const kindOk = kind === 'topic' || (kind === 'wall' && !(await socialOff(env)));"));
});

test('no migration is needed: app_settings takes the flag as a plain row', () => {
  const db = new DatabaseSync(':memory:');
  const dir = join(root, 'comments-worker', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  db.exec("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES ('social_enabled', '0', 0, 'x')");
  const row = db.prepare("SELECT v FROM app_settings WHERE k = 'social_enabled'").get();
  assert.equal(row.v, '0');
  /* And nothing is deleted by turning it off: the tables the switch hides are
     ordinary tables the switch never touches. */
  for (const t of ['wall_posts', 'wall_comments', 'wall_likes', 'wall_comment_likes', 'bookmarks']) {
    assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n === 0, `${t} must exist`);
  }
  db.close();
});
