/* comments-worker/src/routes/seo.ts — the roads a reader who is not yet a
   member arrives by: a thread at its own URL, the feeds at the addresses a
   feed reader guesses, and the sitemap that names every thread (2026-09-17).

   Why the worker serves them: the site itself is static HTML on Pages, and a
   forum thread lives in D1 — so until now a thread had no URL of its own, only
   community.html?topic=<n>, whose body arrives by fetch after the client boots.
   To a crawler that is an empty page: ninety-odd conversations invisible to
   search. /@handle already proved the road (lib.ts: fetch the static page from
   the origin, inject through HTMLRewriter); this is the same road with the
   thread's TEXT injected, not only its share card.

   The rules it keeps, the same ones the RSS feed keeps (routes/board.ts
   handleFeed): a live topic in a board category, never the back room, never a
   held or shadowed post, never a reply whose author is shadowed. Nothing here
   reads an identity — what it serves is what an anonymous reader already sees
   through the public feed. */
import {
  ADMIN_CAT,
  boardKey,
  displayName,
  readLimited,
  shadowExcl,
  siteBase,
  xmlEscape,
} from '../lib.ts';
import type { Env } from '../env.ts';
import { MetaAttr, TitleText } from '../lib.ts';

/* /t/<id>-<slug>: the id is the truth, the slug is for the reader's eye, and
   any slug (or none) resolves — a renamed topic's old links keep working. */
export const THREAD_PATH = /^\/t\/(\d+)(?:-[^/?#]*)?$/;

/* The slug: the title's words, lowercase, joined by hyphens, cut at a word
   boundary near 60 characters. Ascii only — a title in another alphabet
   simply yields no slug, and /t/<id> alone is a whole URL. */
export function threadSlug(title: unknown) {
  const words = String(title == null ? '' : title).toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (words.length <= 60) return words;
  const cut = words.slice(0, 60);
  const back = cut.lastIndexOf('-');
  return (back > 20 ? cut.slice(0, back) : cut).replace(/-+$/, '');
}

export function threadPath(id: number | string, title: unknown) {
  const slug = threadSlug(title);
  return '/t/' + String(id) + (slug ? '-' + slug : '');
}

type Post = { id: number; title: string | null; body: string; author_hash: string | null; nick: string | null; created_at: number };

/* The thread as a reader may see it, or null: no such topic, a held one, the
   back room, a shadowed author. Replies oldest-first, the first fifty — a long
   thread's tail stays behind the app, which is where the conversation is. */
async function readThread(env: Env, id: number): Promise<{ topic: Post & { page: string }; replies: Post[] } | null> {
  const topic = await env.DB.prepare(
    'SELECT c.id, c.page, c.title, c.body, c.author_hash, c.created_at, pr.nick FROM comments c ' +
    'LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c')
  ).bind(id).first<Post & { page: string }>();
  if (!topic || !boardKey(topic.page) || topic.page === ADMIN_CAT) return null;
  const replies = await env.DB.prepare(
    'SELECT c.id, c.title, c.body, c.author_hash, c.created_at, pr.nick FROM comments c ' +
    'LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.parent_id = ?1 AND c.status = 'live' AND " + shadowExcl('c') + ' ORDER BY c.id LIMIT 50'
  ).bind(id).all<Post>();
  return { topic, replies: replies.results };
}

const author = (p: Post) => p.nick || (p.author_hash ? displayName(p.author_hash) : 'Anonymous');
const stamp = (t: number) => new Date(t * 1000).toISOString();

/* One post's body as paragraphs. Deliberately NOT the markdown renderer: this
   is the crawler's copy and the reader's first paint, and the client replaces
   the whole section a moment later with the real, live rendering. Every
   character is escaped — a body is a stranger's text. */
function bodyHtml(body: unknown) {
  return String(body == null ? '' : body).split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean)
    .map((para) => '<p>' + xmlEscape(para).replace(/\n/g, '<br>') + '</p>').join('');
}

