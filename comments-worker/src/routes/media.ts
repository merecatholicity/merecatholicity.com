/* comments-worker/src/routes/media.ts — the public media store: the shared upload (wall and board, gated at the route), the GET, the prune, and the wall and DM purges.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import * as Media from '../../../purescript/output/Domain.Media/index.js';
import { inList } from '../db.ts';
import {
  ADMIN_CAT,
  WALL_MEDIA_RE,
  appSettingsCache,
  blockedJson,
  blockedReason,
  enforceWallMediaCap,
  getAppSettings,
  isEstablished,
  mediaKindMax,
  mediaKindsFor,
  mediaMaxAcross,
  mediaScanEnabled,
  json,
  randomHex,
  requireAdmin,
  runWallPrune,
  screen,
  screenImage,
  sha256hex,
  sniffImage,
} from '../lib.ts';

/* Purge ALL DM media from the bucket (admin, destructive). Cursor-paginated list +
   batched delete, then clear the pointers and the usage counter. Message text is
   untouched; only the shared attachments are removed. */
async function handleDmMediaPurge(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  let deleted = 0;
  if (env.MEDIA) {
    let cursor: any;
    do {
      const list = await env.MEDIA.list({ prefix: 'dm/', cursor, limit: 1000 });
      const keys = (list.objects || []).map((o: any) => o.key);
      if (keys.length) { try { await env.MEDIA.delete(keys); } catch (e) { /* keep going */ } deleted += keys.length; }
      cursor = list.truncated ? list.cursor : null;
    } while (cursor);
  }
  await env.DB.prepare('DELETE FROM dm_media').run();
  await env.DB.prepare('DELETE FROM dm_media_refs').run();
  await env.DB.prepare('UPDATE dms SET media_key = NULL, media_size = NULL WHERE media_key IS NOT NULL').run();
  await env.DB.prepare(
    "INSERT INTO app_settings (k, v, updated_at) VALUES ('dm_media_bytes', '0', ?1) ON CONFLICT(k) DO UPDATE SET v = '0', updated_at = ?1"
  ).bind(Math.floor(Date.now() / 1000)).run();
  appSettingsCache.at = 0; appSettingsCache.s = null;
  return json({ ok: true, deleted }, 200);
}

/* Upload public post/comment/board media — ONE handler, parameterized by the
   upload context ('wall' | 'board'), each with its own admin kinds mask,
   per-kind byte caps (per-section override → legacy global), storage budget,
   and AI-scan toggle. Images are magic-byte-sniffed and — when the section's
   media_scan_* setting stands — AI-screened (LLaVA, like avatars, fail-open);
   video/audio are validated against the Domain.Media exact-mime whitelist
   (declared type — a container cannot be cheaply sniffed; the serving path
   defends with nosniff + a deny-all CSP). Stored UNencrypted under
   wall/<i|v|a>/<64hex> with the section stamped in wall_media.ctx (the
   accounting dimension; re-stamped at claim to follow the parent). Hardening
   (all of it load-bearing): the uploader must be an ESTABLISHED identity
   (uploads are not Turnstile-gated — the linking post is), and the store
   budget is checked with a LIVE per-section SUM so a flood is refused rather
   than discovered by a stale counter an hour later. */
