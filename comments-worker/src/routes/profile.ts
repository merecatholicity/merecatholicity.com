/* comments-worker/src/routes/profile.ts — the member's profile: read, save and clear, the preferences, the admin edit, the avatar (upload, delete, get) and the /@handle share card.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import * as Handle from '../../../purescript/output/Domain.Handle/index.js';
import { rankFor, postCountsFor } from '../db.ts';
import {
  AVATAR_MAX,
  AVATAR_MIN,
  MAX_AVATAR_BYTES,
  MAX_BIO,
  MAX_NICK,
  MAX_SIG,
  MERECAT_BOT,
  MetaAttr,
  TitleText,
  blockedJson,
  blockedReason,
  cacheHeader,
  cleanFaith,
  cleanField,
  displayName,
  isAdminHash,
  isTrusted,
  json,
  keyedGated,
  normalizeLinks,
  safeParseLinks,
  screen,
  screenImage,
  sha256hex,
  sniffImage,
  verifyTurnstile,
  readLimited,
} from '../lib.ts';

async function handleProfileGet(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
  /* Address a profile by its 64-hex hash OR by a custom ?handle=<name> (the URL
     name a member claimed). A handle resolves to its owner's hash; an unclaimed
     handle is an ordinary "not found" (an empty profile, like a hashless hash). */
  let hash = String(url.searchParams.get('hash') || '');
  const handleParam = String(url.searchParams.get('handle') || '');
  if (!hash && handleParam) {
    const v = Handle.validate(handleParam);
    if (v.ok) {
      const owner = await env.DB.prepare('SELECT hash FROM profiles WHERE handle = ?1').bind(v.handle).first();
      if (owner && owner.hash) hash = owner.hash;
    }
    if (!hash) return json({ ok: false, error: 'No such profile.' }, 404, cacheHeader(url));
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const row = await env.DB.prepare('SELECT nick, bio, signature, avatar, faith, handle, links FROM profiles WHERE hash = ?1').bind(hash).first();
  const counts = await postCountsFor(env, [hash]);
  return json({
    ok: true,
    profile: {
      hash: hash,
      nick: row ? (row.nick || null) : null,
      bio: row ? (row.bio || null) : null,
      signature: row ? (row.signature || null) : null,
      avatar: row ? (row.avatar || null) : null,
      faith: row ? (row.faith || null) : null,
      handle: row ? (row.handle || null) : null,
      links: row && row.links ? safeParseLinks(row.links) : null,
      posts: counts[hash] || 0,
      rank: rankFor(counts[hash] || 0),
      assigned: displayName(hash),
      admin: await isAdminHash(env, hash),
    },
  }, 200, cacheHeader(url));
}

/* One profile field, normalized like a comment body: CRLF folded, trimmed,
   control characters (bar newline and tab) refused. Empty becomes null,
   which clears the field and falls the name back to the assigned pseudonym. */
