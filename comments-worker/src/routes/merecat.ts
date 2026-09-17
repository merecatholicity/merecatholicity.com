/* comments-worker/src/routes/merecat.ts — merecat, the librarian: the admin's observed threads, the backends, the chats, the shelf's ingest, the @mention kick, the forward into the forum, usage, about, works, config and stats, the ask-init and the live door.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import * as Merecat from '../../../purescript/output/Domain.Merecat/index.js';
import { inList } from '../db.ts';
import {
  ADMIN_CAT,
  MAX_BODY,
  MERECAT_CHAT_DAYS,
  MERECAT_DEFAULTS,
  blockedJson,
  blockedReason,
  boardKey,
  isAdminHash,
  json,
  merecatConfig,
  merecatConfigCache,
  merecatDay,
  merecatReasoningView,
  merecatFinishAnswer,
  merecatInsertComment,
  merecatMentionReply,
  merecatQuota,
  originOk,
  quotaPublic,
  requireAdmin,
  sha256hex,
  gated,
  adminGated,
  ingestGated,
  registerMember,
  throttle,
} from '../lib.ts';
import type { Env } from '../env.ts';
import type { Body } from '../lib.ts';

/* ---- Admin observation of merecat Q&A (2026-07-29). The terms disclose that
   questions may be reviewed for the improvement of the service; these two
   admin-keyed, READ-ONLY endpoints let an admin observe how members use the
   librarian (to guide what to teach it next) WITHOUT participating. They only
   ever SELECT — no prune, no write, nothing touched. This deliberately adds
   the admin-read path the design once withheld, now that the terms allow it. */