function postHtml(p: Post, head: boolean) {
  return '<article class="comment" id="comment-' + p.id + '">' +
    '<p class="comment-meta">' + xmlEscape(author(p)) +
    ' <time datetime="' + xmlEscape(stamp(p.created_at)) + '">' + xmlEscape(new Date(p.created_at * 1000).toUTCString()) + '</time></p>' +
    '<div class="comment-body' + (head ? ' prose' : '') + '">' + bodyHtml(p.body) + '</div></article>';
}

/* The summary line an OG card and a search result show: the topic's opening
   words, whitespace collapsed. */
function summary(body: unknown) {
  const flat = String(body == null ? '' : body).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? flat.slice(0, 197).replace(/\s+\S*$/, '') + '…' : flat;
}

/* GET /t/<id>-<slug>. Fetches the static community.html from the origin (NOT
   routed here, so no loop), injects the thread's head and body, and answers it.
   A <base> goes in first: the page's own links are relative to the site root
   and this URL is one directory deeper — the client removes it the moment it
   boots (client/comments.ts) and puts the reader on the app's own URL. */
export async function handleThreadPage(request: Request, env: Env, url: URL) {
  const m = THREAD_PATH.exec(url.pathname.replace(/\/+$/, ''));
  if (!m) return new Response('No such thread.', { status: 404 });
  const limited = await readLimited(request, env, { plain: true });
  if (limited instanceof Response) return limited;
  const id = Number(m[1]);
  const pageReq = new URL('/community.html', url.origin).toString();
  const t = await readThread(env, id);
  if (!t) {
    return new Response('No such thread.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
  }
  const title = String(t.topic.title || 'A thread');
  const canonical = siteBase(env) + threadPath(t.topic.id, title);
  const desc = summary(t.topic.body) || ('A conversation on the Catholicity Board, in ' + t.topic.page.slice(6) + '.');
  const body =
    '<h1 class="board-topic-head">' + xmlEscape(title) + '</h1>' +
    postHtml(t.topic, true) +
    t.replies.map((r) => postHtml(r, false)).join('') +
    '<p class="comments-status"><a href="' + xmlEscape('/community.html?topic=' + t.topic.id) + '">' +
    'Open this thread in the Catholicity Board</a></p>';
  try {
    const originResp = await fetch(pageReq, { headers: { Accept: 'text/html' } });
    if (!originResp.ok) return originResp;
    return new HTMLRewriter()
      .on('head', new BaseHref(canonical))
      .on('title', new TitleText(title + ' | Community | Mere Catholicity'))
      .on('meta[name="description"]', new MetaAttr(desc))
      .on('meta[property="og:title"]', new MetaAttr(title))
      .on('meta[name="twitter:title"]', new MetaAttr(title))
      .on('meta[property="og:description"]', new MetaAttr(desc))
      .on('meta[name="twitter:description"]', new MetaAttr(desc))
      .on('meta[property="og:url"]', new MetaAttr(canonical))
      .on('meta[property="og:type"]', new MetaAttr('article'))
      .on('section[data-board]', new Prerendered(body))
      .transform(new Response(originResp.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          /* HTML is never edge-cached here (the ?v= law); a crawler's repeat
             visit may sit in its own cache for five minutes. */
          'Cache-Control': 'public, max-age=300',
          'X-Robots-Tag': 'index, follow',
        },
      }));
  } catch {
    /* Never a dead end: the app's own URL carries the reader the rest of the way. */
    return Response.redirect(siteBase(env) + '/community.html?topic=' + id, 302);
  }
}

/* <base href="/"> as the head's first child, and the canonical link after it. */
class BaseHref {
  declare href: string;
  constructor(href: string) { this.href = href; }
  element(el: Element) {
    el.prepend('<base href="/"><link rel="canonical" href="' + xmlEscape(this.href) + '">' +
      '<link rel="alternate" type="application/rss+xml" title="Mere Catholicity community" href="/feed.xml">', { html: true });
  }
}

/* The thread's text where the client's board section will stand. The client
   clears it on boot (route() empties the section) — this is the copy a crawler
   and a reader on a slow phone see first. */