async function handleProfileSave(request: any, env: any) {
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
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const nick = cleanField(data.nick, MAX_NICK);
  const bio = cleanField(data.bio, MAX_BIO);
  const signature = cleanField(data.signature, MAX_SIG);
  if (nick.error || bio.error || signature.error) {
    return json({ ok: false, error: 'That profile is too long or has stray characters.' }, 400);
  }
  /* The librarian's name is reserved, so the @-mention can never be confused. */
  if (/merecat/i.test(String(nick.value || '').replace(/\s+/g, ''))) {
    return json({ ok: false, error: 'That name belongs to the librarian. Pick another.' }, 400);
  }
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  /* Custom @handle (the profile URL name), validated against the shared kernel
     and checked for uniqueness before any write. Absent key = leave unchanged;
     empty string = clear it; a claimed name someone else holds = 409. */
  const handleProvided = Object.prototype.hasOwnProperty.call(data, 'handle');
  let handleVal = null;
  if (handleProvided) {
    const raw = String(data.handle == null ? '' : data.handle).trim();
    if (raw !== '') {
      const v = Handle.validate(raw);
      if (!v.ok) return json({ ok: false, error: handleErrorMessage(v.error), handle_error: v.error }, 400);
      const taken = await env.DB.prepare('SELECT hash FROM profiles WHERE handle = ?1 AND hash != ?2').bind(v.handle, authorHash).first();
      if (taken) return json({ ok: false, error: 'That @handle is taken. Pick another.', handle_error: 'taken' }, 409);
      handleVal = v.handle;
    }
  }
  /* Offsite links (website + socials) sanitized to safe https URLs (invalid ones
     dropped). Absent key = leave unchanged; an all-empty object clears them. */
  const linksProvided = Object.prototype.hasOwnProperty.call(data, 'links');
  const linksVal = linksProvided ? normalizeLinks(data.links) : null;
  const blob = [nick.value, bio.value, signature.value].filter(Boolean).join('\n');
  if (blob) {
    const { status, verdict } = await screen(env, blob, await isTrusted(env, authorHash));
    if (status !== 'live' && verdict !== 'ai-error') {
      return json({ ok: false, error: 'That text was flagged. Please revise it.' }, 400);
    }
  }
  const faith = cleanFaith(data.faith);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO profiles (hash, nick, bio, signature, faith, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ' +
    'ON CONFLICT(hash) DO UPDATE SET nick = ?2, bio = ?3, signature = ?4, faith = COALESCE(?5, faith), updated_at = ?6'
  ).bind(authorHash, nick.value, bio.value, signature.value, faith, now).run();
  /* Handle is written separately so an absent key leaves it untouched (an empty
     string clears it). The UNIQUE INDEX is the real guard: on the rare same-instant
     race past the check above it throws, which we surface as the same 409. */
  if (handleProvided) {
    try {
      await env.DB.prepare('UPDATE profiles SET handle = ?2, updated_at = ?3 WHERE hash = ?1')
        .bind(authorHash, handleVal, now).run();
    } catch {
      return json({ ok: false, error: 'That @handle is taken. Pick another.', handle_error: 'taken' }, 409);
    }
  }
  /* Links written separately (an absent key leaves them untouched). */
  if (linksProvided) {
    await env.DB.prepare('UPDATE profiles SET links = ?2, updated_at = ?3 WHERE hash = ?1')
      .bind(authorHash, linksVal, now).run();
  }
  /* The text upsert leaves the avatar and faith columns as they stand when not
     given; read them back (with the handle + links) so the client's re-render keeps them. */
  const av = await env.DB.prepare('SELECT avatar, faith, handle, links FROM profiles WHERE hash = ?1').bind(authorHash).first();
  return json({
    ok: true,
    profile: { hash: authorHash, nick: nick.value, bio: bio.value, signature: signature.value,
      avatar: av && av.avatar || null, faith: av && av.faith || null, handle: av && av.handle || null,
      links: av && av.links ? safeParseLinks(av.links) : null,
      assigned: displayName(authorHash), admin: await isAdminHash(env, authorHash) },
  }, 200);
}

/* Map a Domain.Handle rejection tag to a member-facing message. */
function handleErrorMessage(tag: any) {
  switch (tag) {
    case 'too_short': return 'That handle is too short (3 to 30 characters).';
    case 'too_long': return 'That handle is too long (3 to 30 characters).';
    case 'bad_chars': return 'A handle can use only lowercase letters, numbers, and underscore.';
    case 'bad_start': return 'A handle must start with a letter.';
    case 'bad_underscore': return 'A handle cannot end with, or repeat, an underscore.';
    case 'reserved': return 'That handle is reserved. Pick another.';
    default: return 'That handle is not allowed.';
  }
}

/* Admin-only: wipe an abusive profile back to the assigned pseudonym without
   banning the author. Bans still only stop posting. */
