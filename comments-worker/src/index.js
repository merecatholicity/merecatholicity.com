/* Comments handler. Same-origin API on /api/comments*. A commenter's whole
   account is a random client-side key; the server stores only SHA-256(key),
   so there is nothing here to leak. Turnstile gates every write, the
   rate-limit binding throttles by IP, and Llama Guard screens the text
   (flagged or unscreenable comments are held pending, never dropped).
   The only secret is TURNSTILE_SECRET, the Turnstile server key. */

const PAGES = [
  '/book.html',
  '/charting-communions.html',
  '/free-churches.html',
  '/objections.html',
  '/credo.html',
  '/lex-orandi.html',
  '/about.html',
];

/* The Catholicity Board. A category is a virtual page key, a topic is a
   titled comment with no parent, a reply is a comment whose parent is the
   topic. Everything else, identity, screening, limits, moderation, is the
   one pipeline all comments share. Keys must match CATS in comments.js. */
const BOARD_CATS = ['pub', 'news', 'theology', 'philosophy', 'history', 'rc', 'eo', 'lutheran', 'anglican', 'presbyterian', 'prot', 'indoeuropean', 'offtopic'];

function boardKey(raw) {
  const m = /^board:([a-z]+)$/.exec(String(raw || ''));
  return m && BOARD_CATS.includes(m[1]) ? raw : null;
}

const SITE = 'https://merecatholicity.com';
const MAX_BODY = 4000;
const MAX_TITLE = 120;
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/;

/* Must stay identical to the lists in comments.js, or the name in the
   notification email will not match the name on the page. */
const ADJ = ['Patient','Quiet','Steadfast','Humble','Gentle','Sober','Watchful','Earnest',
  'Merry','Plain','Hidden','Upright','Ancient','Early','Golden','Green',
  'Grey','Amber','Ivory','Deep','Broad','High','Still','Bright',
  'Clear','Kind','Mild','Firm','True','Swift','Careful','Cheerful',
  'Constant','Modest','Peaceful','Prudent','Silent','Simple','Sturdy','Temperate'];
const NOUN = ['Cedar','Harbor','Meadow','River','Garden','Orchard','Bridge','Lantern',
  'Anchor','Well','Spring','Stone','Oak','Olive','Vine','Wheat',
  'Barley','Dove','Sparrow','Heron','Candle','Bell','Tower','Gate',
  'Path','Field','Hill','Valley','Brook','Shore','Island','Harvest',
  'Vineyard','Cypress','Juniper','Almond','Fig','Palm','Elm','Ash'];

function displayName(hash) {
  const b = (i) => parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  const adj = ADJ[((b(4) << 8) | b(5)) % ADJ.length];
  const noun = NOUN[((b(6) << 8) | b(7)) % NOUN.length];
  return adj + '-' + noun + ' ' + hash.slice(0, 4);
}

const enc = new TextEncoder();

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* Same-origin API. A cross-origin browser POST always carries an Origin, so
   reject any Origin that is not ours; a missing Origin (non-browser clients,
   some same-origin form posts) is allowed through to the usual gates. */
const ALLOWED_ORIGINS = ['https://merecatholicity.com', 'https://www.merecatholicity.com'];
function originOk(request) {
  const o = request.headers.get('Origin');
  return !o || ALLOWED_ORIGINS.includes(o);
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function parseOS(ua) {
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows nt/i.test(ua)) return 'Windows';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return ua ? 'Other' : '';
}

function isAdminHash(env, hash) {
  return (env.ADMIN_HASHES || '').split(',').includes(hash);
}

function normalizePage(raw) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return null;
  if (p.endsWith('/')) p += 'index.html';
  if (!p.endsWith('.html')) p += '.html';
  return PAGES.includes(p) ? p : null;
}

/* Fails closed. A blip reaching siteverify refuses the post rather than
   crashing the worker or waving the post through unverified. */
async function verifyTurnstile(env, token, ip) {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const verdict = await res.json();
    if (!verdict.success) return false;
    /* Defense in depth on top of the sitekey's own domain lock: if a host
       allow-list is configured, the token must have been solved on one. */
    const allow = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
    if (allow.length && !allow.includes(verdict.hostname)) {
      console.log(JSON.stringify({ event: 'turnstile_hostname', hostname: verdict.hostname }));
      return false;
    }
    return true;
  } catch (err) {
    console.log(JSON.stringify({ event: 'siteverify_failed', error: String(err) }));
    return false;
  }
}

/* The topic row carries denormalized replies and last_at so category
   pages read topic rows alone. Recomputed, never incremented, from the
   indexed replies whenever anything in the thread mutates, so the numbers
   cannot drift. */
async function refreshTopicStats(env, topicId) {
  await env.DB.prepare(
    'UPDATE comments SET ' +
    "replies = (SELECT COUNT(*) FROM comments r WHERE r.parent_id = ?1 AND r.status = 'live'), " +
    "last_at = (SELECT MAX(c2.created_at) FROM comments c2 WHERE (c2.id = ?1 OR c2.parent_id = ?1) AND c2.status = 'live') " +
    'WHERE id = ?1'
  ).bind(topicId).run();
}

async function isTrusted(env, hash) {
  if (!hash) return false;
  const row = await env.DB.prepare('SELECT 1 AS t FROM trusted WHERE hash = ?1').bind(hash).first();
  return !!row;
}

/* The one gate every keyed write passes through: a locked identity, a banned
   IP, or a legacy ban. Returns null when clear, else the reason a keyed
   endpoint hands back as {blocked}. Public reads never call this, so cached
   and anonymous browsing is untouched. */
async function blockedReason(env, hash, ip) {
  const row = await env.DB.prepare(
    "SELECT 'locked' AS r FROM locks WHERE hash = ?1 " +
    "UNION ALL SELECT 'ipban' FROM ip_bans WHERE ip = ?2 " +
    "UNION ALL SELECT 'banned' FROM bans WHERE hash = ?1 LIMIT 1"
  ).bind(hash || '-', ip || '-').first();
  return row ? row.r : null;
}

function blockedJson(reason) {
  return json({ ok: false, blocked: reason, error: 'Interaction is not available.' }, 403);
}

/* Returns {status, verdict}. Anything unscreenable is held pending: the
   failure mode must be a delay for the poster, never a silent publish.
   A trusted author skips the screen entirely, though hold-all, the
   emergency brake, still holds everyone, and bans are checked upstream. */
