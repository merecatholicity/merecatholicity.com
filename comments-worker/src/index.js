/* Comments handler. Same-origin API on /api/comments*. A commenter's whole
   account is a random client-side key; the server stores only SHA-256(key),
   so there is nothing here to leak. Turnstile gates every write, the
   rate-limit binding throttles by IP, and Llama Guard screens the text
   (flagged or unscreenable comments are held pending, never dropped).
   Secrets: TURNSTILE_SECRET, ADMIN_SECRET (signs the moderation links in
   notification emails), IP_HASH_SECRET (IPs are stored only as HMACs). */

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
const BOARD_CATS = ['pub', 'news', 'theology', 'philosophy', 'history', 'rc', 'eo', 'prot', 'offtopic'];

function boardKey(raw) {
  const m = /^board:([a-z]+)$/.exec(String(raw || ''));
  return m && BOARD_CATS.includes(m[1]) ? raw : null;
}

const FROM = { email: 'comments@merecatholicity.com', name: 'merecatholicity.com comments' };
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

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    return !!verdict.success;
  } catch (err) {
    console.log(JSON.stringify({ event: 'siteverify_failed', error: String(err) }));
    return false;
  }
}

/* Returns {status, verdict}. Anything unscreenable is held pending: the
   failure mode must be a delay for the poster, never a silent publish. */
