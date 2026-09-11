/* Comments sections under the admin's hand (app_settings `comments_pages`,
 * `comments_journal`).
 *
 * Every failure this guards against is SILENT, the same family the social
 * switch's file names. A key missing from handleAdminSettings' `allowed` map is
 * dropped without a word. A read that forgets the gate keeps serving a section
 * the admin closed. A refusal worded differently from the genuine unknown-page
 * one tells a prober the page exists and is merely switched off. A journal
 * article deleted without its comments retiring leaves rows nobody can reach
 * or clean. And a page list copied inline in the worker drifts from the kernel
 * that the client and the build read.
 *
 * So: drift guards over the shipping source, the sweep's real SQL run against
 * the real migrations in node:sqlite, and the schema check that no migration
 * is needed (two plain app_settings rows). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');

/* The body of one top-level handler, by name, so moving code around cannot
   quietly leave a guard behind (the social file's idiom). */
const body = (name) => {
  const i = idxSrc.indexOf(`async function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = idxSrc.indexOf('\nasync function ', i + 10);
  return idxSrc.slice(i, j > i ? j : i + 6000);
};

test('the page list is the kernel\'s, never an inline copy', () => {
  assert.ok(libSrc.includes('export const PAGES: string[] = Comments.commentablePaths;'),
    'PAGES must be read from Domain.Comments — the client and the build-parity test read the same table');
  assert.ok(!/'\/book\.html',\s*\n\s*'\/charting-communions\.html'/.test(libSrc),
    'the old inline whitelist must be gone');
});

test('both switches are seeded OFF from the kernel and read through its rules', () => {
  assert.ok(libSrc.includes('comments_pages: Comments.pagesEnabledDefault,'));
  assert.ok(libSrc.includes("comments_journal: Comments.journalEnabledDefault ? '1' : '0',"));
  assert.ok(libSrc.includes('Comments.pageEnabled(String(s.comments_pages'), 'commentsPageOn must go through Domain.Comments.pageEnabled');
  assert.ok(libSrc.includes('Comments.journalEnabledFrom(String(s.comments_journal'), 'commentsJournalOn must go through Domain.Comments.journalEnabledFrom');
  /* The polarity trap, the other way round from the social switch: this one
     is default-OFF, so a bare `!== '0'` compare would open every section on
     a fresh database. Neither idiom may be re-derived by hand. */
  assert.ok(!/s\.comments_journal\s*(===|!==)\s*'[01]'/.test(idxSrc + libSrc), 'no handler may re-derive the journal switch with a bare compare');
  assert.ok(!/s\.comments_pages\s*(===|!==|\.split|\.indexOf)/.test(idxSrc + libSrc), 'no handler may parse the pages CSV by hand');
});

test('an admin can actually save them: allowlist + coercion through the kernel', () => {
  const allowed = idxSrc.slice(idxSrc.indexOf('const allowed: any = {'));
  const map = allowed.slice(0, allowed.indexOf('};'));
  assert.ok(map.includes('comments_pages: 1'), 'comments_pages missing from `allowed` — the save would report success and do nothing');
  assert.ok(map.includes('comments_journal: 1'), 'comments_journal missing from `allowed`');
  const coercion = idxSrc.slice(idxSrc.indexOf("if (k === 'media_enabled'"));
  const chain = coercion.slice(0, coercion.indexOf(';') + 1);
  assert.ok(/k === 'comments_journal'/.test(chain), 'comments_journal must sit in the shared boolean-coercion chain');
  assert.ok(idxSrc.includes("else if (k === 'comments_pages') v = Comments.serializeEnabledPages(Comments.parseEnabledPages(v));"),
    'the pages CSV must be normalized through the kernel, so a non-commentable path can never be stored as open');
});

test('the client is told, so it mounts nothing for a closed page', () => {
  assert.ok(idxSrc.includes('comments: { pages: commentsPagesOn(s), journal: commentsJournalOn(s) },'),
    '/config must carry comments.pages + comments.journal');
  assert.equal((idxSrc.match(/comments: commentsOn,/g) || []).length, 2,
    'both journal shapes (one article, the index) must carry `comments`');
});

test('one resolver, used by every read and write, and a closed section reads as an unknown page', () => {
  assert.ok(idxSrc.includes('async function commentsPageKey(env: any, raw: any): Promise<string | null> {'));
  for (const h of ['handleGet', 'handlePost', 'handleFeed', 'handleEdit']) {
    assert.ok(/commentsPageKey\(env,/.test(body(h)), `${h} does not resolve its page through commentsPageKey`);
  }
  /* The read and the write must no longer reach normalizePage on their own:
     that was the ungated path. */
  assert.ok(!/normalizePage\(/.test(body('handleGet')), 'handleGet must not bypass the gate');
  assert.ok(!/normalizePage\(/.test(body('handlePost')), 'handlePost must not bypass the gate');
  /* Byte-identical to the genuine unknown-page refusal, in both handlers. */
  assert.ok(body('handleGet').includes("if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);"));
  assert.ok(body('handlePost').includes("if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);"));
  /* The edit refuses with the SAME words a missing row gets. */
  const edit = body('handleEdit');
  assert.ok((edit.match(/'Not yours, or already gone\.'/g) || []).length >= 2,
    'the closed-section edit refusal must be the missing-row refusal, verbatim');
});

test('what stays open when a section is closed', () => {
  /* An author or an admin must always be able to retract. */
  assert.ok(!/commentsPageKey\(/.test(body('handleSelfDelete')), '/delete must never be gated');
  /* Admin tooling reads any key — and understands journal keys. */
  const meta = body('handleMeta');
  assert.ok(!/commentsPageKey\(/.test(meta), '/meta is admin-keyed and never switch-gated');
  assert.ok(meta.includes('|| journalKey(data.page)'), '/meta must accept a journal key so the fingerprint drawer works there');
});

test('a journal article can carry a section only while it is a live entry of the standing journal', () => {
  assert.ok(idxSrc.includes('async function journalTopic(env: any, s: any) {'));
  assert.ok(idxSrc.includes('async function journalArticleLive(env: any, s: any, id: number) {'));
  assert.ok(/journalArticleLive\(env, s, id\)/.test(body('commentsPageKey')), 'the resolver must ask the same predicate the journal read uses');
  assert.ok(/journalTopic\(env, s\)/.test(body('handleJournal')), 'handleJournal must share journalTopic — one predicate, not two');
  const jt = body('journalTopic');
  assert.ok(jt.includes("topic.page === ADMIN_CAT) return null;"), 'the back room is never a journal');
  assert.ok(/shadowExcl\('c'\)/.test(jt) && /shadowExcl\('c'\)/.test(body('journalArticleLive')), 'a muted author\'s entry is no entry');
});

test('a deleted journal article takes its comments with it — from every deleting path and the cron', () => {
  for (const h of ['handleSelfDelete', 'handleModerate', 'handleDeleteUser']) {
    assert.ok(/sweepJournalComments\(env/.test(body(h)), `${h} deletes without retiring journal comments`);
  }
  /* The head deleted is the whole journal deleted: the thread form. */
  assert.ok(/id === jt\) await sweepJournalComments\(env, id\)/.test(body('handleSelfDelete')));
  assert.ok(/id === jt\) await sweepJournalComments\(env, id\)/.test(body('handleModerate')));
  const cron = idxSrc.slice(idxSrc.indexOf('async scheduled('));
  assert.ok(/pruneComments\(env\)\)\s*\.then\(\(\) => sweepJournalComments\(env\)\)/.test(cron),
    'the monthly cron must sweep right after the comment prune (which may just have hard-deleted the articles)');
});

/* The real sweep SQL against the real schema. */
function freshDb() {
  const db = new DatabaseSync(':memory:');
  const dir = join(root, 'comments-worker', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  return db;
}
const SQL = (name) => {
  const m = new RegExp(`export const ${name} = "((?:[^"\\\\]|\\\\.)*)";`).exec(libSrc);
  assert.ok(m, `${name} not found in lib.ts`);
  return m[1];
};
function seed(db) {
  const ins = db.prepare("INSERT INTO comments (id, page, parent_id, title, author_hash, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1)");
  ins.run(3, 'board:pub', null, 'The Journal', 'a'.repeat(64), 'head', 'live');       // the journal topic
  ins.run(5, 'board:pub', 3, null, 'a'.repeat(64), 'article five', 'live');
  ins.run(6, 'board:pub', 3, null, 'a'.repeat(64), 'article six', 'deleted');
  ins.run(7, 'board:pub', 3, null, 'a'.repeat(64), 'article seven', 'pending');
  ins.run(11, 'journal:3', null, null, 'b'.repeat(64), 'on the head', 'live');
  ins.run(12, 'journal:5', null, null, 'b'.repeat(64), 'on five', 'live');
  ins.run(13, 'journal:6', null, null, 'b'.repeat(64), 'on six (article deleted)', 'live');
  ins.run(14, 'journal:7', null, null, 'b'.repeat(64), 'on seven (article held)', 'live');
  ins.run(15, 'journal:99', null, null, 'b'.repeat(64), 'on a vanished article', 'live');
  ins.run(16, '/credo.html', null, null, 'b'.repeat(64), 'a page comment', 'live');
}
const statuses = (db) => Object.fromEntries(db.prepare('SELECT id, status FROM comments ORDER BY id').all().map((r) => [r.id, r.status]));