async function screen(env, body, trusted) {
  const mode = env.MODERATION_MODE || 'ai';
  if (mode === 'hold-all') return { status: 'pending', verdict: 'hold-all' };
  if (trusted) return { status: 'live', verdict: 'trusted' };
  if (mode === 'off') return { status: 'live', verdict: 'off' };
  const links = (body.match(/https?:\/\//gi) || []).length;
  if (links >= 3) return { status: 'pending', verdict: 'links:' + links };
  try {
    const result = await env.AI.run('@cf/meta/llama-guard-3-8b', {
      messages: [{ role: 'user', content: body }],
    });
    const text = String(result && result.response != null ? result.response : '').trim();
    if (text.toLowerCase().startsWith('safe')) return { status: 'live', verdict: 'safe' };
    return { status: 'pending', verdict: text.slice(0, 100) || 'unsafe' };
  } catch (err) {
    console.log(JSON.stringify({ event: 'ai_failed', error: String(err) }));
    return { status: 'pending', verdict: 'ai-error' };
  }
}

/* Where a human clicks to see the comment: the page anchor for site
   comments, the topic view for board posts. */
function viewLink(page, id, parentId) {
  if (page.indexOf('board:') === 0) {
    return SITE + '/community.html?topic=' + (parentId || id) + '#comment-' + id;
  }
  return SITE + page + '#comment-' + id;
}

/* Comment email notifications were retired: the owner watches recent activity
   through the RSS feeds and the Activity Audit page instead. viewLink stays,
   the RSS builder still uses it. */

/* Two browser-cache profiles on the read endpoints. Keyed visitors ask
   for the fresh one with ?fresh=1 and live as they always have. Anonymous
   readers ride a five-minute cache, their repeat views never reaching the
   worker at all. */
function cacheHeader(url) {
  return { 'Cache-Control': 'public, max-age=' + (url.searchParams.get('fresh') ? 60 : 300) };
}

async function handleGet(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = normalizePage(url.searchParams.get('page'));
  if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  const rows = await env.DB.prepare(
    'SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, c.body, c.created_at, c.edited_at ' +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.page = ?1 AND c.status = 'live' ORDER BY c.id LIMIT 500"
  ).bind(page).all();
  return json({ ok: true, anon: env.ALLOW_ANON === 'true', comments: rows.results }, 200,
    cacheHeader(url));
}

async function handlePost(request, env, ctx) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }

  /* Honeypot field. Bots fill it, people never see it. Pretend success. */
  if (data.website) return json({ ok: true, status: 'live' }, 200);

  /* Throttle before any lookup work, so a flood cannot cost a DB read per
     request before the limit engages. */
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many comments at once. Wait a minute and try again.' }, 429);

  /* Three targets share this pipeline: a site page, a new board topic
     under a category, or a reply to an existing topic. */
  let page = null;
  let parentId = null;
  let title = null;
  if (data.topic != null) {
    const topicId = Number(data.topic);
    if (!Number.isInteger(topicId) || topicId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
    const topic = await env.DB.prepare(
      "SELECT id, page, locked FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
    ).bind(topicId).first();
    if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
    if (topic.locked) return json({ ok: false, error: 'This topic is locked.' }, 403);
    page = topic.page;
    parentId = topic.id;
  } else if (data.cat != null) {
    page = boardKey('board:' + String(data.cat));
    if (!page) return json({ ok: false, error: 'Unknown category.' }, 400);
    title = String(data.title || '').replace(/\s+/g, ' ').trim();
    if (title.length < 3) return json({ ok: false, error: 'The topic needs a title.' }, 400);
    if (title.length > MAX_TITLE) return json({ ok: false, error: 'The title is too long.' }, 400);
    if (CONTROL_RE.test(title)) return json({ ok: false, error: 'Bad request.' }, 400);
  } else {
    page = normalizePage(data.page);
    if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  }

  if (!String(data.key || '') && env.ALLOW_ANON !== 'true') {
    return json({ ok: false, error: 'Comments here need an identity. Create one with the link above the box.' }, 400);
  }

  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The comment is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'The comment is too long.' }, 400);
  /* Control characters other than newline and tab are nothing a person types. */
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);

  if (!(await verifyTurnstile(env, String(data.token || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }

  const key = String(data.key || '');
  const authorHash = key ? await sha256hex(key) : null;
  const ua = String(request.headers.get('User-Agent') || '').slice(0, 400);
  const os = parseOS(ua);
  const lang = String(request.headers.get('Accept-Language') || '').slice(0, 100);
  const tzRaw = String(data.tz || '');
  const tz = /^[A-Za-z0-9_+\/-]{1,60}$/.test(tzRaw) ? tzRaw : '';

  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);

  /* A topic's title is screened with its body, one judgment for the pair. */
  const { status, verdict } = await screen(env, title ? title + '\n\n' + body : body,
    await isTrusted(env, authorHash));
  const createdAt = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(
    'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, ai_verdict, ip, ua, os, tz, lang) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id'
  ).bind(page, parentId, title, authorHash, body, status, createdAt, verdict, ip || null, ua || null, os || null,
    tz || null, lang || null).first();

  if (boardKey(page)) await refreshTopicStats(env, parentId || inserted.id);

  /* Carry the poster's own nick and signature back so their fresh comment
     renders with them at once, before any cache refresh. */
  const prof = authorHash ? await env.DB.prepare('SELECT nick, signature, avatar FROM profiles WHERE hash = ?1').bind(authorHash).first() : null;
  return json({ ok: true, status, comment: { id: comment.id, title, author_hash: authorHash,
    nick: prof && prof.nick || null, signature: prof && prof.signature || null, avatar: prof && prof.avatar || null,
    body, created_at: createdAt } }, 200);
}

async function handleSelfDelete(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const id = Number(data.id);
  const key = String(data.key || '');
  if (!Number.isInteger(id) || id < 1 || !key) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  const isAdmin = isAdminHash(env, authorHash);
  const row = isAdmin
    ? await env.DB.prepare(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND status != 'deleted' RETURNING page, parent_id"
      ).bind(id).first()
    : await env.DB.prepare(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted' RETURNING page, parent_id"
      ).bind(id, authorHash).first();
  if (!row) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  if (boardKey(row.page)) await refreshTopicStats(env, row.parent_id || id);
  return json({ ok: true }, 200);
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* RSS 2.0 feed of a page's live comments, so anyone can follow a thread
   with a feed reader and nobody has to hand this site an email address. */
async function handleFeed(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return new Response('Too many requests.', { status: 429 });
  const cat = url.searchParams.get('cat');
  const topicParam = Number(url.searchParams.get('topic'));
  let page, results, topicRow = null;
  if (Number.isInteger(topicParam) && topicParam > 0) {
    /* A single thread's feed: the topic and its live replies, so anyone
       can follow one conversation, their own included. */
    topicRow = await env.DB.prepare(
      "SELECT id, page, title FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
    ).bind(topicParam).first();
    if (!topicRow || !boardKey(topicRow.page)) return new Response('No such topic.', { status: 404 });
    page = topicRow.page;
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
      "WHERE (c.id = ?1 OR c.parent_id = ?1) AND c.status = 'live' ORDER BY c.id DESC LIMIT 50"
    ).bind(topicParam).all();
    results = rows.results;
  } else {
    page = cat ? boardKey('board:' + cat) : normalizePage(url.searchParams.get('page'));
    if (!page) return new Response('Unknown page.', { status: 400 });
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.page = ?1 AND c.status = 'live' ORDER BY c.id DESC LIMIT 50"
    ).bind(page).all();
    results = rows.results;
  }
  const items = results.map(function (c) {
    const name = c.nick || (c.author_hash ? displayName(c.author_hash) : 'Anonymous');
    const link = viewLink(page, c.id, c.parent_id);
    const itemTitle = c.title ? c.title
      : topicRow ? name + ' re: ' + topicRow.title
      : name + ' on ' + page;
    return '<item><title>' + xmlEscape(itemTitle) + '</title>' +
      '<link>' + xmlEscape(link) + '</link>' +
      '<guid isPermaLink="true">' + xmlEscape(link) + '</guid>' +
      '<pubDate>' + new Date(c.created_at * 1000).toUTCString() + '</pubDate>' +
      '<description>' + xmlEscape(c.body) + '</description></item>';
  }).join('');
  const isBoard = page.indexOf('board:') === 0;
  const feedTitle = topicRow
    ? topicRow.title + ' - Catholicity Board - merecatholicity.com'
    : isBoard
    ? 'Catholicity Board - ' + page.slice(6) + ' - merecatholicity.com'
    : 'Comments on ' + page + ' - merecatholicity.com';
  const feedLink = topicRow ? SITE + '/community.html?topic=' + topicRow.id
    : isBoard ? SITE + '/community.html?cat=' + page.slice(6) : SITE + page;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0"><channel>' +
    '<title>' + xmlEscape(feedTitle) + '</title>' +
    '<link>' + xmlEscape(feedLink) + '</link>' +
    '<description>' + xmlEscape(isBoard ? 'Topics and replies' : 'Reader comments on ' + page) + '</description>' +
    items + '</channel></rss>';
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
  });
}

