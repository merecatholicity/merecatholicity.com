/* comments-worker/src/routes/admin.ts — the admin console: the platform settings, the Discord hooks, the backup, locks and shadowbans, delete-user, IP bans and reverse DNS, the admins list and the back office.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import * as Dm from '../../../purescript/output/Domain.Dm/index.js';
import * as Wall from '../../../purescript/output/Domain.Wall/index.js';
import * as Media from '../../../purescript/output/Domain.Media/index.js';
import * as CallK from '../../../purescript/output/Domain.Call/index.js';
import * as Comments from '../../../purescript/output/Domain.Comments/index.js';
import * as OpsK from '../../../purescript/output/Domain.Ops/index.js';
import { toBanKey, looksLikeIp } from '../pure.js';
import { sendAlert } from '../alerts.ts';
import { readOps } from '../ops.ts';
import type { Env } from '../env.ts';
import { inList } from '../db.ts';
import {
  APP_SETTING_DEFAULTS,
  DM_TTLS,
  MERECAT_BOT,
  appSettingsCache,
  displayName,
  ensureAdminsSeeded,
  getAppSettings,
  isAdminHash,
  isDiscordWebhook,
  parseFeedScope,
  scopeLabel,
  json,
  ptrLookup,
  purgeWallMedia,
  refreshTopicStats,
  requireAdmin,
  runBackup,
  sha256hex,
  sweepJournalComments,
  adminGated,
} from '../lib.ts';

/* Admin platform settings: read them (with the current media usage), and set the
   tunable ones with sanity clamps. The growing home for site-wide toggles. */