async function screen(env, body) {
  const mode = env.MODERATION_MODE || 'ai';
  if (mode === 'off') return { status: 'live', verdict: 'off' };
  if (mode === 'hold-all') return { status: 'pending', verdict: 'hold-all' };
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

async function modLink(env, id, act) {
  const sig = await hmacHex(env.ADMIN_SECRET, id + '|' + act);
  return SITE + '/api/comments/mod?id=' + id + '&act=' + act + '&sig=' + sig;
}

async function notify(env, comment) {
  const name = comment.author_hash ? displayName(comment.author_hash) : 'Anonymous';
  const lines = [
    'Page: ' + (comment.page.indexOf('board:') === 0 ? comment.page : SITE + comment.page),
    ...(comment.title ? ['Topic: ' + comment.title] : []),
    'From: ' + name,
    'Status: ' + comment.status,
    '',
    comment.body,
    '',
    'View:    ' + viewLink(comment.page, comment.id, comment.parent_id) +
      (comment.status === 'pending' ? ' (after approval)' : ''),
    'IP:      ' + (comment.ip
      ? (comment.ip.includes(':') ? 'IPv6 ' : 'IPv4 ') + comment.ip
      : 'unknown') + (comment.os ? ' · ' + comment.os : ''),
    'Agent:   ' + (comment.ua || 'unknown'),
    'Locale:  ' + (comment.tz || 'tz unknown') + ' · ' + (comment.lang || 'lang unknown'),
  ];
  if (comment.status === 'pending') {
    lines.push('Held for review (' + comment.ai_verdict + ').');
    lines.push('Approve: ' + (await modLink(env, comment.id, 'approve')));
  }
  lines.push('Delete:  ' + (await modLink(env, comment.id, 'delete')));
  lines.push('Ban:     ' + (await modLink(env, comment.id, 'ban')));
  const kind = comment.edited
    ? (comment.status === 'pending' ? 'edit held for review on ' : 'comment edited on ')
    : (comment.status === 'pending' ? 'comment held for review on ' : 'new comment on ');
  const subject = 'merecatholicity.com: ' + kind + comment.page;
  const recipients = (env.NOTIFY_EMAILS || '').split(',').map((a) => a.trim()).filter(Boolean);
  for (const to of recipients) {
    try {
      await env.EMAIL.send({ to, from: FROM, subject, text: lines.join('\n') + '\n' });
    } catch (err) {
      console.log(JSON.stringify({ event: 'notify_failed', to, error: String(err) }));
    }
  }
}

async function handleGet(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = normalizePage(url.searchParams.get('page'));
  if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  const rows = await env.DB.prepare(
    "SELECT id, author_hash, body, created_at, edited_at FROM comments WHERE page = ?1 AND status = 'live' ORDER BY id LIMIT 500"
  ).bind(page).all();
  return json({ ok: true, anon: env.ALLOW_ANON === 'true', comments: rows.results }, 200,
    { 'Cache-Control': 'public, max-age=60' });
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

  /* Three targets share this pipeline: a site page, a new board topic
     under a category, or a reply to an existing topic. */
  let page = null;
  let parentId = null;
  let title = null;
  if (data.topic != null) {
    const topicId = Number(data.topic);
    if (!Number.isInteger(topicId) || topicId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
    const topic = await env.DB.prepare(
      "SELECT id, page FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
    ).bind(topicId).first();
    if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
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

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many comments at once. Wait a minute and try again.' }, 429);

  if (!(await verifyTurnstile(env, String(data.token || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }

  const key = String(data.key || '');
  const authorHash = key ? await sha256hex(key) : null;
  const ipHash = ip ? (await hmacHex(env.IP_HASH_SECRET, ip)).slice(0, 32) : null;
  const ua = String(request.headers.get('User-Agent') || '').slice(0, 400);
  const os = parseOS(ua);
  const lang = String(request.headers.get('Accept-Language') || '').slice(0, 100);
  const tzRaw = String(data.tz || '');
  const tz = /^[A-Za-z0-9_+\/-]{1,60}$/.test(tzRaw) ? tzRaw : '';

  const banned = await env.DB.prepare('SELECT hash FROM bans WHERE hash IN (?1, ?2)')
    .bind(authorHash || '-', ipHash || '-').all();
  if (banned.results.length) return json({ ok: false, error: 'Posting is not available.' }, 403);

  /* A topic's title is screened with its body, one judgment for the pair. */
  const { status, verdict } = await screen(env, title ? title + '\n\n' + body : body);
  const createdAt = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(
    'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, ip_hash, ai_verdict, ip, ua, os, tz, lang) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) RETURNING id'
  ).bind(page, parentId, title, authorHash, body, status, createdAt, ipHash, verdict, ip || null, ua || null, os || null,
    tz || null, lang || null).first();

  const comment = { id: inserted.id, page, parent_id: parentId, title, author_hash: authorHash, body, status, created_at: createdAt, ai_verdict: verdict, ip, ua, os, tz, lang };
  ctx.waitUntil(notify(env, comment));

  return json({ ok: true, status, comment: { id: comment.id, title, author_hash: authorHash, body, created_at: createdAt } }, 200);
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
  const isAdmin = isAdminHash(env, authorHash);
  const result = isAdmin
    ? await env.DB.prepare(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND status != 'deleted'"
      ).bind(id).run()
    : await env.DB.prepare(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted'"
      ).bind(id, authorHash).run();
  if (!result.meta.changes) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
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
  const page = cat ? boardKey('board:' + cat) : normalizePage(url.searchParams.get('page'));
  if (!page) return new Response('Unknown page.', { status: 400 });
  const rows = await env.DB.prepare(
    "SELECT id, parent_id, title, author_hash, body, created_at FROM comments WHERE page = ?1 AND status = 'live' ORDER BY id DESC LIMIT 50"
  ).bind(page).all();
  const items = rows.results.map(function (c) {
    const name = c.author_hash ? displayName(c.author_hash) : 'Anonymous';
    const link = viewLink(page, c.id, c.parent_id);
    return '<item><title>' + xmlEscape(c.title ? c.title : name + ' on ' + page) + '</title>' +
      '<link>' + xmlEscape(link) + '</link>' +
      '<guid isPermaLink="true">' + xmlEscape(link) + '</guid>' +
      '<pubDate>' + new Date(c.created_at * 1000).toUTCString() + '</pubDate>' +
      '<description>' + xmlEscape(c.body) + '</description></item>';
  }).join('');
  const isBoard = page.indexOf('board:') === 0;
  const feedTitle = isBoard
    ? 'Catholicity Board - ' + page.slice(6) + ' - merecatholicity.com'
    : 'Comments on ' + page + ' - merecatholicity.com';
  const feedLink = isBoard ? SITE + '/community.html?cat=' + page.slice(6) : SITE + page;
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
  const row = await env.DB.prepare(
    "SELECT page, parent_id, title, ip, ua, os, tz, lang, created_at FROM comments WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted'"
  ).bind(id, authorHash).first();
  if (!row) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  const { status, verdict } = await screen(env, body);
  const editedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE comments SET body = ?1, status = ?2, ai_verdict = ?3, edited_at = ?4 WHERE id = ?5'
  ).bind(body, status, verdict, editedAt, id).run();
  const comment = { id, page: row.page, parent_id: row.parent_id, title: row.title,
    author_hash: authorHash, body, status,
    created_at: row.created_at, ai_verdict: verdict, edited: true,
    ip: row.ip, ua: row.ua, os: row.os, tz: row.tz, lang: row.lang };
  ctx.waitUntil(notify(env, comment));
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
    'SELECT id, status, ai_verdict, ip, ua, os, tz, lang FROM comments WHERE page = ?1 ORDER BY id LIMIT 500'
  ).bind(page).all();
  return json({ ok: true, meta: rows.results }, 200);
}

/* The board index: per-category topic and post counts with last activity. */
async function handleBoardIndex(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  /* One pass: per room, window counts plus the newest post whose thread
     is still live, its title borrowed from the thread. */
  const rows = await env.DB.prepare(
    'SELECT page, author_hash, created_at, title, topic_id, topics, posts FROM (' +
    '  SELECT c.page, c.author_hash, c.created_at, ' +
    '         COALESCE(c.title, p.title) AS title, ' +
    '         COALESCE(c.parent_id, c.id) AS topic_id, ' +
    '         COUNT(CASE WHEN c.parent_id IS NULL THEN 1 END) OVER (PARTITION BY c.page) AS topics, ' +
    '         COUNT(*) OVER (PARTITION BY c.page) AS posts, ' +
    '         ROW_NUMBER() OVER (PARTITION BY c.page ORDER BY c.id DESC) AS rn ' +
    '  FROM comments c LEFT JOIN comments p ON p.id = c.parent_id ' +
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
      latest: { topic_id: r.topic_id, title: r.title, author_hash: r.author_hash, created_at: r.created_at },
    };
  });
  return json({ ok: true, cats }, 200, { 'Cache-Control': 'public, max-age=60' });
}

/* One category: its topics, newest activity first. */
async function handleBoardCat(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = boardKey('board:' + url.searchParams.get('cat'));
  if (!page) return json({ ok: false, error: 'Unknown category.' }, 400);
  const rows = await env.DB.prepare(
    "SELECT t.id, t.title, t.author_hash, t.created_at, " +
    "COUNT(r.id) AS replies, MAX(COALESCE(r.created_at, t.created_at)) AS last " +
    "FROM comments t LEFT JOIN comments r ON r.parent_id = t.id AND r.status = 'live' " +
    "WHERE t.page = ?1 AND t.parent_id IS NULL AND t.status = 'live' " +
    "GROUP BY t.id ORDER BY last DESC LIMIT 100"
  ).bind(page).all();
  return json({ ok: true, topics: rows.results }, 200, { 'Cache-Control': 'public, max-age=60' });
}

/* One topic with its live replies in order. */
async function handleTopicView(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const topic = await env.DB.prepare(
    "SELECT id, page, title, author_hash, body, created_at, edited_at FROM comments " +
    "WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
  ).bind(id).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  const replies = await env.DB.prepare(
    "SELECT id, author_hash, body, created_at, edited_at FROM comments " +
    "WHERE parent_id = ?1 AND status = 'live' ORDER BY id LIMIT 500"
  ).bind(id).all();
  return json({
    ok: true,
    anon: env.ALLOW_ANON === 'true',
    cat: topic.page.slice(6),
    topic: { id: topic.id, title: topic.title, author_hash: topic.author_hash, body: topic.body, created_at: topic.created_at, edited_at: topic.edited_at },
    replies: replies.results,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
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
  const pages = await env.DB.prepare(
    "SELECT c.page, c.author_hash, c.created_at, c.status FROM comments c " +
    "WHERE c.page NOT LIKE 'board:%' AND c.status != 'deleted' AND c.id = (" +
    "  SELECT MAX(id) FROM comments c2 WHERE c2.page = c.page AND c2.status != 'deleted') " +
    "ORDER BY c.created_at DESC"
  ).all();
  const topics = await env.DB.prepare(
    "SELECT t.page, t.title, c.author_hash, c.created_at, c.status " +
    "FROM comments c JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) " +
    "WHERE c.page LIKE 'board:%' AND c.status != 'deleted' AND t.status != 'deleted' AND c.id = (" +
    "  SELECT MAX(c2.id) FROM comments c2 WHERE COALESCE(c2.parent_id, c2.id) = t.id AND c2.status != 'deleted') " +
    "ORDER BY c.created_at DESC"
  ).all();
  return json({ ok: true, pages: pages.results, topics: topics.results }, 200);
}

function modPage(text, status) {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>merecatholicity.com comments</title>' +
    '<body style="font-family: Georgia, serif; max-width: 36rem; margin: 4rem auto; color: #222;"><p>' + text + '</p>',
    { status: status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function handleMod(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return modPage('Too many requests. Slow down.', 429);
  const id = Number(url.searchParams.get('id'));
  const act = String(url.searchParams.get('act') || '');
  const sig = String(url.searchParams.get('sig') || '');
  if (!Number.isInteger(id) || id < 1 || !['approve', 'delete', 'ban'].includes(act)) {
    return modPage('Bad request.', 400);
  }
  const expected = await hmacHex(env.ADMIN_SECRET, id + '|' + act);
  if (!timingSafeEqual(sig, expected)) return modPage('Bad signature.', 403);

  if (act === 'approve') {
    const result = await env.DB.prepare(
      "UPDATE comments SET status = 'live' WHERE id = ?1 AND status = 'pending'"
    ).bind(id).run();
    return modPage(result.meta.changes ? 'Comment ' + id + ' approved and live.' : 'Nothing to approve. Already handled.', 200);
  }
  if (act === 'delete') {
    const result = await env.DB.prepare(
      "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND status != 'deleted'"
    ).bind(id).run();
    return modPage(result.meta.changes ? 'Comment ' + id + ' deleted.' : 'Already deleted.', 200);
  }
  /* Ban the keyed author when there is one, the IP hash otherwise, and
     take the comment down in the same act. */
  const comment = await env.DB.prepare('SELECT author_hash, ip_hash FROM comments WHERE id = ?1').bind(id).first();
  if (!comment) return modPage('No such comment.', 404);
  const hash = comment.author_hash || comment.ip_hash;
  if (!hash) return modPage('Nothing to ban on this comment.', 200);
  await env.DB.prepare('INSERT OR IGNORE INTO bans (hash, kind, created_at) VALUES (?1, ?2, ?3)')
    .bind(hash, comment.author_hash ? 'author' : 'ip', Math.floor(Date.now() / 1000)).run();
  await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?1").bind(id).run();
  return modPage('Banned ' + (comment.author_hash ? 'author' : 'IP') + ' of comment ' + id + ' and deleted it.', 200);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (path === '/api/comments' && request.method === 'GET') return await handleGet(request, env, url);
      if (path === '/api/comments' && request.method === 'POST') return await handlePost(request, env, ctx);
      if (path === '/api/comments/delete' && request.method === 'POST') return await handleSelfDelete(request, env);
      if (path === '/api/comments/edit' && request.method === 'POST') return await handleEdit(request, env, ctx);
      if (path === '/api/comments/meta' && request.method === 'POST') return await handleMeta(request, env);
      if (path === '/api/comments/audit' && request.method === 'POST') return await handleAudit(request, env);
      if (path === '/api/comments/feed' && request.method === 'GET') return await handleFeed(request, env, url);
      if (path === '/api/comments/board' && request.method === 'GET') return await handleBoardIndex(request, env);
      if (path === '/api/comments/board/cat' && request.method === 'GET') return await handleBoardCat(request, env, url);
      if (path === '/api/comments/board/topic' && request.method === 'GET') return await handleTopicView(request, env, url);
      if (path === '/api/comments/mod' && request.method === 'GET') return await handleMod(request, env, url);
      return json({ ok: false, error: 'Not found.' }, 404);
    } catch (err) {
      console.log(JSON.stringify({ event: 'unhandled', error: String(err) }));
      return json({ ok: false, error: 'Server hiccup. Please try again shortly.' }, 500);
    }
  },
};
