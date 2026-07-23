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

const TO = 'adam.schaefers@icloud.com';
const FROM = { email: 'comments@merecatholicity.com', name: 'merecatholicity.com comments' };
const SITE = 'https://merecatholicity.com';
const MAX_BODY = 4000;

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

async function verifyTurnstile(env, token, ip) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const verdict = await res.json();
  return !!verdict.success;
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

async function modLink(env, id, act) {
  const sig = await hmacHex(env.ADMIN_SECRET, id + '|' + act);
  return SITE + '/api/comments/mod?id=' + id + '&act=' + act + '&sig=' + sig;
}

async function notify(env, comment) {
  const name = comment.author_hash ? displayName(comment.author_hash) : 'Anonymous';
  const lines = [
    'Page: ' + SITE + comment.page,
    'From: ' + name,
    'Status: ' + comment.status,
    '',
    comment.body,
    '',
    'View:    ' + SITE + comment.page + '#comment-' + comment.id +
      (comment.status === 'pending' ? ' (after approval)' : ''),
    'IP:      ' + (comment.ip || 'unknown') + (comment.os ? ' · ' + comment.os : ''),
    'Agent:   ' + (comment.ua || 'unknown'),
  ];
  if (comment.status === 'pending') {
    lines.push('Held for review (' + comment.ai_verdict + ').');
    lines.push('Approve: ' + (await modLink(env, comment.id, 'approve')));
  }
  lines.push('Delete:  ' + (await modLink(env, comment.id, 'delete')));
  lines.push('Ban:     ' + (await modLink(env, comment.id, 'ban')));
  try {
    await env.EMAIL.send({
      to: TO,
      from: FROM,
      subject: 'merecatholicity.com: ' +
        (comment.status === 'pending' ? 'comment held for review on ' : 'new comment on ') + comment.page,
      text: lines.join('\n') + '\n',
    });
  } catch (err) {
    console.log(JSON.stringify({ event: 'notify_failed', error: String(err) }));
  }
}

async function handleGet(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = normalizePage(url.searchParams.get('page'));
  if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  const rows = await env.DB.prepare(
    "SELECT id, author_hash, body, created_at FROM comments WHERE page = ?1 AND status = 'live' ORDER BY id LIMIT 500"
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

  const page = normalizePage(data.page);
  if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);

  if (!String(data.key || '') && env.ALLOW_ANON !== 'true') {
    return json({ ok: false, error: 'Comments here need an identity. Create one with the link above the box.' }, 400);
  }

  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The comment is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'The comment is too long.' }, 400);
  /* Control characters other than newline and tab are nothing a person types. */
  if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);

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

  const banned = await env.DB.prepare('SELECT hash FROM bans WHERE hash IN (?1, ?2)')
    .bind(authorHash || '-', ipHash || '-').all();
  if (banned.results.length) return json({ ok: false, error: 'Posting is not available.' }, 403);

  const { status, verdict } = await screen(env, body);
  const createdAt = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(
    'INSERT INTO comments (page, author_hash, body, status, created_at, ip_hash, ai_verdict, ip, ua, os) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id'
  ).bind(page, authorHash, body, status, createdAt, ipHash, verdict, ip || null, ua || null, os || null).first();

  const comment = { id: inserted.id, page, author_hash: authorHash, body, status, created_at: createdAt, ai_verdict: verdict, ip, ua, os };
  ctx.waitUntil(notify(env, comment));

  return json({ ok: true, status, comment: { id: comment.id, author_hash: authorHash, body, created_at: createdAt } }, 200);
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
  const page = normalizePage(data.page);
  const key = String(data.key || '');
  if (!page || !key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!isAdminHash(env, await sha256hex(key))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare(
    'SELECT id, status, ai_verdict, ip, ua, os FROM comments WHERE page = ?1 ORDER BY id LIMIT 500'
  ).bind(page).all();
  return json({ ok: true, meta: rows.results }, 200);
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
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/comments' && request.method === 'GET') return handleGet(request, env, url);
    if (path === '/api/comments' && request.method === 'POST') return handlePost(request, env, ctx);
    if (path === '/api/comments/delete' && request.method === 'POST') return handleSelfDelete(request, env);
    if (path === '/api/comments/meta' && request.method === 'POST') return handleMeta(request, env);
    if (path === '/api/comments/mod' && request.method === 'GET') return handleMod(request, env, url);
    return json({ ok: false, error: 'Not found.' }, 404);
  },
};