/* Author-only editing. The key must hash to the comment's own author,
   admins included only for their own comments. Every edit passes the same
   screen as a new post, or a clean comment could be edited into filth
   after approval, and a flagged edit drops the comment to pending. */
async function handleEdit(request, env, ctx) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const id = Number(data.id);
  const key = String(data.key || '');
  if (!Number.isInteger(id) || id < 1 || !key) return json({ ok: false, error: 'Bad request.' }, 400);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The comment is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'The comment is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many edits at once. Wait a minute and try again.' }, 429);
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  const row = await env.DB.prepare(
    "SELECT page, parent_id, title, ip, ua, os, tz, lang, created_at FROM comments WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted'"
  ).bind(id, authorHash).first();
  if (!row) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  const { status, verdict } = await screen(env, body, await isTrusted(env, authorHash));
  const editedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE comments SET body = ?1, status = ?2, ai_verdict = ?3, edited_at = ?4 WHERE id = ?5'
  ).bind(body, status, verdict, editedAt, id).run();
  if (boardKey(row.page)) await refreshTopicStats(env, row.parent_id || id);
  return json({ ok: true, status, edited_at: editedAt }, 200);
}

/* Admin-only view of the logged metadata. The public GET never carries
   these fields; this endpoint demands a key hashing into ADMIN_HASHES. */
async function handleMeta(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const page = normalizePage(data.page) || boardKey(data.page);
  const key = String(data.key || '');
  if (!page || !key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!isAdminHash(env, await sha256hex(key))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare(
    'SELECT c.id, c.status, c.ai_verdict, c.ip, c.ua, c.os, c.tz, c.lang, c.author_hash, ' +
    'CASE WHEN t.hash IS NULL THEN 0 ELSE 1 END AS trusted, ' +
    'CASE WHEN lk.hash IS NULL THEN 0 ELSE 1 END AS locked, ' +
    'CASE WHEN ib.ip IS NULL THEN 0 ELSE 1 END AS ipbanned ' +
    'FROM comments c LEFT JOIN trusted t ON t.hash = c.author_hash ' +
    'LEFT JOIN locks lk ON lk.hash = c.author_hash ' +
    'LEFT JOIN ip_bans ib ON ib.ip = c.ip ' +
    'WHERE c.page = ?1 ORDER BY c.id LIMIT 500'
  ).bind(page).all();
  return json({ ok: true, meta: rows.results }, 200);
}

/* The board index: per-category topic and post counts with last activity. */
async function handleBoardIndex(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  /* One pass: per room, window counts plus the newest post whose thread
     is still live, its title borrowed from the thread. */
  const rows = await env.DB.prepare(
    'SELECT page, author_hash, nick, created_at, title, topic_id, topics, posts FROM (' +
    '  SELECT c.page, c.author_hash, pr.nick AS nick, c.created_at, ' +
    '         COALESCE(c.title, p.title) AS title, ' +
    '         COALESCE(c.parent_id, c.id) AS topic_id, ' +
    '         COUNT(CASE WHEN c.parent_id IS NULL THEN 1 END) OVER (PARTITION BY c.page) AS topics, ' +
    '         COUNT(*) OVER (PARTITION BY c.page) AS posts, ' +
    '         ROW_NUMBER() OVER (PARTITION BY c.page ORDER BY c.id DESC) AS rn ' +
    '  FROM comments c LEFT JOIN comments p ON p.id = c.parent_id ' +
    '         LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "  WHERE c.page LIKE 'board:%' AND c.status = 'live' " +
    "    AND (c.parent_id IS NULL OR p.status = 'live')" +
    ') WHERE rn = 1'
  ).all();
  const cats = {};
  rows.results.forEach(function (r) {
    cats[r.page.slice(6)] = {
      topics: r.topics,
      posts: r.posts,
      last: r.created_at,
      latest: { topic_id: r.topic_id, title: r.title, author_hash: r.author_hash, nick: r.nick, created_at: r.created_at },
    };
  });
  return json({ ok: true, cats }, 200, cacheHeader(url));
}

/* One category page: twenty topics by newest activity, read from the
   denormalized topic rows alone, the replies never scanned. */
const TOPICS_PER_PAGE = 20;
async function handleBoardCat(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = boardKey('board:' + url.searchParams.get('cat'));
  if (!page) return json({ ok: false, error: 'Unknown category.' }, 400);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const total = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE page = ?1 AND parent_id IS NULL AND status = 'live'"
  ).bind(page).first();
  const rows = await env.DB.prepare(
    'SELECT c.id, c.title, c.author_hash, pr.nick, c.created_at, c.locked, ' +
    'COALESCE(c.replies, 0) AS replies, COALESCE(c.last_at, c.created_at) AS last ' +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.page = ?1 AND c.parent_id IS NULL AND c.status = 'live' " +
    'ORDER BY last DESC LIMIT ?2 OFFSET ?3'
  ).bind(page, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all();
  return json({ ok: true, topics: rows.results, total: total.n, page: p, per: TOPICS_PER_PAGE }, 200, cacheHeader(url));
}

/* One topic with its live replies in order. */
async function handleTopicView(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const topic = await env.DB.prepare(
    "SELECT c.id, c.page, c.title, c.author_hash, pr.nick, pr.signature, pr.avatar, c.body, c.created_at, c.edited_at, c.locked, c.replies " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live'"
  ).bind(id).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  /* Twenty replies a page. A permalink arrives with find=<reply id> and
     one indexed count places it on the right page. */
  let p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const find = Number(url.searchParams.get('find'));
  if (Number.isInteger(find) && find > 0 && !url.searchParams.get('p')) {
    const pos = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE parent_id = ?1 AND status = 'live' AND id < ?2"
    ).bind(id, find).first();
    p = Math.floor(pos.n / TOPICS_PER_PAGE) + 1;
  }
  const replies = await env.DB.prepare(
    "SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, c.body, c.created_at, c.edited_at FROM comments c " +
    "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.parent_id = ?1 AND c.status = 'live' ORDER BY c.id LIMIT ?2 OFFSET ?3"
  ).bind(id, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all();
  return json({
    ok: true,
    anon: env.ALLOW_ANON === 'true',
    cat: topic.page.slice(6),
    topic: { id: topic.id, title: topic.title, author_hash: topic.author_hash, nick: topic.nick, signature: topic.signature, avatar: topic.avatar, body: topic.body, created_at: topic.created_at, edited_at: topic.edited_at, locked: topic.locked ? 1 : 0 },
    replies: replies.results,
    total: topic.replies || 0,
    page: p,
    per: TOPICS_PER_PAGE,
  }, 200, cacheHeader(url));
}

/* Admin-only topic moderation from the page: lock and unlock close and
   reopen a thread to new replies, delete takes the topic down. */
async function handleModerate(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  const act = String(data.act || '');
  if (!key || !Number.isInteger(id) || id < 1 || !['lock', 'unlock', 'delete'].includes(act)) {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  if (!isAdminHash(env, await sha256hex(key))) return json({ ok: false, error: 'No.' }, 403);
  const topic = await env.DB.prepare(
    "SELECT id, page FROM comments WHERE id = ?1 AND parent_id IS NULL AND status != 'deleted'"
  ).bind(id).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  if (act === 'delete') {
    await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?1").bind(id).run();
    return json({ ok: true, deleted: true }, 200);
  }
  const locked = act === 'lock' ? 1 : 0;
  await env.DB.prepare('UPDATE comments SET locked = ?1 WHERE id = ?2').bind(locked, id).run();
  return json({ ok: true, locked: locked }, 200);
}

/* Admin-only trust toggle. A trusted author's posts skip the AI screen.
   The flag lives by fingerprint and its holder never learns it exists. */
async function handleTrust(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!isAdminHash(env, await sha256hex(key))) return json({ ok: false, error: 'No.' }, 403);
  if (data.trusted) {
    await env.DB.prepare('INSERT OR IGNORE INTO trusted (hash, created_at) VALUES (?1, ?2)')
      .bind(hash, Math.floor(Date.now() / 1000)).run();
  } else {
    await env.DB.prepare('DELETE FROM trusted WHERE hash = ?1').bind(hash).run();
  }
  return json({ ok: true, trusted: !!data.trusted }, 200);
}

/* Admin-only activity audit: the newest non-deleted post on every site
   page and in every board topic, author and moment, nothing else. Pending
   posts count as activity, they are exactly what an admin wants to see. */
async function handleAudit(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!isAdminHash(env, await sha256hex(key))) return json({ ok: false, error: 'No.' }, 403);
  /* Two weeks of activity in each of the two worlds, newest first, each row
     carrying what the client needs to build a jump link straight to it. A
     generous cap the client shows through a scroll box, so the admin sees the
     latest at a glance and reaches the rest by scrolling. */
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const pages = await env.DB.prepare(
    "SELECT c.id, c.page, c.author_hash, pr.nick, c.created_at, c.status, substr(c.body, 1, 160) AS snippet " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.page NOT LIKE 'board:%' AND c.status != 'deleted' AND c.created_at > ?1 " +
    "ORDER BY c.id DESC LIMIT 300"
  ).bind(since).all();
  const topics = await env.DB.prepare(
    "SELECT c.id, c.page, c.author_hash, pr.nick, c.created_at, c.status, substr(c.body, 1, 160) AS snippet, " +
    "COALESCE(c.parent_id, c.id) AS topic_id, COALESCE(c.title, t.title) AS title " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) " +
    "WHERE c.page LIKE 'board:%' AND c.status != 'deleted' AND c.created_at > ?1 " +
    "ORDER BY c.id DESC LIMIT 300"
  ).bind(since).all();
  return json({ ok: true, pages: pages.results, topics: topics.results, days: 14 }, 200);
}