test('the sweep retires only the comments of a deleted or vanished article', () => {
  const db = freshDb();
  seed(db);
  db.exec(SQL('JOURNAL_SWEEP_SQL') + ')');
  const st = statuses(db);
  assert.equal(st[11], 'live', 'the head is live: its comments stand');
  assert.equal(st[12], 'live', 'article five is live: its comments stand');
  assert.equal(st[13], 'deleted', 'article six is deleted: its comments retire');
  assert.equal(st[14], 'live', 'a HELD article keeps its comments (an approval must not find them gone)');
  assert.equal(st[15], 'deleted', 'a vanished article (hard-pruned) retires its comments');
  assert.equal(st[16], 'live', 'a page comment is never touched');
  assert.equal(st[5], 'live', 'the sweep never touches the articles themselves');
  /* Idempotent: a second pass changes nothing. */
  const again = db.prepare(SQL('JOURNAL_SWEEP_SQL') + ')').run();
  assert.equal(again.changes, 0);
  db.close();
});

test("the thread form (the journal's own topic deleted) retires every article's comments", () => {
  const db = freshDb();
  seed(db);
  db.prepare("UPDATE comments SET status = 'deleted' WHERE id = 3").run();
  db.prepare(SQL('JOURNAL_SWEEP_SQL') + SQL('JOURNAL_SWEEP_THREAD_SQL') + ')').run(3);
  const st = statuses(db);
  assert.equal(st[11], 'deleted', "the head's own comments");
  assert.equal(st[12], 'deleted', 'a live reply is no longer an article of anything');
  assert.equal(st[14], 'deleted');
  assert.equal(st[5], 'live', 'the reply rows themselves stay, as a topic delete always left them');
  assert.equal(st[16], 'live');
  db.close();
});

test('no migration is needed: app_settings takes both switches as plain rows', () => {
  const db = freshDb();
  db.exec("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES ('comments_pages', '/credo.html', 0, 'x'), ('comments_journal', '1', 0, 'x')");
  assert.equal(db.prepare("SELECT v FROM app_settings WHERE k = 'comments_pages'").get().v, '/credo.html');
  assert.equal(db.prepare("SELECT v FROM app_settings WHERE k = 'comments_journal'").get().v, '1');
  db.close();
});