async function handleProfileClear(request: any, env: any) {
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
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  if (env.AVATARS) await env.AVATARS.delete('avatars/' + hash);
  await env.DB.prepare('UPDATE profiles SET nick = NULL, bio = NULL, signature = NULL, avatar = NULL, updated_at = ?2 WHERE hash = ?1')
    .bind(hash, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* Settings-gear preferences (keyed + private): read your own read-receipts mode
   and per-type notification switches, and set them. Never exposed on the public
   profile read. */
async function handlePrefs(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const now = Math.floor(Date.now() / 1000);
  if (data.set && typeof data.set === 'object') {
    await env.DB.prepare('INSERT OR IGNORE INTO profiles (hash, created_at) VALUES (?1, ?2)').bind(me, now).run();
    const set = data.set;
    const parts = [];
    const vals = [];
    if ('receipts' in set) { parts.push('receipts_mode = ?'); vals.push(String(set.receipts) === 'off' ? 'off' : 'auto'); }
    for (const k of ['reply', 'mention', 'dm']) {
      const sk = 'notify_' + k;
      if (sk in set) { parts.push(sk + ' = ?'); vals.push((set[sk] === false || set[sk] === 0 || set[sk] === '0') ? 0 : 1); }
    }
    /* Voice calls on/off (the gear's Privacy switch). NULL/1 = takes calls;
       0 = every offer to this member fake-succeeds like a block. */
    if ('calls' in set) { parts.push('calls_ok = ?'); vals.push((set.calls === false || set.calls === 0 || set.calls === '0') ? 0 : 1); }
    /* The mute list follows the member across devices (the client merges and
       writes through). Hashes only, clamped, stored as a JSON array. */
    if ('muted' in set && Array.isArray(set.muted)) {
      const clean = set.muted.filter((h: any) => /^[0-9a-f]{64}$/.test(String(h))).slice(0, 300);
      parts.push('muted = ?'); vals.push(JSON.stringify(clean));
    }
    if (parts.length) {
      parts.push('updated_at = ?'); vals.push(now);
      await env.DB.prepare('UPDATE profiles SET ' + parts.join(', ') + ' WHERE hash = ?').bind(...vals, me).run();
    }
  }
  const row = await env.DB.prepare('SELECT receipts_mode, notify_reply, notify_mention, notify_dm, calls_ok, muted FROM profiles WHERE hash = ?1').bind(me).first();
  const onOff = (v: any) => (v == null ? 1 : (v ? 1 : 0));
  let muted: any = [];
  try { muted = row && row.muted ? JSON.parse(row.muted) : []; } catch { muted = []; }
  return json({ ok: true, prefs: {
    receipts: (row && row.receipts_mode === 'off') ? 'off' : 'auto',
    notify_reply: onOff(row && row.notify_reply),
    notify_mention: onOff(row && row.notify_mention),
    notify_dm: onOff(row && row.notify_dm),
    calls: onOff(row && row.calls_ok),
    muted: Array.isArray(muted) ? muted : [],
  } }, 200);
}

async function handleProfileAdminEdit(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const target = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(target)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  if (target === MERECAT_BOT.hash) return json({ ok: false, error: 'The librarian keeps its own desk.' }, 400);
  const nick = cleanField(data.nick, MAX_NICK);
  const bio = cleanField(data.bio, MAX_BIO);
  const signature = cleanField(data.signature, MAX_SIG);
  if (nick.error || bio.error || signature.error) {
    return json({ ok: false, error: 'That profile is too long or has stray characters.' }, 400);
  }
  if (/merecat/i.test(String(nick.value || '').replace(/\s+/g, ''))) {
    return json({ ok: false, error: 'That name belongs to the librarian. Pick another.' }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    'UPDATE profiles SET nick = ?2, bio = ?3, signature = ?4, updated_at = ?5 WHERE hash = ?1'
  ).bind(target, nick.value, bio.value, signature.value, now).run();
  if (!res.meta || !res.meta.changes) return json({ ok: false, error: 'No such member.' }, 404);
  if (data.clear_avatar) {
    if (env.AVATARS) await env.AVATARS.delete('avatars/' + target);
    await env.DB.prepare('UPDATE profiles SET avatar = NULL WHERE hash = ?1').bind(target).run();
  }
  // a visible line in the tail, since moderation leaves no other trace
  console.log(JSON.stringify({ event: 'admin_profile_edit', target, cleared_avatar: !!data.clear_avatar }));
  return json({ ok: true }, 200);
}

async function handleAvatarUpload(request: any, env: any) {
  if (!env.AVATARS) return json({ ok: false, error: 'Avatars are not enabled yet. Soon.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Wait a minute and try again.' }, 429);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES + 8192) {
    return json({ ok: false, error: 'The image is too large. 1 MB at most.' }, 413);
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
  if (!(await verifyTurnstile(env, String(form.get('token') || ''), ip, String(form.get('key') || '')))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const file = form.get('avatar');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'No image arrived.' }, 400);
  if (file.size > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 1 MB at most.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 1 MB at most.' }, 413);
  /* JPEG alone is stored, whatever any client claims or an old cached
     client sends. The canvas step upstream re-encodes every source to JPEG,
     so an honest upload always passes; everything else is refused here. */
  const img = sniffImage(bytes);
  if (!img || img.mime !== 'image/jpeg') return json({ ok: false, error: 'Avatars must be JPEG.' }, 400);
  if (img.width !== img.height || img.width < AVATAR_MIN || img.width > AVATAR_MAX) {
    return json({ ok: false, error: 'The avatar must be square, between ' + AVATAR_MIN + ' and ' + AVATAR_MAX + ' pixels.' }, 400);
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
async function handleAvatarDelete(request: any, env: any) {
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
async function handleAvatarGet(request: any, env: any, url: any) {
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

/* Sets one attribute on a matched element (HTMLRewriter handler). Used to
   overwrite the static profile.html OG tags with per-profile values. */
async function handleHandleCard(request: any, env: any, url: any) {
  const raw = decodeURIComponent(url.pathname.slice(2)).replace(/\/+$/, '');
  const pageReq = new URL('/profile.html', url.origin).toString();
  try {
    const originResp = await fetch(pageReq, { headers: { Accept: 'text/html' } });
    if (!originResp.ok) return originResp;
    let prof = null;
    const v = Handle.validate(raw);
    if (v.ok) {
      const row = await env.DB.prepare('SELECT hash, nick, bio, avatar, handle FROM profiles WHERE handle = ?1').bind(v.handle).first();
      if (row && row.hash) prof = row;
    }
    if (!prof) return originResp;   // unknown handle: the plain page (client shows "No such profile")
    const name = prof.nick || displayName(prof.hash);
    const title = name + ' (@' + prof.handle + ')';
    const desc = (prof.bio ? String(prof.bio).replace(/\s+/g, ' ').trim().slice(0, 200) : '')
      || ('A member of the Mere Catholicity community. @' + prof.handle);
    const image = prof.avatar
      ? url.origin + '/api/comments/avatar?hash=' + prof.hash + '&v=' + encodeURIComponent(prof.avatar)
      : url.origin + '/cover.jpg';
    const pageUrl = url.origin + '/@' + prof.handle;
    return new HTMLRewriter()
      .on('meta[property="og:title"]', new MetaAttr(title))
      .on('meta[name="twitter:title"]', new MetaAttr(title))
      .on('meta[property="og:description"]', new MetaAttr(desc))
      .on('meta[name="twitter:description"]', new MetaAttr(desc))
      .on('meta[name="description"]', new MetaAttr(desc))
      .on('meta[property="og:image"]', new MetaAttr(image))
      .on('meta[name="twitter:image"]', new MetaAttr(image))
      .on('meta[property="og:url"]', new MetaAttr(pageUrl))
      .on('meta[property="og:type"]', new MetaAttr('profile'))
      .on('title', new TitleText(title + ' | Mere Catholicity'))
      .transform(originResp);
  } catch {
    /* Never break /@handle: serve the plain page, or redirect to the ?u= form. */
    try {
      return await fetch(pageReq, { headers: { Accept: 'text/html' } });
    } catch {
      return Response.redirect(new URL('/profile.html?u=' + encodeURIComponent(raw), url.origin).toString(), 302);
    }
  }
}

export {
  handleAvatarDelete,
  handleAvatarGet,
  handleAvatarUpload,
  handleErrorMessage,
  handleHandleCard,
  handlePrefs,
  handleProfileAdminEdit,
  handleProfileClear,
  handleProfileGet,
  handleProfileSave,
};