const MAX_NICK = 40;
const MAX_BIO = 500;
const MAX_SIG = 200;

/* Public read of a profile: the custom fields plus the assigned pseudonym,
   never any private fingerprint or trust/ban state. Missing profile still
   answers, with null fields, so any hash resolves to at least its name. */
async function handleProfileGet(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const hash = String(url.searchParams.get('hash') || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const row = await env.DB.prepare('SELECT nick, bio, signature, avatar FROM profiles WHERE hash = ?1').bind(hash).first();
  return json({
    ok: true,
    profile: {
      hash: hash,
      nick: row ? (row.nick || null) : null,
      bio: row ? (row.bio || null) : null,
      signature: row ? (row.signature || null) : null,
      avatar: row ? (row.avatar || null) : null,
      assigned: displayName(hash),
      admin: isAdminHash(env, hash),
    },
  }, 200, cacheHeader(url));
}

/* One profile field, normalized like a comment body: CRLF folded, trimmed,
   control characters (bar newline and tab) refused. Empty becomes null,
   which clears the field and falls the name back to the assigned pseudonym. */
function cleanField(raw, max) {
  const v = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (v.length > max) return { error: true };
  if (CONTROL_RE.test(v)) return { error: true };
  return { value: v || null };
}

/* Owner-writable profile: the key must hash to the profile's own hash, so a
   profile is only ever edited by its holder. The three fields are screened as
   one blob and rejected outright when flagged (a profile has no pending
   state); an unscreenable blob is allowed, being low-risk and admin-clearable. */
async function handleProfileSave(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'An identity is required.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many changes at once. Wait a minute and try again.' }, 429);
  /* Same Turnstile gate as posting: a profile is public text a bot could
     otherwise write with a self-made key and no challenge. */
  if (!(await verifyTurnstile(env, String(data.token || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const nick = cleanField(data.nick, MAX_NICK);
  const bio = cleanField(data.bio, MAX_BIO);
  const signature = cleanField(data.signature, MAX_SIG);
  if (nick.error || bio.error || signature.error) {
    return json({ ok: false, error: 'That profile is too long or has stray characters.' }, 400);
  }
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  const blob = [nick.value, bio.value, signature.value].filter(Boolean).join('\n');
  if (blob) {
    const { status, verdict } = await screen(env, blob, await isTrusted(env, authorHash));
    if (status !== 'live' && verdict !== 'ai-error') {
      return json({ ok: false, error: 'That text was flagged. Please revise it.' }, 400);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO profiles (hash, nick, bio, signature, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ' +
    'ON CONFLICT(hash) DO UPDATE SET nick = ?2, bio = ?3, signature = ?4, updated_at = ?5'
  ).bind(authorHash, nick.value, bio.value, signature.value, now).run();
  /* The text upsert leaves the avatar column alone; return its standing value
     so the client's re-render keeps the picture. */
  const av = await env.DB.prepare('SELECT avatar FROM profiles WHERE hash = ?1').bind(authorHash).first();
  return json({
    ok: true,
    profile: { hash: authorHash, nick: nick.value, bio: bio.value, signature: signature.value,
      avatar: av && av.avatar || null,
      assigned: displayName(authorHash), admin: isAdminHash(env, authorHash) },
  }, 200);
}

/* Admin-only: wipe an abusive profile back to the assigned pseudonym without
   banning the author. Bans still only stop posting. */
async function handleProfileClear(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!isAdminHash(env, await sha256hex(key))) return json({ ok: false, error: 'No.' }, 403);
  if (env.AVATARS) await env.AVATARS.delete('avatars/' + hash);
  await env.DB.prepare('UPDATE profiles SET nick = NULL, bio = NULL, signature = NULL, avatar = NULL, updated_at = ?2 WHERE hash = ?1')
    .bind(hash, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* ---- Direct messages. Strictly 1v1, private to the two keys involved: every
   read is a POST carrying the key, nothing is cacheable, and no admin door
   exists. A thread is unread for me when its last word is someone else's and
   newer than my read stamp. ---- */

const DM_PER_PAGE = 20;

function dmPair(h1, h2) {
  return h1 < h2 ? [h1, h2] : [h2, h1];
}

/* Visibility is per viewer: everyone sees the unheld, and a sender always
   sees their own words, held or not. ?1 must be bound to the viewer's hash
   wherever this fragment appears. */
const DM_VIS = "(COALESCE(m.held, 0) = 0 OR m.sender_hash = ?1)";

/* Unread, per viewer: an unheld message from someone else, newer than my
   read stamp. Held messages can never trip the recipient's badge. */
const DM_UNREAD_EXISTS =
  'EXISTS(SELECT 1 FROM dms m WHERE m.thread_id = t.id AND COALESCE(m.held, 0) = 0 ' +
  'AND m.sender_hash != ?1 ' +
  'AND m.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_read_at ELSE t.b_read_at END, 0))';

/* Send. The same wall as posting: throttle, ban, Turnstile. A block by the
   recipient does NOT refuse the send: the message is stored held, reads as
   delivered to its sender, and stays invisible to the recipient until an
   unblock releases it. The blocked party is never told. */
async function handleDmSend(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many messages at once. Wait a minute and try again.' }, 429);
  const key = String(data.key || '');
  const to = String(data.to || '');
  if (!key || !/^[0-9a-f]{64}$/.test(to)) return json({ ok: false, error: 'Bad request.' }, 400);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The message is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'The message is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === to) return json({ ok: false, error: 'That would be a soliloquy.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const blockRow = await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2')
    .bind(to, me).first();
  const held = blockRow ? 1 : 0;
  if (!(await verifyTurnstile(env, String(data.token || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const [a, b] = dmPair(me, to);
  const now = Math.floor(Date.now() / 1000);
  const myReadCol = me === a ? 'a_read_at' : 'b_read_at';
  /* A held send must leave the recipient's world untouched: the thread's
     last-word fields stay as they were, so nothing bumps, nothing rings. */
  const thread = held
    ? await env.DB.prepare(
        'INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES (?1, ?2, ?3, ?3, ?4, 0) ' +
        'ON CONFLICT(a_hash, b_hash) DO UPDATE SET last_at = last_at RETURNING id'
      ).bind(a, b, now, me).first()
    : await env.DB.prepare(
        'INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES (?1, ?2, ?3, ?3, ?4, 0) ' +
        'ON CONFLICT(a_hash, b_hash) DO UPDATE SET last_at = ?3, last_sender = ?4 RETURNING id'
      ).bind(a, b, now, me).first();
  const msg = await env.DB.prepare(
    'INSERT INTO dms (thread_id, sender_hash, body, created_at, held) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id'
  ).bind(thread.id, me, body, now, held).first();
  if (!held) {
    /* Recomputed, never incremented, over the visible words alone, and the
       sender's own stamp rides along: what you just said is read by you. */
    await env.DB.prepare(
      'UPDATE dm_threads SET msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
      myReadCol + ' = ?2 WHERE id = ?1'
    ).bind(thread.id, now).run();
  }
  return json({ ok: true, id: msg.id, thread_id: thread.id, created_at: now }, 200);
}

/* Inbox: my threads by newest activity, the other party resolved with their
   nick and avatar, and the total unread count riding along so one call feeds
   both the list and the badge. */
async function handleDmThreads(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  /* Everything per viewer: counts and last-activity over the words this
     reader may see, and a thread whose every word is held reads as absent. */
  const inner =
    'SELECT t.id, ' +
    'CASE WHEN t.a_hash = ?1 THEN t.b_hash ELSE t.a_hash END AS other_hash, ' +
    'pr.nick, pr.avatar, ' +
    '(SELECT COUNT(*) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ') AS msgs, ' +
    '(SELECT MAX(m.created_at) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ') AS last_at, ' +
    'CASE WHEN ' + DM_UNREAD_EXISTS + ' THEN 1 ELSE 0 END AS unread ' +
    'FROM dm_threads t LEFT JOIN profiles pr ON pr.hash = CASE WHEN t.a_hash = ?1 THEN t.b_hash ELSE t.a_hash END ' +
    'WHERE t.a_hash = ?1 OR t.b_hash = ?1';
  const rows = await env.DB.prepare(
    'SELECT * FROM (' + inner + ') WHERE msgs > 0 ORDER BY last_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, DM_PER_PAGE, (p - 1) * DM_PER_PAGE).all();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(unread), 0) AS unread FROM (' + inner + ') WHERE msgs > 0'
  ).bind(me).first();
  return json({ ok: true, threads: rows.results, total: totals.n || 0,
    unread_total: totals.unread || 0, page: p, per: DM_PER_PAGE }, 200);
}

/* One conversation, paged by twenty like everything else, defaulting to the
   LAST page so it opens at its newest words. Opening marks it read with at
   most one write, none when nothing was unread. */
async function handleDmThread(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const other = String(data.with || '');
  if (!key || !/^[0-9a-f]{64}$/.test(other)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === other) return json({ ok: false, error: 'Bad request.' }, 400);
  const [a, b] = dmPair(me, other);
  const thread = await env.DB.prepare(
    'SELECT id, msgs, last_at, last_sender, a_read_at, b_read_at FROM dm_threads WHERE a_hash = ?1 AND b_hash = ?2'
  ).bind(a, b).first();
  const prof = await env.DB.prepare('SELECT nick, avatar FROM profiles WHERE hash = ?1').bind(other).first();
  const iBlocked = await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2')
    .bind(me, other).first();
  if (!thread) {
    /* No words yet: an empty room, ready for the first message. */
    return json({ ok: true, thread_id: null, other: { hash: other, nick: prof && prof.nick || null, avatar: prof && prof.avatar || null },
      messages: [], total: 0, page: 1, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0 }, 200);
  }
  /* The total and the pages are the viewer's own: held words count for
     their sender and for nobody else. */
  const totRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dms m WHERE m.thread_id = ?2 AND ' + DM_VIS
  ).bind(me, thread.id).first();
  const total = totRow.n || 0;
  const lastPage = Math.max(1, Math.ceil(total / DM_PER_PAGE));
  const p = data.p == null ? lastPage : Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  const msgs = await env.DB.prepare(
    'SELECT m.id, m.sender_hash, m.body, m.created_at FROM dms m WHERE m.thread_id = ?2 AND ' + DM_VIS +
    ' ORDER BY m.id LIMIT ?3 OFFSET ?4'
  ).bind(me, thread.id, DM_PER_PAGE, (p - 1) * DM_PER_PAGE).all();
  const myReadCol = me === a ? 'a_read_at' : 'b_read_at';
  /* One conditional write: only when a visible word from the other side is
     newer than my stamp. Held words never trigger it. */
  await env.DB.prepare(
    'UPDATE dm_threads SET ' + myReadCol + ' = ?2 WHERE id = ?3 AND EXISTS(' +
    'SELECT 1 FROM dms m WHERE m.thread_id = ?3 AND COALESCE(m.held, 0) = 0 AND m.sender_hash != ?1 ' +
    'AND m.created_at > COALESCE(' + myReadCol + ', 0))'
  ).bind(me, Math.floor(Date.now() / 1000), thread.id).run();
  return json({ ok: true, thread_id: thread.id,
    other: { hash: other, nick: prof && prof.nick || null, avatar: prof && prof.avatar || null },
    messages: msgs.results, total: total, page: p, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0 }, 200);
}

/* The badge count: unread threads, one indexed COUNT. The client asks at most
   once per ninety seconds, so this stays cheap on every side. */
async function handleDmUnread(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  /* The reliable catch for a logged-in reader: this poll fires on every keyed
     page load, so a lock or IP ban logs them out on their next page turn. */
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dm_threads t WHERE (t.a_hash = ?1 OR t.b_hash = ?1) AND ' + DM_UNREAD_EXISTS
  ).bind(me).first();
  return json({ ok: true, unread: row.n || 0 }, 200);
}

/* Block and unblock, owner-side only. */
async function handleDmBlock(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (data.blocked) {
    await env.DB.prepare('INSERT OR IGNORE INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(me, hash, Math.floor(Date.now() / 1000)).run();
  } else {
    /* Unblocking delivers the flood: every word held during the block is
       released with its original timestamp, and the thread's last-word
       fields catch up so the inbox and the badge finally ring. */
    const [a, b] = dmPair(me, hash);
    const t = await env.DB.prepare('SELECT id FROM dm_threads WHERE a_hash = ?1 AND b_hash = ?2').bind(a, b).first();
    if (t) {
      const mn = await env.DB.prepare(
        'SELECT MIN(created_at) AS mn FROM dms WHERE thread_id = ?1 AND sender_hash = ?2 AND COALESCE(held, 0) = 1'
      ).bind(t.id, hash).first();
      await env.DB.prepare(
        'UPDATE dms SET held = 0 WHERE thread_id = ?1 AND sender_hash = ?2 AND COALESCE(held, 0) = 1'
      ).bind(t.id, hash).run();
      /* The released words keep their original times, which may sit behind
         my read stamp; wind the stamp back so the delivery still rings. */
      if (mn && mn.mn != null) {
        const myReadCol = me === a ? 'a_read_at' : 'b_read_at';
        await env.DB.prepare(
          'UPDATE dm_threads SET ' + myReadCol + ' = ?2 WHERE id = ?1 AND ' + myReadCol + ' IS NOT NULL AND ' + myReadCol + ' >= ?2'
        ).bind(t.id, mn.mn - 1).run();
      }
      await env.DB.prepare(
        'UPDATE dm_threads SET ' +
        'msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
        'last_at = COALESCE((SELECT MAX(created_at) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), last_at), ' +
        'last_sender = COALESCE((SELECT sender_hash FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0 ORDER BY id DESC LIMIT 1), last_sender) ' +
        'WHERE id = ?1'
      ).bind(t.id).run();
    }
    await env.DB.prepare('DELETE FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2').bind(me, hash).run();
  }
  return json({ ok: true, blocked: !!data.blocked }, 200);
}

/* The autocomplete corpus: every hash that has ever appeared publicly, with
   its nick when one is set. Assigned names are derived client-side from the
   hash, so they are not sent. Public-by-construction data, cacheable. */
async function handleDmDirectory(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const rows = await env.DB.prepare(
    'SELECT u.hash, pr.nick FROM (' +
    "  SELECT DISTINCT author_hash AS hash FROM comments WHERE author_hash IS NOT NULL AND status != 'deleted' " +
    '  UNION SELECT hash FROM profiles' +
    ') u LEFT JOIN profiles pr ON pr.hash = u.hash LIMIT 2000'
  ).all();
  return json({ ok: true, users: rows.results }, 200, cacheHeader(url));
}

/* ---- Avatars. One 400x400 raster image per identity, stored in R2 under
   avatars/<hash>, so an upload overwrites the old file and storage stays
   pruned by construction. The server trusts nothing from the client: bytes
   are sniffed for PNG/JPEG/WebP magic (never SVG, which can carry script),
   dimensions are read from the image header itself, and the stored
   content-type is the sniffed one. ---- */

const MAX_AVATAR_BYTES = 500 * 1024;
const AVATAR_SIZE = 400;

function be16(b, i) { return (b[i] << 8) | b[i + 1]; }

/* Returns {mime, width, height} or null. Only the three raster formats a
   browser canvas emits are recognized; everything else is refused. */
function sniffImage(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) {
    return { mime: 'image/png',
      width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0,
      height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
  }
  if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) return null;
      const marker = b[i + 1];
      if (marker === 0xFF) { i++; continue; }
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { mime: 'image/jpeg', width: be16(b, i + 7), height: be16(b, i + 5) };
      }
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      i += 2 + be16(b, i + 2);
    }
    return null;
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8 ' && b[23] === 0x9D && b[24] === 0x01 && b[25] === 0x2A) {
      return { mime: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3FFF, height: (b[28] | (b[29] << 8)) & 0x3FFF };
    }
    if (tag === 'VP8L' && b[20] === 0x2F) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: 'image/webp', width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
    }
    if (tag === 'VP8X') {
      return { mime: 'image/webp',
        width: ((b[24] | (b[25] << 8) | (b[26] << 16)) + 1),
        height: ((b[27] | (b[28] << 8) | (b[29] << 16)) + 1) };
    }
  }
  return null;
}

/* Best-effort image moderation, the visual counterpart to the Llama Guard
   text screen. Returns true to allow, false to reject. Fails OPEN on an AI
   error: a throttled or broken model must not block every avatar, and the
   owner still sees and can clear any that slip through. Not a guarantee, and
   never a substitute for CSAM hash-scanning, which is a separate control. */
async function screenImage(env, bytes) {
  try {
    const result = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
      image: [...bytes],
      prompt: 'You are moderating a profile avatar. Does this image contain nudity, ' +
        'sexual or pornographic content, or graphic violence or gore? Answer with only ' +
        'one word: unsafe if it does, otherwise safe.',
      max_tokens: 16,
    });
    const text = String(result && result.description != null ? result.description : '').toLowerCase();
    return text.indexOf('unsafe') === -1;
  } catch (err) {
    console.log(JSON.stringify({ event: 'avatar_ai_failed', error: String(err) }));
    return true;
  }
}