class Prerendered {
  declare html: string;
  constructor(html: string) { this.html = html; }
  element(el: Element) { el.setInnerContent(this.html, { html: true }); }
}

/* The site feed, at the five addresses a feed reader guesses (/feed, /feed.xml,
   /rss, /rss.xml, /atom.xml — all five 404'd until now, and the journal's own
   topic asked for one). Every live board post, newest first, each linked to its
   thread's own URL. The per-topic and per-category feeds
   (/api/comments/feed?topic=|cat=) are unchanged. */
export async function handleSiteFeed(request: Request, env: Env, url: URL) {
  const limited = await readLimited(request, env, { plain: true });
  if (limited instanceof Response) return limited;
  type Row = { id: number; parent_id: number | null; title: string | null; head_title: string | null; nick: string | null; author_hash: string | null; body: string; created_at: number };
  const rows = await env.DB.prepare(
    'SELECT c.id, c.parent_id, c.title, pt.title AS head_title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c ' +
    'LEFT JOIN comments pt ON pt.id = c.parent_id ' +
    'LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.page LIKE 'board:%' AND c.page <> ?1 AND c.status = 'live' AND " + shadowExcl('c') +
    " AND (c.parent_id IS NULL OR (pt.status = 'live' AND " + shadowExcl('pt') + ')) ORDER BY c.id DESC LIMIT 50'
  ).bind(ADMIN_CAT).all<Row>();
  const base = siteBase(env);
  const items = rows.results.map(function (c) {
    const name = c.nick || (c.author_hash ? displayName(c.author_hash) : 'Anonymous');
    const head = c.parent_id ? String(c.head_title || 'a thread') : String(c.title || 'a thread');
    const link = base + threadPath(c.parent_id || c.id, head) + (c.parent_id ? '#comment-' + c.id : '');
    const itemTitle = c.parent_id ? name + ' re: ' + head : head;
    return '<item><title>' + xmlEscape(itemTitle) + '</title>' +
      '<link>' + xmlEscape(link) + '</link>' +
      '<guid isPermaLink="true">' + xmlEscape(link) + '</guid>' +
      '<pubDate>' + new Date(c.created_at * 1000).toUTCString() + '</pubDate>' +
      '<description>' + xmlEscape(c.body) + '</description></item>';
  }).join('');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0"><channel>' +
    '<title>Mere Catholicity - the Catholicity Board</title>' +
    '<link>' + xmlEscape(base + '/community.html') + '</link>' +
    '<description>Topics and replies from the community of merecatholicity.com</description>' +
    items + '</channel></rss>';
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
  });
}

/* /sitemap-threads.xml: every live thread's own URL, newest first. The static
   docs/sitemap.xml is built from the files in the tree and cannot know the
   board; docs/robots.txt names this one beside it. */
export async function handleThreadSitemap(request: Request, env: Env, url: URL) {
  const limited = await readLimited(request, env, { plain: true });
  if (limited instanceof Response) return limited;
  const rows = await env.DB.prepare(
    'SELECT c.id, c.title, c.last_at, c.created_at FROM comments c ' +
    "WHERE c.page LIKE 'board:%' AND c.page <> ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c') +
    ' ORDER BY c.id DESC LIMIT 2000'
  ).bind(ADMIN_CAT).all<{ id: number; title: string | null; last_at: number | null; created_at: number }>();
  const base = siteBase(env);
  const urls = rows.results.map((t) =>
    '<url><loc>' + xmlEscape(base + threadPath(t.id, t.title)) + '</loc>' +
    '<lastmod>' + xmlEscape(stamp(Number(t.last_at) || t.created_at)) + '</lastmod></url>').join('');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + '</urlset>';
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
  });
}

/* The addresses this module answers, outside the ROUTES table (they are not
   /api/* paths): index.ts matches them before the table. */
export const FEED_PATHS = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml'];
export const SITEMAP_PATH = '/sitemap-threads.xml';