async function handleAdminSettings(request: Request, env: Env) {
  const pre = await adminGated(request, env);
  if (pre instanceof Response) return pre;
  const { data, key, me } = pre;
  if (data.set && typeof data.set === 'object') {
    const now = Math.floor(Date.now() / 1000);
      const allowed: Record<string, 1> = { media_enabled: 1, media_max_bytes: 1, dm_default_ttl: 1, dm_backstop_days: 1, wall_prune_enabled: 1, wall_prune_days: 1, discord_forum_webhook: 1, discord_feed_webhook: 1, discord_feed_comments: 1, journal_topic: 1, journal_enabled: 1, comments_pages: 1, comments_journal: 1,
      media_image_max_bytes: 1, media_video_max_bytes: 1, media_audio_max_bytes: 1, media_audio_max_seconds: 1,
      media_kinds_dm: 1, media_kinds_wall: 1, media_kinds_board: 1, media_image_autocompress: 1,
      media_cap_dm_bytes: 1, media_cap_wall_bytes: 1, media_cap_board_bytes: 1,
      media_scan_wall: 1, media_scan_board: 1, media_voice_dm: 1, media_voice_wall: 1, media_voice_board: 1,
      media_wall_retention_days: 1, media_board_retention_days: 1, media_dm_retention_days: 1,
      media_dm_image_max_bytes: 1, media_dm_video_max_bytes: 1, media_dm_audio_max_bytes: 1,
      media_wall_image_max_bytes: 1, media_wall_video_max_bytes: 1, media_wall_audio_max_bytes: 1,
      media_board_image_max_bytes: 1, media_board_video_max_bytes: 1, media_board_audio_max_bytes: 1,
      media_audio_max_seconds_dm: 1, media_audio_max_seconds_wall: 1, media_audio_max_seconds_board: 1,
      calls_enabled: 1, calls_turn: 1, calls_idle_hangup: 1, calls_idle_seconds: 1,
      social_enabled: 1, turnstile_skip_established: 1,
      alert_email: 1, alert_email_on: 1, alert_discord_webhook: 1, alert_discord_on: 1 };
    /* The 12 per-section OVERRIDE keys: an EMPTY value deletes the stored row —
       back to "inherit the legacy global" — because absence is what the
       fallback chain reads. Without this the chain would be one-way. */
    const overrideKeys: Record<string, 1> = {
      media_dm_image_max_bytes: 1, media_dm_video_max_bytes: 1, media_dm_audio_max_bytes: 1,
      media_wall_image_max_bytes: 1, media_wall_video_max_bytes: 1, media_wall_audio_max_bytes: 1,
      media_board_image_max_bytes: 1, media_board_video_max_bytes: 1, media_board_audio_max_bytes: 1,
      media_audio_max_seconds_dm: 1, media_audio_max_seconds_wall: 1, media_audio_max_seconds_board: 1 };
    const stmts = [];
    for (const k of Object.keys(data.set)) {
      if (!allowed[k]) continue;
      let v = String(data.set[k]);
      if (overrideKeys[k] && v.trim() === '') {
        stmts.push(env.DB.prepare('DELETE FROM app_settings WHERE k = ?1').bind(k));
        continue;
      }
      if (k === 'media_enabled' || k === 'wall_prune_enabled' || k === 'media_image_autocompress'
        || k === 'media_scan_wall' || k === 'media_scan_board'
        || k === 'media_voice_dm' || k === 'media_voice_wall' || k === 'media_voice_board'
        || k === 'calls_enabled' || k === 'calls_turn' || k === 'calls_idle_hangup'
        || k === 'social_enabled' || k === 'turnstile_skip_established' || k === 'comments_journal'
        || k === 'alert_email_on' || k === 'alert_discord_on') v = (v === '1' || v === 'true') ? '1' : '0';
      else if (k === 'calls_idle_seconds') v = String(CallK.idleClampSecs(Math.floor(Number(v)) || CallK.idleDefaultSecs));
      else if (k === 'media_max_bytes') v = String(Math.max(65536, Math.min(100 * 1024 * 1024, Math.floor(Number(v)) || (25 * 1024 * 1024))));
      /* Per-kind caps, the recorder stop, the store budgets, the retention
         windows, and the context kinds masks all clamp/normalize through the
         Domain.Media kernel — the same rules the client reads via mcCore,
         single-sourced. An empty kinds mask is legal (= that context's uploads
         are off). NOTE the retention clamps use `|| 0`, NOT a defaults
         fallback: 0 is a legal, meaningful value (keep forever). */
      else if (k === 'media_image_max_bytes' || k === 'media_video_max_bytes' || k === 'media_audio_max_bytes') v = String(Media.clampKindBytes(Math.floor(Number(v)) || Number((APP_SETTING_DEFAULTS as any)[k])));
      else if (overrideKeys[k] && k.indexOf('_max_bytes') !== -1) {
        /* Garbage input on a per-section byte override falls back to ITS kind's
           legacy global default (the key ends media_<ctx>_<kind>_max_bytes). */
        const kindWord = k.split('_').slice(-3)[0];
        v = String(Media.clampKindBytes(Math.floor(Number(v)) || Number((APP_SETTING_DEFAULTS as any)['media_' + kindWord + '_max_bytes']) || Number(APP_SETTING_DEFAULTS.media_image_max_bytes)));
      }
      else if (k === 'media_audio_max_seconds' || k.indexOf('media_audio_max_seconds_') === 0) v = String(Media.clampAudioSeconds(Math.floor(Number(v)) || Number(APP_SETTING_DEFAULTS.media_audio_max_seconds)));
      else if (k === 'media_cap_dm_bytes' || k === 'media_cap_wall_bytes' || k === 'media_cap_board_bytes') v = String(Media.clampCapBytes(Math.floor(Number(v)) || Number((APP_SETTING_DEFAULTS as any)[k])));
      else if (k === 'media_wall_retention_days' || k === 'media_board_retention_days') v = String(Media.clampRetentionDays(Math.floor(Number(v)) || 0));
      else if (k === 'media_dm_retention_days') v = String(Media.clampDmRetentionDays(Math.floor(Number(v)) || Number(APP_SETTING_DEFAULTS.media_dm_retention_days)));
      else if (k === 'media_kinds_dm' || k === 'media_kinds_wall' || k === 'media_kinds_board') v = Media.serializeKinds(Media.parseKinds(v));
      else if (k === 'dm_default_ttl') v = String(DM_TTLS.indexOf(Math.floor(Number(v))) !== -1 ? Math.floor(Number(v)) : Dm.defaultTtl);
      else if (k === 'dm_backstop_days') v = String(Math.max(1, Math.min(365, Math.floor(Number(v)) || 30)));
      else if (k === 'wall_prune_days') v = String(Wall.clampPruneDays(Math.floor(Number(v)) || 365));
      else if (k === 'journal_enabled' || k === 'discord_feed_comments') v = (v === '1' || v === 'true') ? '1' : '0';
      else if (k === 'journal_topic') v = String(Math.max(0, Math.floor(Number(v)) || 0));
      /* The open-sections list is re-parsed through the kernel: only the site's
         own writings survive, deduped, canonical order — a path that is not
         commentable can never be stored as open. */
      else if (k === 'comments_pages') v = Comments.serializeEnabledPages(Comments.parseEnabledPages(v));
      else if (k === 'discord_forum_webhook' || k === 'discord_feed_webhook' || k === 'alert_discord_webhook') {
        /* Empty clears (turns the webhook off); anything else must be a genuine
           Discord webhook URL, so a typo or hostile value is never stored/POSTed. */
        v = v.trim();
        if (v && !isDiscordWebhook(v)) return json({ ok: false, error: 'That is not a valid Discord webhook URL.' }, 400);
      }
      else if (k === 'alert_email') {
        /* The alerts' address: empty clears; anything else must read as an
           address (Domain.Ops.isEmailAddress) so a typo is refused here and
           not discovered at the first alert. Whether the address is a VERIFIED
           Email Routing destination only the send can tell — the test door. */
        v = v.trim();
        if (v && !OpsK.isEmailAddress(v)) return json({ ok: false, error: 'That is not a valid email address.' }, 400);
      }
      stmts.push(env.DB.prepare(
        'INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3, updated_by = ?4'
      ).bind(k, v, now, me));
    }
    if (stmts.length) { await env.DB.batch(stmts); appSettingsCache.at = 0; appSettingsCache.s = null; }
  }
  const settings = await getAppSettings(env);
  return json({ ok: true, settings, ttls: DM_TTLS, wall_prune_options: Wall.pruneDayOptions }, 200);
}