async function handleMerecatAdminThreads(request: Request, env: Env) {
  const pre = await adminGated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const per = 30;
  const pg = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  /* A rolling thirty-day window, matching the thread expiry: this is a bird's
     eye view of recent use, not a keep. A saved thread is exempt from expiry
     (it lives on in its owner's list), but past thirty days it drops OFF this
     admin view all the same — the owner's word. A deleted thread is gone from
     chats outright, so it never appears here either. */
  const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
  const total = await env.LIBDB.prepare('SELECT COUNT(*) AS n FROM chats WHERE last_at >= ?1').bind(cut).first();
  const rows = await env.LIBDB.prepare(
    'SELECT id, hash, title, COALESCE(msgs, 0) AS msgs, created_at, last_at, COALESCE(saved, 0) AS saved ' +
    'FROM chats WHERE last_at >= ?1 ORDER BY last_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(cut, per, (pg - 1) * per).all<ChatThreadRow>();
  const threads: ChatThreadRow[] = rows.results || [];
  /* Nicks live in the comments DB, not LIBDB — resolve them in one batch. */
  const hashes = [...new Set(threads.map((t) => t.hash).filter(Boolean))];
  const nicks: Record<string, string | null> = {};
  if (hashes.length) {
    const ph = inList(hashes.length);
    const prof = await env.DB.prepare('SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')').bind(...hashes)
      .all<{ hash: string; nick: string | null }>();
    for (const r of (prof.results || [])) nicks[r.hash] = r.nick;
  }
  for (const t of threads) t.nick = nicks[t.hash] || null;
  return json({ ok: true, threads, total: (total && total.n) || 0, page: pg, per }, 200);
}

async function handleMerecatAdminThread(request: Request, env: Env) {
  const pre = await adminGated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
  const chat = await env.LIBDB.prepare(
    'SELECT id, hash, title, COALESCE(msgs, 0) AS msgs, created_at, last_at, COALESCE(saved, 0) AS saved FROM chats WHERE id = ?1 AND last_at >= ?2'
  ).bind(id, cut).first();
  if (!chat) return json({ ok: false, error: 'No such conversation.' }, 404);
  const msgs = await env.LIBDB.prepare(
    'SELECT id, role, body, sources, created_at, COALESCE(done, 1) AS done FROM chat_msgs WHERE chat_id = ?1 ORDER BY id LIMIT 400'
  ).bind(id).all();
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(chat.hash).first();
  chat.nick = (prof && prof.nick) || null;
  return json({ ok: true, chat, msgs: msgs.results || [] }, 200);
}

/* Status for the admin page: which model answers and where the community
   stands against its daily budget. Admin only. The GPU box this used to probe
   over Tailscale was retired on 2026-09-10; `backend` is kept in the answer
   for one deploy so a client built before that still reads it. */
async function handleMerecatBackends(request: Request, env: Env) {
  let data: any = {};
  try { data = await request.json(); } catch { return json({ ok: false, error: 'No.' }, 403); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const today = (g && g.q) || 0;
  return json({ ok: true, backend: 'cloudflare', model: cfg.model, mention_effort: cfg.mention_effort,
    reasoning: merecatReasoningView(cfg), quota: await merecatQuota(env, cfg),
    temperature: cfg.temperature, band_weights: cfg.band_weights,
    max_tokens: cfg.max_tokens, topk: cfg.topk, last_ingest: cfg.last_ingest, last_ingest_by: cfg.last_ingest_by,
    cloudflare: { online: true, today, gcap: cfg.global_daily } }, 200);
}

/* Keep a long thread rememberable at a bounded cost: once turns age past
   the verbatim window, condense them into the thread's running summary with
   one cheap model call, made after the answer is already on its way so it
   never adds latency. A failed fold just waits for the next turn. */
async function handleMerecatChats(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.', block: true });
  if (pre instanceof Response) return pre;
  const { me } = pre;
  const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
  // saved threads are kept permanently: the expiry sweeps pass them by
  await env.LIBDB.batch([
    env.LIBDB.prepare(
      'DELETE FROM chat_msgs WHERE chat_id IN (SELECT id FROM chats WHERE hash = ?1 AND last_at < ?2 AND COALESCE(saved, 0) = 0)'
    ).bind(me, cut),
    env.LIBDB.prepare('DELETE FROM chats WHERE hash = ?1 AND last_at < ?2 AND COALESCE(saved, 0) = 0').bind(me, cut),
  ]);
  const rows = await env.LIBDB.prepare(
    'SELECT id, title, msgs, last_at, COALESCE(saved, 0) AS saved FROM chats WHERE hash = ?1 ORDER BY last_at DESC LIMIT 50'
  ).bind(me).all();
  return json({ ok: true, chats: rows.results || [] }, 200);
}

async function handleMerecatChat(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { ip, data, me } = pre;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const chat = await env.LIBDB.prepare(
    'SELECT id, title, msgs, created_at, last_at FROM chats WHERE id = ?1 AND hash = ?2'
  ).bind(id, me).first();
  if (!chat) return json({ ok: false, error: 'No such conversation.' }, 404);
  const msgs = await env.LIBDB.prepare(
    'SELECT id, role, body, sources, created_at, COALESCE(done, 1) AS done FROM chat_msgs WHERE chat_id = ?1 ORDER BY id LIMIT 400'
  ).bind(id).all();
  return json({ ok: true, chat, msgs: msgs.results || [] }, 200);
}

async function handleMerecatChatDelete(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { ip, data, me } = pre;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2')
    .bind(id, me).first();
  if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  await env.LIBDB.batch([
    env.LIBDB.prepare('DELETE FROM chat_msgs WHERE chat_id = ?1').bind(id),
    env.LIBDB.prepare('DELETE FROM chats WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true, deleted: id }, 200);
}

/* Save (or unsave) a conversation: a saved thread is exempt from the
   thirty-day expiry — both the listing's opportunistic prune and the monthly
   cron pass it by — until its owner unsaves or deletes it. Unsaving a thread
   already past the cut lets the next sweep take it, which the client warns of. */
async function handleMerecatChatSave(request: Request, env: Env) {
  let data: Body;
  try { data = await request.json<Body>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  // READ_LIMIT, not POST_LIMIT: a save is a metadata toggle, and a burst of
  // save/unsave clicks is legitimate — the 5-writes-a-minute throttle once
  // 429'd a retried save that the first (response-lost) attempt had already
  // landed, which the client then swallowed in silence.
  if (!(await throttle(env, 'READ_LIMIT', ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!key || !Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const save = data.save ? 1 : 0;
  const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2')
    .bind(id, me).first();
  if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  await env.LIBDB.prepare('UPDATE chats SET saved = ?2 WHERE id = ?1').bind(id, save).run();
  return json({ ok: true, id, saved: save }, 200);
}

/* Monthly sweep of expired threads (the opportunistic per-owner prune in
   handleMerecatChats covers everyone who returns; this catches the rest).
   Self-contained like every prune, so a failure never stops the backup. */
/* The librarian rooms are derived data with no migration ledger: a column the
   worker starts to read is added here, once per isolate per room, and
   backfilled for the rows that predate it (2026-09-17: works.text_bytes, so
   the pipeline's size projection sums a column instead of scanning every
   chunk — the deep rooms were reading 49,076 and 25,046 rows a call). The
   backfill touches only works that have chunks and no size yet, through the
   chunks_work_idx index; a second isolate racing the ALTER meets "duplicate
   column" and carries on. */
const LIB_TEXT_BYTES = "SELECT COALESCE(SUM(LENGTH(text) + LENGTH(COALESCE(heading, ''))), 0) FROM chunks WHERE work_id = works.id";
const libSchemaReady = new WeakSet<D1Database>();
export async function ensureLibSchema(db: D1Database | undefined) {
  if (!db || libSchemaReady.has(db)) return;
  const cols = await db.prepare('PRAGMA table_info(works)').all<{ name: string }>();
  if (!(cols.results || []).some((c) => c.name === 'text_bytes')) {
    try { await db.prepare('ALTER TABLE works ADD COLUMN text_bytes INTEGER NOT NULL DEFAULT 0').run(); } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
  await db.prepare('UPDATE works SET text_bytes = (' + LIB_TEXT_BYTES + ') WHERE text_bytes = 0 AND chunks > 0').run();
  libSchemaReady.add(db);
}

async function handleMerecatIngest(request: Request, env: Env) {
  const pre = await ingestGated(request, env);
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const mode = String(data.mode || '');
  const work = data.work || {};
  const id = String(work.id || '');
  if (!id || !/^[a-z0-9-]{1,40}$/.test(id)) return json({ ok: false, error: 'Bad work id.' }, 400);
  // which room: works.yml store: deep -> LIBDB2, deep2 -> LIBDB3, else room one
  const st = String(data.store || work.store || '');
  const LIB = (st === 'deep2' && env.LIBDB3) ? env.LIBDB3
    : (st === 'deep' && env.LIBDB2) ? env.LIBDB2 : env.LIBDB;

  if (mode === 'begin' || mode === 'delete') {
    /* Sweep BOTH rooms, not just the target: when a work's store flag flips
       rooms, the old room would otherwise keep a stale twin — same cids, so
       the first room searched shadows the fresh text out of the retrieval
       pool, and the /works union carries two hashes for one id, which makes
       ingest re-push the work on every run. Vectors are cleared over the
       union of both rooms' cids (only Tier-1 works ever have them). */
    const cidset = new Set();
    for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
      if (!db) continue;
      try {
        const olds = await db.prepare('SELECT cid FROM chunks WHERE work_id = ?1').bind(id).all();
        for (const r of olds.results || []) cidset.add(r.cid);
      } catch (err) {
        console.log(JSON.stringify({ event: 'merecat_clear_failed', error: String(err) }));
      }
    }
    const cids = [...cidset];
    // deleteByIds has a LOW per-call id cap (a 257-id call fails outright, a
    // 50-id call succeeds) — the old 1000-per-call batching made every sweep
    // of a real-sized work fail silently into this catch, which is how two
    // de-vectorized works kept their stale vectors (found 2026-07-28).
    for (let i = 0; i < cids.length; i += 50) {
      try { await env.MERECAT_INDEX.deleteByIds(cids.slice(i, i + 50) as string[]); }
      catch (err) { console.log(JSON.stringify({ event: 'merecat_vecdel_failed', error: String(err) })); }
      // breathe between batches: a multi-work prune once fired ~60 calls
      // back-to-back and the API rate-limited some sweeps into the catch
      if (i + 50 < cids.length) await new Promise((res) => setTimeout(res, 250));
    }
    for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
      if (!db) continue;
      try {
        if (db === LIB && mode !== 'delete') {
          // the target room keeps its works row for the upsert below
          await db.prepare('DELETE FROM chunks WHERE work_id = ?1').bind(id).run();
        } else {
          await db.batch([
            db.prepare('DELETE FROM chunks WHERE work_id = ?1').bind(id),
            db.prepare('DELETE FROM works WHERE id = ?1').bind(id),
          ]);
        }
      } catch (err) {
        console.log(JSON.stringify({ event: 'merecat_sweep_failed', error: String(err) }));
      }
    }
    if (mode === 'delete') return json({ ok: true, deleted: id }, 200);
    await LIB.prepare(
      'INSERT INTO works (id, title, url, tier, kind, hash, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6) ' +
      'ON CONFLICT(id) DO UPDATE SET title = ?2, url = ?3, tier = ?4, kind = ?5, hash = NULL, updated_at = ?6'
    ).bind(id, String(work.title || id), String(work.url || ''),
      Math.min(9, Math.max(1, Number(work.tier) || 3)), String(work.kind || ''),
      Math.floor(Date.now() / 1000)).run();
    return json({ ok: true, began: id }, 200);
  }

  if (mode === 'append') {
    const rows = Array.isArray(data.chunks) ? data.chunks : [];
    if (!rows.length || rows.length > 480) return json({ ok: false, error: 'Bad batch size.' }, 400);
    // Multi-row inserts: 6 params a row, 16 rows a statement, well inside
    // D1's 100-bound-params and 50-queries-per-invocation limits.
    const stmts = [];
    for (let i = 0; i < rows.length; i += 16) {
      const slice = rows.slice(i, i + 16);
      const values = slice.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
      const binds = [];
      for (const r of slice) {
        binds.push(String(r.cid || ''), id, Number(r.seq) || 0,
          String(r.heading || ''), String(r.anchor || ''), String(r.text || ''));
      }
      stmts.push(LIB.prepare(
        'INSERT OR REPLACE INTO chunks (cid, work_id, seq, heading, anchor, text) VALUES ' + values
      ).bind(...binds));
    }
    await LIB.batch(stmts);
    let vectored = 0;
    if (data.vectorize) {
      const meta = { title: String(work.title || id), url: String(work.url || ''), tier: Number(work.tier) || 1 };
      // small slices, one retry each, and a failed slice degrades to BM25-only
      // instead of failing the whole push — the next content-hash push heals it
      for (let i = 0; i < rows.length; i += 40) {
        const slice = rows.slice(i, i + 40);
        let vecs = null;
        for (let attempt = 0; attempt < 2 && !vecs; attempt++) {
          try {
            /* the embedding model answers { data: number[][] }; the binding's
               overloads carry an async-queue shape too, which this call never takes */
            const emb = await env.AI.run('@cf/baai/bge-m3', {
              text: slice.map((r: any) => (r.heading ? r.heading + ': ' : '') + String(r.text || '').slice(0, 1800)),
            }) as { data?: number[][] };
            vecs = (emb && emb.data) || null;
          } catch (err) {
            console.log(JSON.stringify({ event: 'merecat_embed_failed', work: id, at: i, attempt, error: String(err) }));
          }
        }
        if (!vecs) continue;
        const upserts = [];
        for (let j = 0; j < slice.length; j++) {
          if (!vecs[j]) continue;
          upserts.push({
            id: String(slice[j].cid), values: vecs[j],
            metadata: { work: id, title: meta.title, tier: meta.tier,
              url: meta.url + (slice[j].anchor ? '#' + slice[j].anchor : '') },
          });
        }
        if (upserts.length) {
          try { await env.MERECAT_INDEX.upsert(upserts); vectored += upserts.length; }
          catch (err) {
            console.log(JSON.stringify({ event: 'merecat_upsert_failed', work: id, at: i, error: String(err) }));
          }
        }
      }
    }
    return json({ ok: true, inserted: rows.length, vectored }, 200);
  }

  if (mode === 'end') {
    // the chunk count and the text size stamp the works row here, so roster
    // reads and the size projection never scan (the size is one indexed
    // aggregate over this work's own chunks)
    await ensureLibSchema(LIB);
    await LIB.prepare('UPDATE works SET hash = ?2, chunks = ?3, updated_at = ?4, text_bytes = (' + LIB_TEXT_BYTES + ') WHERE id = ?1')
      .bind(id, String(work.hash || ''), Number(work.chunks) || 0, Math.floor(Date.now() / 1000)).run();
    return json({ ok: true, ended: id }, 200);
  }

  return json({ ok: false, error: 'Bad mode.' }, 400);
}

/* Hand a mention reply to the ChatRoom DO (a dedicated 'mention:<id>'
   instance) and return on its ack. The generation itself outlives this call
   on the DO's own lifetime — a stateless invocation's waitUntil is cancelled
   ~30s after the response, far short of a local-backend generation. The
   direct call survives only as the no-binding fallback. */
async function merecatMentionKick(env: any, id: any) {
  try {
    if (env.CHAT) {
      const r = await env.CHAT.get(env.CHAT.idFromName('mention:' + id)).fetch('https://do/mention', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      if (r.ok) return true;
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'merecat_mention_kick_failed', error: String(e), id }));
  }
  await merecatMentionReply(env, id)
    .catch((e) => console.log(JSON.stringify({ event: 'merecat_mention_failed', error: String(e), id })));
  return false;
}

/* The bot's whole public profile is hardcoded here (the avatar object sits in
   R2 under its hash like anyone's): Nicene by confession, bio and signature
   fixed, upserted on every reply so this code stays the source of truth. The
   avatar column is left alone — it carries the upload stamp. */
async function handleMerecatMention(request: Request, env: Env) {
  const pre = await adminGated(request, env);
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const queued = await merecatMentionKick(env, id);
  return json({ ok: true, queued }, 200);
}

/* Forward one private answer to a public topic, by the thread's owner and
   nobody else. The post goes up under the librarian's own name, marked as
   forwarded by the member, with the question quoted and the cited-sources
   footer rebuilt — bot words stay under the bot's name, and nothing private
   goes public except by the owner's hand. */
async function handleMerecatForward(request: Request, env: Env) {
  let data: Body;
  try { data = await request.json<Body>(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'POST_LIMIT', ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const chatId = Number(data.chat);
  const topicId = Number(data.topic);
  if (!key || !Number.isInteger(chatId) || chatId < 1 || !Number.isInteger(topicId) || topicId < 1) {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2')
    .bind(chatId, me).first();
  if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  /* the answer being forwarded: the conversation's last, or one named by id */
  type AnswerRow = { id: number; body: string | null; sources: string | null };
  const msg = data.msg === 'last'
    ? await env.LIBDB.prepare(
        "SELECT id, body, sources FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' ORDER BY id DESC LIMIT 1"
      ).bind(chatId).first<AnswerRow>()
    : await env.LIBDB.prepare(
        "SELECT id, body, sources FROM chat_msgs WHERE id = ?1 AND chat_id = ?2 AND role = 'assistant'"
      ).bind(Number(data.msg), chatId).first<AnswerRow>();
  if (!msg) return json({ ok: false, error: 'No such answer in that conversation.' }, 404);
  const topic = await env.DB.prepare(
    "SELECT id, page, locked, author_hash FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
  ).bind(topicId).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  if (topic.page === ADMIN_CAT && !(await isAdminHash(env, me))) {
    return json({ ok: false, error: 'That topic is for admins only.' }, 403);
  }
  if (topic.locked) return json({ ok: false, error: 'That topic is locked.' }, 403);

  const q = await env.LIBDB.prepare(
    "SELECT body FROM chat_msgs WHERE chat_id = ?1 AND role = 'user' AND id < ?2 ORDER BY id DESC LIMIT 1"
  ).bind(chatId, msg.id).first<{ body: string | null }>();
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(me).first<{ nick: string | null }>();
  const who = (prof && prof.nick) || 'a member';
  let srcs = [];
  try { srcs = JSON.parse(msg.sources || '[]'); } catch { /* footer just stays off */ }
  let finished = merecatFinishAnswer(String(msg.body || ''), srcs);
  const head = 'Forwarded from the librarian\u2019s desk by ' + who + '.' +
    (q && q.body ? '\n\n> ' + String(q.body).replace(/\s+/g, ' ').slice(0, 300) : '') + '\n\n';
  // fit the board's body cap, trimming the answer, never the footer
  const room = MAX_BODY - head.length;
  if (finished.length > room) {
    const cut = finished.lastIndexOf('\n\nSources:\n');
    if (cut !== -1 && cut < room - 40) {
      const footer = finished.slice(cut);
      finished = finished.slice(0, room - footer.length - 6).trimEnd() + ' [\u2026]' + footer;
    } else {
      finished = finished.slice(0, room - 6).trimEnd() + ' [\u2026]';
    }
  }
  const replyId = await merecatInsertComment(env, { page: topic.page, parent_id: null },
    true, topicId, topic.author_hash, head + finished);
  return json({ ok: true, id: replyId, topic: topicId }, 200);
}

/* The quota line's feed: a few tiny reads so the page can always show
   "you have used N of M today" the moment it opens (the ask preamble keeps
   it fresh afterward). Admins read their true count against the same cap
   they are allowed to exceed. */
async function handleMerecatUsage(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { data, key, me } = pre;
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2')
    .bind(day, me).first();
  return json({
    ok: true,
    you: (u && u.q) || 0, cap: cfg.user_daily, cap_on: cfg.user_cap_on,
    today: (g && g.q) || 0, gcap: cfg.global_daily,
    admin: await isAdminHash(env, me),
    backend: 'cloudflare',   // kept one deploy for clients built before the GPU box retired
    reasoning: merecatReasoningView(cfg),
    quota: quotaPublic(await merecatQuota(env, cfg)),
  }, 200);
}

/* Full disclosure for the merecat page's "How merecat works" panel: the
   model id, the caps, the persona verbatim, the whole shelf with per-work
   chunk counts, today's community usage, and the asker's own count when a
   key rides along. Everything here is public site content or the reader's
   own number — no per-question data exists to disclose, since the server
   keeps counters only. */
async function handleMerecatAbout(request: Request, env: Env) {
  /* Admin-only since the public transparency panel retired (2026-07-28):
     this returns the persona verbatim and the whole roster, and the owner
     wills neither public. The administration page is the one consumer. */
  let data: any = {};
  try { data = await request.json(); } catch { return json({ ok: false, error: 'No.' }, 403); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'READ_LIMIT', ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  // per-work counts live on the works row (stamped at ingest end) so this
  // stays a 91-row read, not a scan of the whole chunk store
  const works = await env.LIBDB.prepare(
    'SELECT id, title, url, tier, chunks FROM works ORDER BY tier, title'
  ).all();
  // url-less works are the private shelves; the panel lists them under an
  // "additional works" heading with no links (the owner's standing word,
  // reversed 2026-07-28 from the earlier omission rule)
  const list = works.results || [];
  for (const db of [env.LIBDB2, env.LIBDB3]) {
    if (!db) continue;
    try {
      const deep = await db.prepare(
        'SELECT id, title, url, tier, chunks FROM works ORDER BY tier, title').all();
      for (const r of deep.results || []) list.push(r);
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_about2_failed', error: String(err) }));
    }
  }
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const out: any = {
    ok: true,
    model: cfg.model, topk: cfg.topk,
    user_daily: cfg.user_daily, user_cap_on: cfg.user_cap_on, global_daily: cfg.global_daily,
    backend: 'cloudflare',   // kept one deploy for clients built before the GPU box retired
    persona: cfg.persona,
    chunks: list.reduce((n: any, w: any) => n + (w.chunks || 0), 0),
    works: list,
    today: (g && g.q) || 0,
  };
  const key = String(data.key || '');
  if (key) {
    const me = await sha256hex(key);
    const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2')
      .bind(day, me).first();
    out.you = (u && u.q) || 0;
    out.admin = await isAdminHash(env, me);
  }
  return json(out, 200);
}

/* Works roster + content hashes, so ingest.py can skip unchanged works. */
async function handleMerecatWorks(request: Request, env: Env) {
  const pre = await ingestGated(request, env);
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const works = [];
  let tb1 = 0, tb2 = 0;
  const rows = await env.LIBDB.prepare(
    'SELECT id, title, tier, kind, hash, chunks FROM works ORDER BY tier, id').all<WorkRow>();
  for (const r of rows.results || []) works.push(r);
  // the stored text per room, from the sizes stamped at ingest end — never a
  // scan of the chunk store (2026-09-17)
  await ensureLibSchema(env.LIBDB);
  const t1 = await env.LIBDB.prepare(
    'SELECT COALESCE(SUM(text_bytes), 0) AS b FROM works').first<{ b: number }>();
  tb1 = (t1 && t1.b) || 0;
  let tb3 = 0;
  const deepRooms: [D1Database | undefined, number][] = [[env.LIBDB2, 2], [env.LIBDB3, 3]];
  for (const [db, tag] of deepRooms) {
    if (!db) continue;
    try {
      const rows2 = await db.prepare(
        'SELECT id, title, tier, kind, hash, chunks FROM works ORDER BY tier, id').all<WorkRow>();
      for (const r of rows2.results || []) works.push(r);
      await ensureLibSchema(db);
      const t2 = await db.prepare(
        'SELECT COALESCE(SUM(text_bytes), 0) AS b FROM works').first<{ b: number }>();
      if (tag === 2) tb2 = (t2 && t2.b) || 0; else tb3 = (t2 && t2.b) || 0;
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_works' + tag + '_failed', error: String(err) }));
    }
  }
  const pfh = await env.LIBDB.prepare(
    "SELECT v FROM config WHERE k = 'persona_file_hash'").first();
  return json({ ok: true, works, text_bytes: tb1, text_bytes_deep: tb2, text_bytes_deep2: tb3,
    persona_file_hash: (pfh && pfh.v) || '' }, 200);
}

/* Every dial the librarian has, with its coercion — the write is trusted
   (admin-keyed) but never raw: a value lands in the table only in the shape
   the reader (merecatConfig) would produce from it, so the dashboard, the
   file push and the read agree byte for byte. A key not here is dropped
   silently, as the app_settings allowlist drops its strangers. */
const MERECAT_CONFIG_KEYS: Record<string, (v: any) => string> = {
  model: (v) => String(v).trim().slice(0, 120),
  mention_effort: (v) => Merecat.effortParse(Merecat.reasoningDefaults.mention)(String(v)),
  reasoning_on: (v) => (String(v) === '1' || String(v) === 'true') ? '1' : '0',
  reasoning_default: (v) => Merecat.effortParse(Merecat.reasoningDefaults.deflt)(String(v)),
  reasoning_max: (v) => Merecat.effortParse(Merecat.reasoningDefaults.max)(String(v)),
  quota_guard_on: (v) => (String(v) === '0' || String(v) === 'false') ? '0' : '1',   // default-on: only an explicit no is off
  quota_guard_pct: (v) => String(Merecat.quotaGuardPctFrom(String(v))),
  temperature: (v) => String(Merecat.temperatureFrom(String(v))),
  band_weights: (v) => Merecat.bandWeightsCsv(Merecat.bandWeightsFrom(Array.isArray(v) ? v.join(',') : String(v))),
  user_cap_on: (v) => Number(v) ? '1' : '0',
  user_daily: (v) => String(Math.max(1, Math.min(500, Math.floor(Number(v)) || MERECAT_DEFAULTS.user_daily))),
  global_daily: (v) => String(Math.max(1, Math.min(100000, Math.floor(Number(v)) || MERECAT_DEFAULTS.global_daily))),
  topk: (v) => String(Math.max(1, Math.min(40, Math.floor(Number(v)) || MERECAT_DEFAULTS.topk))),
  max_tokens: (v) => String(Math.max(64, Math.min(8192, Math.floor(Number(v)) || MERECAT_DEFAULTS.max_tokens))),
  persona_file_hash: (v) => String(v).slice(0, 64),
  last_ingest: (v) => String(v).slice(0, 80),
  last_ingest_by: (v) => String(v).slice(0, 80),
};

/* Persona / dials push: from librarian/config.yml + persona.md through the
   pipeline, and from the merecat admin page. */
async function handleMerecatConfigSet(request: Request, env: Env) {
  const pre = await ingestGated(request, env);
  if (pre instanceof Response) return pre;
  const { data } = pre;
  const stmts: any[] = [];
  const put = (k: any, v: any) => stmts.push(env.LIBDB.prepare(
    'INSERT INTO config (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)));
  if (typeof data.persona === 'string' && data.persona) put('persona', data.persona);
  const cfg = data.config || {};
  for (const k of Object.keys(MERECAT_CONFIG_KEYS)) {
    if (cfg[k] != null) put(k, MERECAT_CONFIG_KEYS[k](cfg[k]));
  }
  if (!stmts.length) return json({ ok: false, error: 'Nothing to set.' }, 400);
  await env.LIBDB.batch(stmts);
  merecatConfigCache.at = 0; merecatConfigCache.cfg = null; // this isolate refreshes now; others lag out the 5-min TTL
  return json({ ok: true, set: stmts.length }, 200);
}

/* Usage counters for the admin: the last fourteen days, questions and rough
   token spend, distinct askers per day. Counters only — no question text. */
async function handleMerecatStats(request: Request, env: Env) {
  const pre = await adminGated(request, env);
  if (pre instanceof Response) return pre;
  const use = await env.LIBDB.prepare(
    'SELECT day, q, in_tok, out_tok FROM usage ORDER BY day DESC LIMIT 14').all();
  const users = await env.LIBDB.prepare(
    'SELECT day, COUNT(*) AS users FROM user_usage GROUP BY day ORDER BY day DESC LIMIT 14').all();
  // the chunk counts stamped at ingest end, summed — not a count of the store
  const total = await env.LIBDB.prepare('SELECT COALESCE(SUM(chunks), 0) AS n FROM works').first<{ n: number }>();
  let deepN = 0;
  for (const db of [env.LIBDB2, env.LIBDB3]) {
    if (!db) continue;
    try {
      const d2 = await db.prepare('SELECT COALESCE(SUM(chunks), 0) AS n FROM works').first<{ n: number }>();
      deepN += (d2 && d2.n) || 0;
    } catch { /* the first room still reports */ }
  }
  const byDay: Record<string, number> = {};
  for (const r of users.results || []) byDay[String(r.day)] = Number(r.users) || 0;
  const days = (use.results || []).map((r) => ({ ...r, users: byDay[String(r.day)] || 0 }));
  return json({ ok: true, days, chunks: ((total && total.n) || 0) + deepN }, 200);
}

/* The single send primitive: EVERY board event reaches the hub through here, so
   the back-room privacy gate is one predicate in one place and a future
   subscriber (webhook / Discord / Matrix) is a single addition here — no forum
   handler ever changes. Returns a promise; env-guarded (no-op without the DO). */
/* A librarian conversation as the admin list selects it; `nick` is filled from
   the comments DB below (the two rooms are different databases). */
type ChatThreadRow = {
  id: number; hash: string; title: string | null; msgs: number;
  created_at: number; last_at: number; saved: number; nick?: string | null;
};

type WorkRow = { id: number; title: string; tier: number; kind: string; hash: string; chunks: number };

async function handleMerecatAskInit(request: Request, env: Env) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many questions at once. Wait a minute.', block: true });
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  await registerMember(env, me);
  const cfg = await merecatConfig(env);
  /* The account's own wall (quota.ts), before anything is minted and admins
     included: a resting librarian answers 503 with the hours until the day
     renews, and Retry-After says the same in seconds. */
  const quota = await merecatQuota(env, cfg);
  if (quota.resting) {
    console.log(JSON.stringify({ event: 'merecat_quota_rest', meter_pct: quota.meter_pct, line: quota.pct }));
    return json({ ok: false, resting: true, quota: true, reset_in_h: quota.reset_in_h, error: quota.note }, 503,
      { 'Retry-After': String(quota.reset_in_h * 3600) });
  }
  let chatId = Number(data.chat) || 0;
  if (chatId) {
    const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2').bind(chatId, me).first();
    if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  } else {
    const title = String(data.q || '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'New conversation';
    const now = Math.floor(Date.now() / 1000);
    const ins = await env.LIBDB.prepare(
      'INSERT INTO chats (hash, title, created_at, last_at, msgs) VALUES (?1, ?2, ?3, ?3, 0) RETURNING id'
    ).bind(me, title, now).first<{ id: number }>() as { id: number };
    chatId = ins.id;
  }
  const day = merecatDay();
  const admin = await isAdminHash(env, me);
  let youQ = 0; let todayQ = 0;
  try {
    const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first<{ q: number }>();
    todayQ = (g && g.q) || 0;
    const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2').bind(day, me).first<{ q: number }>();
    youQ = (u && u.q) || 0;
  } catch { /* preview only */ }
  return json({ ok: true, chatId, backend: 'cloudflare',   // kept one deploy for clients built before the GPU box retired
    used: { you: youQ, cap: cfg.user_daily, cap_on: cfg.user_cap_on, today: todayQ, gcap: cfg.global_daily, admin,
      quota: quotaPublic(quota) } }, 200);
}

/* The merecat WebSocket upgrade → the per-conversation ChatRoom (getByName by id
   so it is the same instance the ask-init minted). Not READ_LIMIT-gated. */
async function handleMerecatLive(request: Request, env: Env) {
  if (!originOk(request, env)) return new Response('bad origin', { status: 403 });
  if (!env.CHAT) return new Response('unavailable', { status: 503 });
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'CONNECT_LIMIT', ip))) return new Response('slow down', { status: 429 });
  const cid = Number(new URL(request.url).searchParams.get('chat')) || 0;
  if (!cid) return new Response('need a conversation id (call ask-init first)', { status: 400 });
  return env.CHAT.get(env.CHAT.idFromName('chat:' + cid)).fetch(request);
}

export {
  MERECAT_CONFIG_KEYS,
  handleMerecatAbout,
  handleMerecatAdminThread,
  handleMerecatAdminThreads,
  handleMerecatAskInit,
  handleMerecatBackends,
  handleMerecatChat,
  handleMerecatChatDelete,
  handleMerecatChatSave,
  handleMerecatChats,
  handleMerecatConfigSet,
  handleMerecatForward,
  handleMerecatIngest,
  handleMerecatLive,
  handleMerecatMention,
  handleMerecatStats,
  handleMerecatUsage,
  handleMerecatWorks,
  merecatMentionKick,
};
