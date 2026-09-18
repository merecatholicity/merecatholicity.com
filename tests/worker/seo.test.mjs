/* Somewhere to go (2026-09-17): a board thread at its own URL, the site feed at
   the addresses a feed reader guesses, and the sitemap that names every thread
   (comments-worker/src/routes/seo.ts).

   What would break silently: the page is the ONE road on which the worker
   writes a stranger's text into HTML, and the one that answers a crawler — so
   what it must never serve (a held post, the back room, a shadowed author) is
   swept here as well as in the leak sweep, and the escaping is asserted on a
   body that carries a tag. The three roads share the feed's rules, so a rule
   that moves in routes/board.ts and not here is a red test, not a live leak.

   Importing tests/_support/sweep.mjs installs the MiniRewriter that stands in
   for the Workers HTMLRewriter global, and its `responder` serves the static
   community.html the page fetches from the origin. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, call, netSpy, resetCaches } from '../_support/worker.mjs';
import { responder } from '../_support/sweep.mjs';
import { threadPath, threadSlug } from '../../comments-worker/src/routes/seo.ts';

test('the slug is the title in words, and the id alone is a whole URL', () => {
  assert.equal(threadSlug('On the Communion of Saints'), 'on-the-communion-of-saints');
  assert.equal(threadSlug("What is 'mere' catholicity?"), 'what-is-mere-catholicity');
  assert.equal(threadSlug('   — ?? —   '), '');
  assert.equal(threadSlug(null), '');
  assert.equal(threadPath(7, null), '/t/7', 'a title that yields no slug still has a URL');
  assert.equal(threadPath(7, 'Hello there'), '/t/7-hello-there');
  const long = threadSlug('a title that is really quite a lot longer than sixty characters of slug and keeps going');
  assert.ok(long.length <= 60 && !long.endsWith('-'), 'cut near sixty, at a word boundary');
});

let worker, env, db, net;
const now = Math.floor(Date.now() / 1000);
const post = (page, parent, title, body, status) => Number(db.prepare(
  'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, last_at, replies) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
  .run(page, parent, title, 'a'.repeat(64), body, status, now - 100, now - 50).lastInsertRowid);

before(async () => { ({ worker } = await loadWorker()); });
beforeEach(() => {
  resetCaches();
  db = freshDb();
  env = makeEnv({ db, vars: { ADMIN_HASHES: 'none' } });
  net = netSpy(responder);
});

test('a live thread is a page: its title, its text, a canonical URL and a base the client can remove', async () => {
  const id = post('board:pub', null, 'On the Communion of Saints', 'The first paragraph.\n\nThe second <b>one</b>.', 'live');
  post('board:pub', id, null, 'A reply in the thread.', 'live');
  const { status, text, res } = await call(worker, env, 'GET', '/t/' + id + '-on-the-communion-of-saints');
  assert.equal(status, 200);
  assert.match(res.headers.get('Content-Type') || '', /text\/html/);
  assert.match(text, /<base href="\/">/, 'the page is one directory deep; its relative links need the root');
  assert.match(text, /<link rel="canonical" href="[^"]*\/t\/\d+-on-the-communion-of-saints">/);
  assert.match(text, /<title>On the Communion of Saints \| Community \| Mere Catholicity<\/title>/);
  assert.match(text, /<p>The first paragraph\.<\/p>/, 'the body is IN the page, not only the share card');
  assert.match(text, /A reply in the thread\./, 'the replies are there too');
  assert.match(text, /&lt;b&gt;one&lt;\/b&gt;/, "a poster's tag is text, never markup");
  assert.match(text, /community\.html\?topic=/, 'and a door into the app');
  net.restore();
});

test('what the board does not show, the page does not serve: held, back room, shadowed, unknown', async () => {
  const held = post('board:pub', null, 'A held topic', 'waiting on a moderator', 'pending');
  const back = post('board:adminsonly', null, 'A back room topic', 'not for the world', 'live');
  const shadow = post('board:pub', null, 'A shadowed topic', 'from a shadowed hand', 'live');
  db.prepare("INSERT INTO shadowbans (hash, created_at, added_by) VALUES (?, ?, 'test')").run('a'.repeat(64), now - 200);
  for (const id of [held, back, shadow, 99999]) {
    const { status, text } = await call(worker, env, 'GET', '/t/' + id);
    assert.equal(status, 404, 'thread ' + id + ' reads as nonexistence');
    assert.doesNotMatch(text, /back room|held topic|shadowed hand/i);
  }
  net.restore();
});

test('the five conventional addresses all answer one RSS feed, linked to the threads', async () => {
  const id = post('board:pub', null, 'A topic to follow', 'the topic body', 'live');
  post('board:pub', id, null, 'a reply body', 'live');
  post('board:adminsonly', null, 'A back room topic', 'not for the world', 'live');
  for (const path of ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml']) {
    const { status, text, res } = await call(worker, env, 'GET', path);
    assert.equal(status, 200, path + ' answers');
    assert.match(res.headers.get('Content-Type') || '', /application\/rss\+xml/, path);
    assert.match(text, new RegExp('<link>[^<]*/t/' + id + '-a-topic-to-follow</link>'), path + ' links the thread by its own URL');
    assert.match(text, /a reply body/, path + ' carries the replies');
    assert.doesNotMatch(text, /back room/i, path + ' never opens the back room');
  }
  net.restore();
});

test('the sitemap names every live thread and nothing else', async () => {
  const id = post('board:pub', null, 'A topic to find', 'the topic body', 'live');
  post('board:pub', id, null, 'a reply body', 'live');
  post('board:adminsonly', null, 'A back room topic', 'not for the world', 'live');
  post('board:pub', null, 'A held topic', 'waiting', 'pending');
  const { status, text, res } = await call(worker, env, 'GET', '/sitemap-threads.xml');
  assert.equal(status, 200);
  assert.match(res.headers.get('Content-Type') || '', /application\/xml/);
  assert.equal((text.match(/<loc>/g) || []).length, 1, 'one URL: the live topic — not its reply, not the back room, not the held post');
  assert.match(text, new RegExp('<loc>[^<]*/t/' + id + '-a-topic-to-find</loc>'));
  net.restore();
});