/* ================= Per-feed Discord subscriptions (admin CRUD) =================
   Admin-only. A subscription maps one of our feed URLs (parsed to a scope) to a
   Discord channel webhook; deliverDiscordFeedHooks fires it on a matching live
   post. Both the feed URL and the webhook URL are validated before storage — the
   webhook by isDiscordWebhook (the SSRF gate), the feed by parseFeedScope (only
   our own /api/comments/feed, only a real selector). */
async function handleAdminDiscordList(request: Request, env: Env) {
  const pre = await adminGated(request, env);
  if (pre instanceof Response) return pre;
  const rows = await env.DB.prepare(
    'SELECT id, scope, feed_url, hook_url, label, created_at FROM discord_hooks ORDER BY id DESC'
  ).all<{ id: number; scope: string; feed_url: string; hook_url: string; label: string | null; created_at: number }>();
  const hooks = ((rows && rows.results) || []).map((h) => ({
    id: h.id, scope: h.scope, scope_label: scopeLabel(h.scope), feed_url: h.feed_url,
    /* Never echo the full webhook (it is a bearer secret); a masked tail is
       enough for an admin to tell two subscriptions apart. */
    hook_hint: maskWebhook(h.hook_url), label: h.label || '', created_at: h.created_at,
  }));
  return json({ ok: true, hooks }, 200);
}