async function mediaUpload(request: any, env: any, ctxKind: string) {
  if (!env.WALLMEDIA) return json({ ok: false, error: 'Media is unavailable.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const settings = await getAppSettings(env);
  if (settings.media_enabled !== '1') return json({ ok: false, error: 'Media uploads are turned off.' }, 403);
  const allowed = mediaKindsFor(settings, ctxKind);
  if (!allowed.length) return json({ ok: false, error: 'Media uploads are turned off here.' }, 403);
  /* Pre-parse gate on the declared length: the kind is unknown until the form
     parses, so the ceiling is the largest cap among this context's kinds. */
  const maxPre = mediaMaxAcross(settings, allowed, ctxKind);
  const clen = Number(request.headers.get('Content-Length') || 0);
  if (clen && clen > maxPre + 8192) return json({ ok: false, error: 'That file is too large.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  if (!(await isEstablished(env, me))) {
    return json({ ok: false, error: 'Attachments unlock after your first post or profile save.' }, 403);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ ok: false, error: 'No file.' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return json({ ok: false, error: 'Empty file.' }, 400);
  if (bytes.length > maxPre) return json({ ok: false, error: 'That file is too large.' }, 413);
  const declared = String(file.type || '');
  let kind = '', word = '', mime = '';
  const img = sniffImage(bytes);
  if (img && (!declared || declared.startsWith('image/'))) {
    /* The AI screen is a per-section admin toggle (media_scan_wall/_board; on
       by default). Fail-open inside screenImage is unchanged — the toggle only
       decides whether the screen runs at all. */
    if (mediaScanEnabled(settings, ctxKind) && !(await screenImage(env, bytes))) {
      return json({ ok: false, error: 'That image was declined by the safety check.' }, 422);
    }
    kind = 'i'; word = 'image'; mime = img.mime;
  } else if (Media.mimeAllowed('video')(declared)) { kind = 'v'; word = 'video'; mime = declared.slice(0, 60); }
  else if (Media.mimeAllowed('audio')(declared)) { kind = 'a'; word = 'audio'; mime = declared.slice(0, 60); }
  else return json({ ok: false, error: 'That file type cannot be shared here.' }, 400);
  if (allowed.indexOf(word) === -1) {
    return json({ ok: false, error: 'Only ' + allowed.join(', ') + ' can be shared here.' }, 400);
  }
  if (bytes.length > mediaKindMax(settings, word, ctxKind)) {
    return json({ ok: false, error: 'That ' + word + ' is over the ' + Math.floor(mediaKindMax(settings, word, ctxKind) / (1024 * 1024)) + ' MB limit.' }, 413);
  }
  /* LIVE store-budget check, scoped to THIS section's budget (the feed and the
     forum each own one since the 2026-08-02 split). Refusal is the policy; the
     95% valve in enforceWallMediaCap is only the emergency. */
  const used = await env.DB.prepare(
    "SELECT COALESCE(SUM(size), 0) AS total FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1"
  ).bind(ctxKind).first();
  const cap = ctxKind === 'board'
    ? (Number(settings.media_cap_board_bytes) || Number(Media.defaults.capBoardBytes))
    : (Number(settings.media_cap_wall_bytes) || Number(Media.defaults.capWallBytes));
  if ((used.total || 0) + bytes.length > Math.floor(cap * 0.90)) {
    return json({ ok: false, error: 'Media storage is full right now. Try again later.' }, 507);
  }
  const objKey = 'wall/' + kind + '/' + randomHex(32);
  try { await env.WALLMEDIA.put(objKey, bytes, { httpMetadata: { contentType: mime } }); }
  catch { return json({ ok: false, error: 'Upload failed.' }, 500); }
  await env.DB.prepare('INSERT INTO wall_media (key, size, created_at, ctx) VALUES (?1, ?2, ?3, ?4)')
    .bind(objKey, bytes.length, Math.floor(Date.now() / 1000), ctxKind).run();
  return json({ ok: true, media_key: objKey, size: bytes.length, kind: word }, 200);
}

/* Serve public post media, keyless + cacheable, same-origin (like avatars).
   Board attachments ride the same door with one gate: a key whose linked
   comment sits in the back room answers the BYTE-IDENTICAL 404 a missing
   object gets (the standing indistinguishability law) — defense-in-depth, since
   handlePost refuses back-room attachments and a move-in purges, so normally no
   such key exists. caches.default saves R2 reads/CPU/latency on repeats (NOT
   worker invocations — a route's worker runs in front of the cache; the request
   budget's real protector is the browser cache via max-age). Only gate-passing
   2xx responses are ever put, so a cache hit can never leak a gated object. */
async function handleWallMediaGet(request: any, env: any, url: any, ctx?: any) {
  if (!env.WALLMEDIA) return new Response('gone', { status: 404 });
  const k = String(url.searchParams.get('key') || '');
  if (!WALL_MEDIA_RE.test(k)) return new Response('bad request', { status: 400 });
  const notFound = () => new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  const cache = (caches as any).default;
  try { const hit = await cache.match(request); if (hit) return hit; } catch (e) { /* cache is best-effort */ }
  const obj = await env.WALLMEDIA.get(k);
  if (!obj) return notFound();
  try {
    const lk = await env.DB.prepare('SELECT ref_type, ref_id FROM wall_media WHERE key = ?1').bind(k).first();
    if (lk && lk.ref_type === 'board' && lk.ref_id != null) {
      const c = await env.DB.prepare('SELECT page FROM comments WHERE id = ?1').bind(lk.ref_id).first();
      if (c && c.page === ADMIN_CAT) return notFound();
    }
  } catch (e) { /* a failed linkage read must not take public media down */ }
  const resp = new Response(obj.body, { headers: {
    'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
  } });
  if (ctx) { try { ctx.waitUntil(cache.put(request, resp.clone())); } catch (e) { /* best-effort */ } }
  return resp;
}

/* Delete public posts/comments older than `days` and purge their media. Shared by
   the cron (only when auto-prune is enabled) and the admin "prune now" button. */
async function handleWallPrune(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const s = await getAppSettings(env);
  const deleted = await runWallPrune(env, Number(data.days) || Number(s.wall_prune_days) || 365);
  return json({ ok: true, deleted }, 200);
}

/* Admin: purge EVERY media object belonging to one public section — 'wall'
   (the feed + member walls) or 'board' (the forum) — the sibling of the DM
   purge-all. The route names the section (no typo'd string ever reaches SQL),
   and because claim-time re-stamps ctx to follow ref_type, stamping every
   media-carrying parent row in the section's own tables is exact. The R2
   prefix is shared ('wall/'), so keys come from D1, not a bucket listing.
   Posts and their text stay — this retracts the BYTES, with the honest
   media_expired placeholder left behind. Progress commits PER BATCH (rows are
   deleted only after their R2 batch succeeded — an R2 failure keeps the D1
   handle, so nothing can leak unrecoverably), and each click is BOUNDED to
   stay inside the free-tier subrequest budget: a huge section reports
   `remaining` and the admin clicks again, each click making real progress.
   Parents are stamped and the counter zeroed only once the section is empty
   (a partial run must not orphan the surviving rows' pointers). Edge/browser
   caches may serve purged bytes up to a day, the standing property of every
   delete path. */
async function handleWallMediaPurge(request: any, env: any, section: string) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  let deleted = 0;
  /* ~12 subrequests per 500-key batch (1 SELECT + 1 R2 delete + 10 row
     DELETEs); two batches per click keeps the whole request — including the
     final click's parent stamps — comfortably under the ~50 free-tier wall. */
  for (let round = 0; round < 2; round++) {
    const batch = await env.DB.prepare(
      "SELECT key FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1 ORDER BY key LIMIT 500"
    ).bind(section).all();
    const keys = (batch.results || []).map((o: any) => o.key);
    if (!keys.length) break;
    try { if (env.WALLMEDIA) await env.WALLMEDIA.delete(keys); }
    catch (e) { break; /* keep these rows — the D1 handle IS the retry state */ }
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const ph = inList(chunk.length);
      try { await env.DB.prepare('DELETE FROM wall_media WHERE key IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* re-tried next click */ }
    }
    deleted += keys.length;
  }
  const left = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1"
  ).bind(section).first();
  const remaining = (left && left.n) || 0;
  if (!remaining) {
    if (section === 'board') {
      await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE media_key IS NOT NULL').run();
    } else {
      await env.DB.prepare('UPDATE wall_posts SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE media_key IS NOT NULL').run();
      await env.DB.prepare('UPDATE wall_comments SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE media_key IS NOT NULL').run();
    }
    const counter = section === 'board' ? 'board_media_bytes' : 'wall_media_bytes';
    try {
      await env.DB.prepare(
        'INSERT INTO app_settings (k, v, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3'
      ).bind(counter, '0', Math.floor(Date.now() / 1000)).run();
    } catch (e) { /* display-only */ }
    appSettingsCache.at = 0; appSettingsCache.s = null;
  }
  return json({ ok: true, deleted, remaining }, 200);
}

export {
  handleDmMediaPurge,
  handleWallMediaGet,
  handleWallMediaPurge,
  handleWallPrune,
  mediaUpload,
};