/* Owner-only upload, multipart. The same gates as posting: rate limit, key,
   ban, Turnstile, and an AI vision screen. The write is a fixed-key overwrite,
   so the previous avatar is replaced in the same act and no orphan objects
   can accumulate. */
async function handleAvatarUpload(request, env) {
  if (!env.AVATARS) return json({ ok: false, error: 'Avatars are not enabled yet. Soon.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Wait a minute and try again.' }, 429);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES + 8192) {
    return json({ ok: false, error: 'The image is too large. 500 KB at most.' }, 413);
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'An identity is required.' }, 400);
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  if (!(await verifyTurnstile(env, String(form.get('token') || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const file = form.get('avatar');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'No image arrived.' }, 400);
  if (file.size > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 500 KB at most.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 500 KB at most.' }, 413);
  /* JPEG alone is stored, whatever any client claims or an old cached
     client sends. The canvas step upstream re-encodes every source to JPEG,
     so an honest upload always passes; everything else is refused here. */
  const img = sniffImage(bytes);
  if (!img || img.mime !== 'image/jpeg') return json({ ok: false, error: 'Avatars must be JPEG.' }, 400);
  if (img.width !== AVATAR_SIZE || img.height !== AVATAR_SIZE) {
    return json({ ok: false, error: 'The avatar must be exactly 400 by 400 pixels.' }, 400);
  }
  if (!(await screenImage(env, bytes))) {
    return json({ ok: false, error: 'That image was flagged and cannot be used as an avatar. Please choose another.' }, 400);
  }
  await env.AVATARS.put('avatars/' + authorHash, bytes, { httpMetadata: { contentType: img.mime } });
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO profiles (hash, avatar, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ' +
    'ON CONFLICT(hash) DO UPDATE SET avatar = ?2, updated_at = ?3'
  ).bind(authorHash, String(now), now).run();
  return json({ ok: true, avatar: String(now) }, 200);
}

/* Owner removes their own avatar: the object is deleted and the profile flag
   cleared. Same gates as self-deleting a comment. */
async function handleAvatarDelete(request, env) {
  if (!env.AVATARS) return json({ ok: false, error: 'Avatars are not enabled yet. Soon.' }, 503);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const authorHash = await sha256hex(key);
  await env.AVATARS.delete('avatars/' + authorHash);
  await env.DB.prepare('UPDATE profiles SET avatar = NULL, updated_at = ?2 WHERE hash = ?1')
    .bind(authorHash, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* Public read. Served with the content-type sniffed at upload, nosniff, and
   a deny-all CSP, so the bytes can never run as anything. Long browser cache;
   the URL carries the upload stamp as a cache-buster, so a new avatar is a
   new URL. No rate limiter: one page can hold many authors. */
async function handleAvatarGet(request, env, url) {
  if (!env.AVATARS) return new Response('No avatar.', { status: 404 });
  const hash = String(url.searchParams.get('hash') || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response('Bad request.', { status: 400 });
  const obj = await env.AVATARS.get('avatars/' + hash);
  if (!obj) return new Response('No avatar.', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

/* ---- Backups. A monthly cron dumps the whole database to one SQL file,
   gzips it, and drops it in the BACKUPS R2 bucket, keeping ninety days.
   Restore: download, gunzip, then
   deno run -A npm:wrangler d1 execute merecatholicity-comments --remote --file backup.sql ---- */

function sqlLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/* A restorable dump: every user table's CREATE (as IF NOT EXISTS) and rows,
   then the indexes. Explicit ids in the INSERTs carry the AUTOINCREMENT
   sequence along on their own. */
async function dumpDatabase(env) {
  const master = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL " +
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type = 'index', name"
  ).all();
  const parts = ['-- merecatholicity-comments backup ' + new Date().toISOString()];
  for (const m of master.results) {
    if (m.type === 'table') {
      parts.push(m.sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ') + ';');
      const rows = await env.DB.prepare('SELECT * FROM "' + m.name + '"').all();
      const rs = rows.results;
      if (!rs.length) continue;
      const cols = Object.keys(rs[0]);
      const colList = cols.map((c) => '"' + c + '"').join(', ');
      for (let i = 0; i < rs.length; i += 50) {
        const values = rs.slice(i, i + 50)
          .map((r) => '(' + cols.map((c) => sqlLit(r[c])).join(', ') + ')').join(',\n');
        parts.push('INSERT INTO "' + m.name + '" (' + colList + ') VALUES\n' + values + ';');
      }
    } else if (m.type === 'index') {
      parts.push(m.sql.replace(/^CREATE INDEX\s+/i, 'CREATE INDEX IF NOT EXISTS ') + ';');
    }
  }
  return parts.join('\n');
}

async function gzipBytes(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const BACKUP_KEEP_DAYS = 90;

async function runBackup(env) {
  if (!env.BACKUPS) return { error: 'BACKUPS bucket not bound; enable R2 and redeploy.' };
  const sql = await dumpDatabase(env);
  const gz = await gzipBytes(sql);
  const key = 'backups/comments-' + new Date().toISOString().slice(0, 10) + '.sql.gz';
  await env.BACKUPS.put(key, gz, { httpMetadata: { contentType: 'application/gzip' } });
  const list = await env.BACKUPS.list({ prefix: 'backups/' });
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400 * 1000;
  let pruned = 0;
  for (const obj of list.objects) {
    if (obj.key !== key && obj.uploaded.getTime() < cutoff) {
      await env.BACKUPS.delete(obj.key);
      pruned++;
    }
  }
  /* Mirror the avatar objects too, so all state rides in one bucket. Capped
     well under the free plan's per-invocation subrequest budget; the cap is
     logged when hit, never silent. Old mirror entries are left in place,
     which for a backup is a feature. */
  let avatarsMirrored = 0, avatarsSkipped = 0;
  if (env.AVATARS) {
    const avs = await env.AVATARS.list({ prefix: 'avatars/' });
    const MIRROR_CAP = 15;
    for (const o of avs.objects.slice(0, MIRROR_CAP)) {
      const obj = await env.AVATARS.get(o.key);
      if (!obj) continue;
      await env.BACKUPS.put('avatars-mirror/' + o.key.slice(8),
        await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
      avatarsMirrored++;
    }
    avatarsSkipped = Math.max(0, avs.objects.length - MIRROR_CAP);
    if (avatarsSkipped) console.log(JSON.stringify({ event: 'backup_avatar_cap', skipped: avatarsSkipped }));
  }
  const result = { key, sqlBytes: sql.length, gzBytes: gz.length, kept: list.objects.length - pruned, pruned, avatarsMirrored, avatarsSkipped };
  console.log(JSON.stringify({ event: 'backup', ...result }));
  return result;
}

/* Admin-only manual run of the same backup the cron performs, so the path
   can be exercised any day, not only on the first of the month. */
async function handleBackup(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!isAdminHash(env, await sha256hex(key))) return json({ ok: false, error: 'No.' }, 403);
  const result = await runBackup(env);
  return json({ ok: true, backup: result }, 200);
}

/* ---- In-platform moderation. Every control demands a key hashing into
   ADMIN_HASHES; the old signed email links are gone entirely. ---- */

async function requireAdmin(env, key) {
  return !!key && isAdminHash(env, await sha256hex(key));
}

/* Lock or unlock an identity: a reversible disable that logs the holder out
   and refuses every keyed interaction until reversed. */
async function handleLock(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  if (data.locked) {
    await env.DB.prepare('INSERT OR IGNORE INTO locks (hash, created_at) VALUES (?1, ?2)')
      .bind(hash, Math.floor(Date.now() / 1000)).run();
  } else {
    await env.DB.prepare('DELETE FROM locks WHERE hash = ?1').bind(hash).run();
  }
  return json({ ok: true, locked: !!data.locked }, 200);
}

/* Delete a user and all their public posts: comments go to 'deleted', the
   profile and avatar are removed, and the identity is locked so the same key
   cannot post again. Private DMs are left untouched. */
async function handleDeleteUser(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const affected = await env.DB.prepare(
    "SELECT DISTINCT COALESCE(parent_id, id) AS topic FROM comments " +
    "WHERE author_hash = ?1 AND page LIKE 'board:%' AND status != 'deleted'"
  ).bind(hash).all();
  await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE author_hash = ?1 AND status != 'deleted'")
    .bind(hash).run();
  await env.DB.prepare('DELETE FROM profiles WHERE hash = ?1').bind(hash).run();
  if (env.AVATARS) await env.AVATARS.delete('avatars/' + hash);
  await env.DB.prepare('INSERT OR IGNORE INTO locks (hash, created_at) VALUES (?1, ?2)')
    .bind(hash, Math.floor(Date.now() / 1000)).run();
  for (const r of affected.results) await refreshTopicStats(env, r.topic);
  return json({ ok: true }, 200);
}

function looksLikeIp(s) {
  return /^[0-9a-fA-F:.]{3,45}$/.test(s) && (s.indexOf('.') !== -1 || s.indexOf(':') !== -1);
}

/* Ban or unban a raw IP (v4 or v6). */
async function handleIpBan(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const cip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: cip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const ip = String(data.ip || '').trim();
  if (!looksLikeIp(ip)) return json({ ok: false, error: 'That is not a valid IP address.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  if (data.banned) {
    await env.DB.prepare('INSERT OR IGNORE INTO ip_bans (ip, created_at) VALUES (?1, ?2)')
      .bind(ip, Math.floor(Date.now() / 1000)).run();
  } else {
    await env.DB.prepare('DELETE FROM ip_bans WHERE ip = ?1').bind(ip).run();
  }
  return json({ ok: true, banned: !!data.banned }, 200);
}

/* The banned-IP list for the admin page. */
async function handleIpBans(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare('SELECT ip, created_at FROM ip_bans ORDER BY created_at DESC LIMIT 1000').all();
  return json({ ok: true, ips: rows.results }, 200);
}

/* Approve a held comment: the in-platform replacement for the old email link. */
async function handleApprove(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const row = await env.DB.prepare(
    "UPDATE comments SET status = 'live' WHERE id = ?1 AND status = 'pending' RETURNING page, parent_id"
  ).bind(id).first();
  if (row && boardKey(row.page)) await refreshTopicStats(env, row.parent_id || id);
  return json({ ok: true, approved: !!row }, 200);
}

/* The pending-review queue: every held comment, newest first. */
async function handlePending(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare(
    "SELECT c.id, c.page, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at, c.ai_verdict " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.status = 'pending' ORDER BY c.id DESC LIMIT 200"
  ).all();
  return json({ ok: true, pending: rows.results }, 200);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (request.method === 'POST' && !originOk(request)) {
        return json({ ok: false, error: 'Bad origin.' }, 403);
      }

      if (path === '/api/comments' && request.method === 'GET') return await handleGet(request, env, url);
      if (path === '/api/comments' && request.method === 'POST') return await handlePost(request, env, ctx);
      if (path === '/api/comments/delete' && request.method === 'POST') return await handleSelfDelete(request, env);
      if (path === '/api/comments/edit' && request.method === 'POST') return await handleEdit(request, env, ctx);
      if (path === '/api/comments/meta' && request.method === 'POST') return await handleMeta(request, env);
      if (path === '/api/comments/audit' && request.method === 'POST') return await handleAudit(request, env);
      if (path === '/api/comments/trust' && request.method === 'POST') return await handleTrust(request, env);
      if (path === '/api/comments/moderate' && request.method === 'POST') return await handleModerate(request, env);
      if (path === '/api/comments/feed' && request.method === 'GET') return await handleFeed(request, env, url);
      if (path === '/api/comments/board' && request.method === 'GET') return await handleBoardIndex(request, env, url);
      if (path === '/api/comments/board/cat' && request.method === 'GET') return await handleBoardCat(request, env, url);
      if (path === '/api/comments/board/topic' && request.method === 'GET') return await handleTopicView(request, env, url);
      if (path === '/api/comments/profile' && request.method === 'GET') return await handleProfileGet(request, env, url);
      if (path === '/api/comments/profile' && request.method === 'POST') return await handleProfileSave(request, env);
      if (path === '/api/comments/profile/clear' && request.method === 'POST') return await handleProfileClear(request, env);
      if (path === '/api/comments/backup' && request.method === 'POST') return await handleBackup(request, env);
      if (path === '/api/comments/dm/send' && request.method === 'POST') return await handleDmSend(request, env);
      if (path === '/api/comments/dm/threads' && request.method === 'POST') return await handleDmThreads(request, env);
      if (path === '/api/comments/dm/thread' && request.method === 'POST') return await handleDmThread(request, env);
      if (path === '/api/comments/dm/unread' && request.method === 'POST') return await handleDmUnread(request, env);
      if (path === '/api/comments/dm/block' && request.method === 'POST') return await handleDmBlock(request, env);
      if (path === '/api/comments/dm/directory' && request.method === 'GET') return await handleDmDirectory(request, env, url);
      if (path === '/api/comments/avatar' && request.method === 'GET') return await handleAvatarGet(request, env, url);
      if (path === '/api/comments/avatar' && request.method === 'POST') return await handleAvatarUpload(request, env);
      if (path === '/api/comments/avatar/delete' && request.method === 'POST') return await handleAvatarDelete(request, env);
      if (path === '/api/comments/lock' && request.method === 'POST') return await handleLock(request, env);
      if (path === '/api/comments/deleteuser' && request.method === 'POST') return await handleDeleteUser(request, env);
      if (path === '/api/comments/ipban' && request.method === 'POST') return await handleIpBan(request, env);
      if (path === '/api/comments/ipbans' && request.method === 'POST') return await handleIpBans(request, env);
      if (path === '/api/comments/approve' && request.method === 'POST') return await handleApprove(request, env);
      if (path === '/api/comments/pending' && request.method === 'POST') return await handlePending(request, env);
      return json({ ok: false, error: 'Not found.' }, 404);
    } catch (err) {
      console.log(JSON.stringify({ event: 'unhandled', error: String(err) }));
      return json({ ok: false, error: 'Server hiccup. Please try again shortly.' }, 500);
    }
  },
  /* Monthly cron (1st, 00:00 UTC): back the database up to R2. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBackup(env));
  },
};