async function handleAdminDiscordAdd(request: Request, env: Env) {
  const pre = await adminGated(request, env);
  if (pre instanceof Response) return pre;
  const { data, key, me } = pre;
  const feedUrl = String(data.feed_url || '').trim();
  const hookUrl = String(data.hook_url || '').trim();
  const label = String(data.label || '').trim().slice(0, 120);
  const scope = parseFeedScope(feedUrl);
  if (!scope) return json({ ok: false, error: 'That is not one of our feed URLs. Paste a /api/comments/feed link with a ?topic=, ?cat=, or ?page= selector.' }, 400);
  if (!isDiscordWebhook(hookUrl)) return json({ ok: false, error: 'That is not a valid Discord webhook URL.' }, 400);
  const now = Math.floor(Date.now() / 1000);
  /* An exact (scope + webhook) pair twice is pointless; refuse the duplicate. */
  const dup = await env.DB.prepare('SELECT id FROM discord_hooks WHERE scope = ?1 AND hook_url = ?2').bind(scope, hookUrl).first<{ id: number }>();
  if (dup) return json({ ok: false, error: 'That feed already posts to that Discord channel.' }, 409);
  await env.DB.prepare(
    'INSERT INTO discord_hooks (scope, feed_url, hook_url, label, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(scope, feedUrl, hookUrl, label || null, now, me).run();
  return json({ ok: true, scope, scope_label: scopeLabel(scope) }, 200);
}

async function handleAdminDiscordDelete(request: Request, env: Env) {
  const pre = await adminGated(request, env);
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const id = Math.floor(Number(data.id) || 0);
  if (id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  await env.DB.prepare('DELETE FROM discord_hooks WHERE id = ?1').bind(id).run();
  return json({ ok: true, id }, 200);
}

/* Mask a webhook URL for display: keep the host + a short tail of the token,
   hide the id and the rest of the secret. Never returns the full URL. */
function maskWebhook(u: unknown) {
  const s = String(u || '');
  const m = s.match(/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)/);
  if (!m) return 'webhook';
  const tail = m[3].slice(-6);
  return 'discord.com/…/…' + tail;
}

/* The alerts' test door (2026-09-16): sends one alert through whatever the
   Alerts settings open — email, Discord or both — and answers with what each
   channel said ({email, discord, channels, errors}), so an unverified
   destination or a dead webhook is read on the admin's screen, not guessed. */
async function handleAlertTest(request: Request, env: Env) {
  let data: { key?: unknown };
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const me = await sha256hex(key);
  let who = me.slice(0, 8);
  try {
    const row = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(me).first<{ nick: string | null }>();
    if (row && row.nick) who = String(row.nick);
  } catch (e) { /* the hash prefix will do */ }
  const at = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const result = await sendAlert(env, {
    kind: 'test',
    subject: 'Test alert',
    text: 'A test alert from merecatholicity.com, sent by ' + who + ' at ' + at + ' from Admin → Platform settings → Alerts. If you are reading this, the channel works.',
  });
  return json({ ok: true, ...result }, 200);
}

async function handleBackup(request: Request, env: Env) {
  let data: { key?: unknown };
  try {
    data = await request.json<{ key?: unknown }>();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  /* the documented shape: a failure is `backup.error`, never a 5xx (runBackup
     records it in ops_backup and rethrows for the cron runner's sake) */
  try {
    const result = await runBackup(env);
    return json({ ok: true, backup: result }, 200);
  } catch (e) {
    return json({ ok: true, backup: { error: String(e).slice(0, 300) } }, 200);
  }
}

/* The health card (2026-09-16): heartbeats, the last backup and its object,
   open conditions, the nightly webtest's last report — ops.ts readOps. */
async function handleOpsHealth(request: Request, env: Env) {
  let data: { key?: unknown };
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  return json({ ok: true, health: await readOps(env) }, 200);
}

async function handleLock(request: Request, env: Env) {
  let data: { key?: unknown; hash?: unknown; locked?: unknown };
  try { data = await request.json<{ key?: unknown; hash?: unknown; locked?: unknown }>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
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

/* Shadow ban (global mute), the quiet cousin of lock: on inserts a shadowbans
   row, off deletes it. A muted identity keeps posting (never logged out, never
   refused — this is NOT a blockedReason), but the read paths hide its public
   content from everyone else and the write paths announce nothing on its behalf.
   Refreshing every affected topic's denormalized stats is unnecessary: the read
   filters recompute visibility live, and refreshTopicStats already re-excludes a
   muted author whenever the thread next mutates. Admin-only, like lock. */
async function handleShadowban(request: Request, env: Env) {
  let data: { key?: unknown; hash?: unknown; on?: unknown; shadowbanned?: unknown };
  try { data = await request.json<{ key?: unknown; hash?: unknown; on?: unknown; shadowbanned?: unknown }>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  /* Never mute the librarian, and never mute an admin (a mute an admin can't
     see would be a foot-gun); the roster stays legible. */
  if (hash === MERECAT_BOT.hash || (await isAdminHash(env, hash))) {
    return json({ ok: false, error: 'That identity cannot be shadow banned.' }, 400);
  }
  const on = !!(data.on === true || data.on === 1 || data.on === '1' || data.shadowbanned);
  if (on) {
    await env.DB.prepare('INSERT OR IGNORE INTO shadowbans (hash, created_at, added_by) VALUES (?1, ?2, ?3)')
      .bind(hash, Math.floor(Date.now() / 1000), await sha256hex(key)).run();
  } else {
    await env.DB.prepare('DELETE FROM shadowbans WHERE hash = ?1').bind(hash).run();
  }
  return json({ ok: true, shadowbanned: on }, 200);
}

/* The whole shadow-ban roster, for the management page on admin.html (the twin
   of the IP ban list). Admin-only. Each row carries the muted identity's
   assigned/chosen name and when it was muted, so an admin can lift a mute
   without hunting for the post that set it. */
async function handleShadowbanList(request: Request, env: Env) {
  const pre = await adminGated(request, env);
  if (pre instanceof Response) return pre;
  const { key } = pre;
  const rows = await env.DB.prepare(
    'SELECT s.hash, s.created_at, pr.nick FROM shadowbans s LEFT JOIN profiles pr ON pr.hash = s.hash ORDER BY s.created_at DESC'
  ).all<{ hash: string; created_at: number; nick: string | null }>();
  const bans = (rows.results || []).map((r) => ({
    hash: r.hash, nick: r.nick || displayName(r.hash), created_at: r.created_at,
  }));
  return json({ ok: true, bans }, 200);
}

/* Delete a user and all their public posts: comments go to 'deleted', the
   profile and avatar are removed, and the identity is locked so the same key
   cannot post again. Private DMs are left untouched. */
async function handleDeleteUser(request: Request, env: Env) {
  let data: { key?: unknown; hash?: unknown };
  try { data = await request.json<{ key?: unknown; hash?: unknown }>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
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
  ).bind(hash).all<{ topic: number }>();
  /* Their attachments' bytes go with them (retraction semantics, same as a
     single delete); the hourly sweep is the backstop if this purge fails. */
  try {
    const mk = await env.DB.prepare(
      'SELECT media_key FROM comments WHERE author_hash = ?1 AND media_key IS NOT NULL'
    ).bind(hash).all<{ media_key: string | null }>();
    const keys = (mk.results || []).map((r) => r.media_key).filter(Boolean) as string[];
    if (keys.length) {
      await purgeWallMedia(env, keys);
      await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL WHERE author_hash = ?1').bind(hash).run();
    }
  } catch (e) { /* the sweep reclaims it */ }
  await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE author_hash = ?1 AND status != 'deleted'")
    .bind(hash).run();
  /* Their FEED goes with them too (2026-09-12; the feed came after this
     handler and had been left out): every post of theirs — with the comments
     under it, everyone's — and every comment of theirs under others' posts,
     hard-deleted the way /wall/delete deletes, every attachment's bytes purged
     with the rows, the reactions on them gone, and the surviving posts'
     comment counts recomputed. The hourly orphan sweep is the backstop. */
  try {
    const keys: string[] = [];
    const mine = await env.DB.prepare('SELECT id, media_key FROM wall_posts WHERE author_hash = ?1').bind(hash)
      .all<{ id: number; media_key: string | null }>();
    const postIds = (mine.results || []).map((r) => r.id);
    (mine.results || []).forEach((r) => { if (r.media_key) keys.push(r.media_key); });
    if (postIds.length) {
      const ph = inList(postIds.length);
      const under = await env.DB.prepare('SELECT media_key FROM wall_comments WHERE post_id IN (' + ph + ') AND media_key IS NOT NULL')
        .bind(...postIds).all<{ media_key: string | null }>();
      (under.results || []).forEach((r) => { if (r.media_key) keys.push(r.media_key); });
      await env.DB.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (SELECT id FROM wall_comments WHERE post_id IN (" + ph + '))').bind(...postIds).run();
      await env.DB.prepare('DELETE FROM wall_comments WHERE post_id IN (' + ph + ')').bind(...postIds).run();
      await env.DB.prepare("DELETE FROM reactions WHERE target = 'wall' AND target_id IN (" + ph + ')').bind(...postIds).run();
      await env.DB.prepare('DELETE FROM wall_posts WHERE id IN (' + ph + ')').bind(...postIds).run();
    }
    const theirs = await env.DB.prepare('SELECT id, post_id, media_key FROM wall_comments WHERE author_hash = ?1').bind(hash)
      .all<{ id: number; post_id: number; media_key: string | null }>();
    const cIds = (theirs.results || []).map((r) => r.id);
    const touched = [...new Set((theirs.results || []).map((r) => r.post_id))];
    (theirs.results || []).forEach((r) => { if (r.media_key) keys.push(r.media_key); });
    if (cIds.length) {
      const ph2 = inList(cIds.length);
      await env.DB.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (" + ph2 + ')').bind(...cIds).run();
      await env.DB.prepare('DELETE FROM wall_comments WHERE id IN (' + ph2 + ')').bind(...cIds).run();
    }
    for (let i = 0; i < touched.length; i += 50) {
      const chunk = touched.slice(i, i + 50);
      await env.DB.prepare("UPDATE wall_posts SET comments = (SELECT COUNT(*) FROM wall_comments WHERE post_id = wall_posts.id AND status = 'live') WHERE id IN (" + inList(chunk.length) + ')').bind(...chunk).run();
    }
    if (keys.length) await purgeWallMedia(env, keys);
  } catch (e) { console.log(JSON.stringify({ event: 'delete_user_feed_failed', hash, error: String(e) })); }
  /* Any journal article of theirs is deleted now, so its comments retire too. */
  await sweepJournalComments(env);
  await env.DB.prepare('DELETE FROM profiles WHERE hash = ?1').bind(hash).run();
  if (env.AVATARS) await env.AVATARS.delete('avatars/' + hash);
  await env.DB.prepare('INSERT OR IGNORE INTO locks (hash, created_at) VALUES (?1, ?2)')
    .bind(hash, Math.floor(Date.now() / 1000)).run();
  for (const r of affected.results) await refreshTopicStats(env, r.topic);
  return json({ ok: true }, 200);
}

/* Ban or unban IPs. Accepts a single `ip` (the manual list page) or an `ips`
   array (ban-all from the fingerprint drawer). Each is normalized to its ban
   key: a v4 address verbatim, a v6 address to its /64 prefix, so one row holds
   a whole rotating /64 and banning an identity's addresses shuts both families
   at once. */
async function handleIpBan(request: Request, env: Env) {
  let data: { key?: unknown; ip?: unknown; ips?: unknown; banned?: unknown };
  try { data = await request.json<{ key?: unknown; ip?: unknown; ips?: unknown; banned?: unknown }>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const cip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: cip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const raw = Array.isArray(data.ips) ? data.ips : [data.ip];
  const keys = [...new Set(raw.map(toBanKey).filter(Boolean))];
  if (!keys.length) return json({ ok: false, error: 'That is not a valid IP address.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const now = Math.floor(Date.now() / 1000);
  for (const k of keys) {
    if (data.banned) {
      await env.DB.prepare('INSERT OR IGNORE INTO ip_bans (ip, created_at) VALUES (?1, ?2)').bind(k, now).run();
    } else {
      await env.DB.prepare('DELETE FROM ip_bans WHERE ip = ?1').bind(k).run();
    }
  }
  return json({ ok: true, banned: !!data.banned, keys }, 200);
}

/* Lazy, admin-only reverse-DNS for the IPs of one fingerprint, fetched when a
   drawer opens. Kept off the bulk meta path and the poster's write path; a
   handful of DoH lookups per call, well under the free-tier subrequest cap. */
async function handleRdns(request: Request, env: Env) {
  const pre = await adminGated(request, env, { bucket: 'READ_LIMIT' });
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const ips = Array.isArray(data.ips) ? data.ips.slice(0, 8) : [];
  const rdns: Record<string, string | null> = {};
  await Promise.all(ips.map(async (raw: unknown) => {
    const s = String(raw || '').trim();
    if (looksLikeIp(s)) rdns[s] = await ptrLookup(s);
  }));
  return json({ ok: true, rdns }, 200);
}

/* The banned-IP list for the admin page. */
async function handleIpBans(request: Request, env: Env) {
  const pre = await adminGated(request, env, { bucket: 'READ_LIMIT' });
  if (pre instanceof Response) return pre;
  const { ip } = pre;
  const rows = await env.DB.prepare('SELECT ip, created_at FROM ip_bans ORDER BY created_at DESC LIMIT 1000')
    .all<{ ip: string; created_at: number }>();
  return json({ ok: true, ips: rows.results }, 200);
}

/* The admin roster for the console: every admin, equal, each removable, carried
   with the name they post under so the list reads in people, not hashes. Seeded
   from the env owners on first view so they appear as ordinary rows. */
async function handleAdmins(request: Request, env: Env) {
  const pre = await adminGated(request, env, { bucket: 'READ_LIMIT' });
  if (pre instanceof Response) return pre;
  await ensureAdminsSeeded(env);
  const dyn = await env.DB.prepare('SELECT hash, created_at FROM admins ORDER BY created_at, hash')
    .all<{ hash: string; created_at: number }>();
  /* the roster row the console reads: the nick and the assigned pseudonym are
     filled in below, once one query has resolved them all */
  const list: { hash: string; created_at: number; nick?: string | null; assigned?: string }[] =
    (dyn.results || []).map((r) => ({ hash: r.hash, created_at: r.created_at }));
  /* Resolve each admin's chosen nick in one query; the assigned pseudonym is
     pure from the hash, so it fills the rest. */
  if (list.length) {
    const ph = inList(list.length);
    const rows = await env.DB.prepare('SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')')
      .bind(...list.map((a) => a.hash)).all<{ hash: string; nick: string | null }>();
    const nick: Record<string, string | null> = {};
    for (const r of (rows.results || [])) nick[r.hash] = r.nick;
    for (const a of list) { a.nick = nick[a.hash] || null; a.assigned = displayName(a.hash); }
  }
  return json({ ok: true, admins: list }, 200);
}

/* Grant or revoke admin. Every admin is equal: any admin may promote a member
   (picked by @-mention in the console) or drop any admin, owners and themselves
   included. The one guard is a rule about count, not about who — the last admin
   cannot be removed, so the board is never left with none, an irreversible
   lockout. Add another first, then step down. */
async function handleAdmin(request: Request, env: Env) {
  let data: { key?: unknown; hash?: unknown; admin?: unknown; on?: unknown };
  try { data = await request.json<{ key?: unknown; hash?: unknown; admin?: unknown; on?: unknown }>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = key ? await sha256hex(key) : '';
  if (!(await isAdminHash(env, me))) return json({ ok: false, error: 'No.' }, 403);
  await ensureAdminsSeeded(env);
  if (data.admin) {
    await env.DB.prepare('INSERT OR IGNORE INTO admins (hash, added_by, created_at) VALUES (?1, ?2, ?3)')
      .bind(hash, me, Math.floor(Date.now() / 1000)).run();
    return json({ ok: true, admin: true }, 200);
  }
  const present = await env.DB.prepare('SELECT 1 AS a FROM admins WHERE hash = ?1').bind(hash).first();
  if (present) {
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first<{ n: number }>();
    if (cnt && cnt.n <= 1) {
      return json({ ok: false, error: 'This is the last admin. Add another before removing this one.' }, 400);
    }
  }
  await env.DB.prepare('DELETE FROM admins WHERE hash = ?1').bind(hash).run();
  return json({ ok: true, admin: false }, 200);
}

export {
  handleAdmin,
  handleAdminDiscordAdd,
  handleAdminDiscordDelete,
  handleAdminDiscordList,
  handleAdminSettings,
  handleAdmins,
  handleAlertTest,
  handleBackup,
  handleDeleteUser,
  handleIpBan,
  handleIpBans,
  handleLock,
  handleOpsHealth,
  handleRdns,
  handleShadowban,
  handleShadowbanList,
  maskWebhook,
};
