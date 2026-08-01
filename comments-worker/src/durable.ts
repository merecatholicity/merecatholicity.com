/* durable.ts — the worker's two Durable Objects: BoardHub (the read-only
   board fan-out over WebSockets) and ChatRoom (the merecat generation state
   machine). Both import shared helpers from lib.ts; index.ts re-exports the
   classes so wrangler finds them on the main module. */
import { DurableObject } from 'cloudflare:workers';
import * as Presence from '../../purescript/output/Domain.Presence/index.js';
import {
  ipFamily, ipKey, toBanKey, reverseDnsName, looksLikeIp, boardEventPublic, sanitizeScopes,
} from './pure.js';
import {
  BOARD_CATS,
  MERECAT_RESTING,
  MERECAT_RV,
  MERECAT_WINDOW,
  blockedReason,
  isAdminHash,
  merecatConfig,
  merecatDay,
  merecatFold,
  merecatLocalFetch,
  merecatPrompt,
  merecatThinkStripper,
  sha256hex,
} from './lib.js';

interface Env { [key: string]: any; }

export class BoardHub extends DurableObject<Env> {
  constructor(ctx: any, env: any) {
    super(ctx, env);
    /* The client's {t:'ping'} is answered {t:'pong'} by the runtime without
       waking the object, so a hibernating socket stays warm at zero cost. */
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pong' })));
  }

  async fetch(request: any) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ['v1']);   // hibernation-eligible; one static tag
    server.serializeAttachment({ subs: [], n: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: any, msg: any) {
    let m;
    try { m = JSON.parse(typeof msg === 'string' ? msg : ''); } catch { return; }
    if (!m) return;   // a stray {t:'ping'} is handled by the auto-responder
    let a;
    try { a = ws.deserializeAttachment(); } catch { a = null; }
    /* A member authenticates so this socket may subscribe to its own private
       user:<hash> scope (DMs, notifications). The key rides the frame, never the
       URL; the hash is stored on the attachment and gates every later sub. The
       auth frame also carries the member's presence mode ("auto"/"off") so the
       DO can honour appear-offline without a DB read, and coming online (or
       going appear-offline) is broadcast to anyone watching this member. */
    if (m.t === 'auth') {
      const key = String(m.key || '');
      const me = key ? await sha256hex(key) : '';
      const presenceMode = Presence.normalizeMode(String(m.presence || 'auto'));
      ws.serializeAttachment({ subs: (a && a.subs) || [], n: (a && a.n) || 0, me, presenceMode });
      if (me) this.#broadcastPresence(me, this.#isOnline(me));
      return;
    }
    /* A transient typing signal (client → client, no storage): fan it to the
       recipient's own sockets only, tagged with the authenticated sender. */
    if (m.t === 'typing') {
      const me = (a && a.me) || '';
      const to = String(m.to || '');
      if (!me || !/^[0-9a-f]{64}$/.test(to)) return;
      this.#fan('user:' + to, JSON.stringify({ v: 1, t: 'typing', from: me, state: m.state === 'stop' ? 'stop' : 'start' }));
      return;
    }
    if (m.t !== 'sub') return;
    const me = (a && a.me) || '';
    const subs = sanitizeScopes(m.scope, me, BOARD_CATS);
    const n = ((a && a.n) || 0) + 1;
    if (n > 500) { try { ws.close(1008, 'too many'); } catch { /* gone */ } return; }
    ws.serializeAttachment({ subs, n, me, presenceMode: (a && a.presenceMode) || 'auto' });
    /* Seed each newly-watched member's current presence to this socket. */
    for (const s of subs) {
      if (s.startsWith('presence:')) {
        const h = s.slice(9);
        try { ws.send(JSON.stringify({ v: 1, t: 'presence', hash: h, online: this.#isOnline(h) })); } catch { /* gone */ }
      }
    }
  }

  /* A socket dropped: if it was the member's last online connection, tell anyone
     watching that they went offline. (webSocketError has no such last-socket
     meaning; it just logs.) */
  webSocketClose(ws: any) {
    let a;
    try { a = ws.deserializeAttachment(); } catch { a = null; }
    const me = a && a.me;
    if (!me) return;
    if (!this.#isOnline(me, ws)) this.#broadcastPresence(me, false);
  }

  webSocketError(ws: any, err: any) {
    console.log(JSON.stringify({ event: 'hub_ws_error', error: String(err) }));
  }

  /* Is <hash> online? True iff some live socket authenticated as that hash with a
     non-"off" presence mode. `exclude` skips one socket (the one closing). */
  #isOnline(hash: any, exclude?: any) {
    for (const s of this.ctx.getWebSockets()) {
      if (exclude && s === exclude) continue;
      let a;
      try { a = s.deserializeAttachment(); } catch { a = null; }
      if (a && a.me === hash && a.presenceMode !== 'off') return true;
    }
    return false;
  }

  /* Send a frame to every socket subscribed to `scope`. */
  #fan(scope: any, payload: any) {
    for (const s of this.ctx.getWebSockets()) {
      let a;
      try { a = s.deserializeAttachment(); } catch { a = null; }
      if (a && Array.isArray(a.subs) && a.subs.includes(scope)) {
        try { s.send(payload); } catch { /* dropped */ }
      }
    }
  }

  #broadcastPresence(hash: any, online: any) {
    this.#fan('presence:' + hash, JSON.stringify({ v: 1, t: 'presence', hash, online: !!online }));
  }

  /* RPC for the batched inbox check: of these hashes, which are online now
     (honouring appear-offline)? One request per inbox load. */
  async presenceOf(hashes: any) {
    const live = new Set();
    for (const s of this.ctx.getWebSockets()) {
      let a;
      try { a = s.deserializeAttachment(); } catch { a = null; }
      if (a && a.me && a.presenceMode !== 'off') live.add(a.me);
    }
    return (Array.isArray(hashes) ? hashes : []).filter((h) => live.has(h));
  }

  /* RPC, called by the worker on every live public board mutation. */
  async publish(event: any) {
    if (!event || !Array.isArray(event.scopes)) return;
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      let a;
      try { a = ws.deserializeAttachment(); } catch { a = null; }
      if (a && Array.isArray(a.subs) && a.subs.some((s: any) => event.scopes.includes(s))) {
        try { ws.send(payload); } catch { /* a dropped socket; the close handler cleans up */ }
      }
    }
  }
}

/* ---- merecat as a state machine (Phase 2): the ChatRoom Durable Object ----
   One instance per conversation (getByName('chat:'+id)). It OWNS the generation
   and is the single D1 writer for its thread, so the disconnect contract is
   structural: it keeps generating whether or not a reader is attached, persists
   the growing answer to chat_msgs (done=0 → done=1), and on (re)connect replays
   the current state + answer-so-far via a `hello` frame — which replaces the
   whole polling resume/reconcile/recover machinery. States: idle → queued →
   thinking → streaming → done | error. It drives the local box (serve.py via
   merecatLocalFetch, relayed by #relayLocal) with failover to the cloud model
   (env.AI) into the same stream, or the cloud model directly — whichever the
   live config names. Auth is the member's key in the auth frame (same trust as
   a POST body), never in the URL. Reuses merecatConfig/merecatPrompt/
   merecatThinkStripper/merecatFold verbatim. This is now the ONLY merecat
   generation path — the HTTP /ask streaming endpoint and its store callback
   were retired once this was proven live. */
export class ChatRoom extends DurableObject<Env> {
  declare phase: any;
  declare chatId: any;
  declare gen: any;

  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.phase = 'idle';
    this.chatId = 0;
    this.gen = null;   // in-flight: { userMsgId, answer, sources, used, startedAtMs, backend }
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pong' })));
  }

  /* Broadcast a frame to the OWNER's sockets only. Every state/meta/tokens frame
     carries the in-flight answer, so it must never reach an unauthenticated (or
     someone-else's) socket — only #auth, which checks chats(id, hash=me), can set
     auth:true, so the authed set is exactly the owner's connections. The hello
     resume frame is sent per-socket from #auth, not here. */
  #emit(obj: any) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      let a; try { a = ws.deserializeAttachment(); } catch { a = null; }
      if (!a || a.auth !== true) continue;
      try { ws.send(s); } catch { /* dropped */ }
    }
  }

  async fetch(request: any) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const cid = Number(new URL(request.url).searchParams.get('chat')) || 0;
    /* CF-Connecting-IP survives the forward from handleMerecatLive (stub.fetch
       forwards the request headers), so the WS ask can re-check IP bans — the
       HTTP path only checks them at ask-init. */
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['v1']);
    pair[1].serializeAttachment({ auth: false, chatId: cid, ip });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: any, msg: any) {
    let m;
    try { m = JSON.parse(typeof msg === 'string' ? msg : ''); } catch { return; }
    if (!m) return;
    if (m.t === 'auth') return this.#auth(ws, m);
    if (m.t === 'ask') return this.#ask(ws, m);
  }

  webSocketError(ws: any, err: any) { console.log(JSON.stringify({ event: 'chat_ws_error', error: String(err) })); }
  /* A closing reader does NOT stop the generation — that is the whole point. */

  #hello(ws: any) {
    const g = this.gen;
    ws.send(JSON.stringify({ t: 'hello', chatId: this.chatId, phase: this.phase,
      answer: (g && g.answer) || '', sources: (g && g.sources) || [], used: (g && g.used) || null,
      startedAtMs: (g && g.startedAtMs) || 0, backend: (g && g.backend) || 'cloudflare' }));
  }

  async #auth(ws: any, m: any) {
    const a = ws.deserializeAttachment() || {};
    const fail = (err: any) => { try { ws.send(JSON.stringify({ t: 'state', phase: 'error', error: err })); } catch { /* gone */ }
      try { ws.close(1008, 'unauthorized'); } catch { /* gone */ } };
    const key = String(m.key || '');
    if (!key) { fail('Missing key.'); return; }
    const me = await sha256hex(key);
    const cid = a.chatId || Number(m.chat) || 0;
    if (cid) {
      const own = await this.env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2').bind(cid, me).first();
      if (!own) { fail('No such conversation.'); return; }
      this.chatId = cid;
    }
    const admin = await isAdminHash(this.env, me);
    ws.serializeAttachment({ auth: true, me, admin, chatId: cid, ip: a.ip || '' });
    this.#hello(ws);
  }

  async #ask(ws: any, m: any) {
    const a = ws.deserializeAttachment() || {};
    if (!a.auth) { ws.send('{"t":"state","phase":"error","error":"Authenticate first."}'); return; }
    if (this.phase === 'thinking' || this.phase === 'streaming' || this.phase === 'queued') {
      ws.send('{"t":"state","phase":"busy"}'); return;   // single-flight per conversation
    }
    const q = String(m.q || '').trim().slice(0, 2000);
    if (!q) return;
    const me = a.me;
    const admin = !!a.admin;
    const gate = await blockedReason(this.env, me, a.ip || '');
    if (gate) { ws.send('{"t":"state","phase":"error","error":"blocked"}'); return; }
    const cfg = await merecatConfig(this.env);
    const day = merecatDay();
    const capsApply = cfg.backend === 'cloudflare';
    let youQ = 0; let todayQ = 0;
    try {
      const g = await this.env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
      todayQ = (g && g.q) || 0;
      if (capsApply && !admin && todayQ >= cfg.global_daily) {
        ws.send(JSON.stringify({ t: 'state', phase: 'error', resting: true, error: MERECAT_RESTING })); return;
      }
      const u = await this.env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2').bind(day, me).first();
      youQ = (u && u.q) || 0;
      if (capsApply && !admin && cfg.user_cap_on && youQ >= cfg.user_daily) {
        ws.send(JSON.stringify({ t: 'state', phase: 'error', capped: true,
          error: 'You have used your ' + cfg.user_daily + ' questions for today. The counter resets at midnight UTC.' }));
        return;
      }
    } catch (err) { console.log(JSON.stringify({ event: 'chat_caps_failed', error: String(err) })); }

    /* Mint the thread + question row BEFORE generating (the thread must outlive a
       fragile stream). A fresh conversation gets its id here and rides the first
       frame back so the client adopts ?chat=<id> at once. */
    const now = Math.floor(Date.now() / 1000);
    let history = []; let summary = '';
    if (!this.chatId) {
      const ins = await this.env.LIBDB.prepare(
        'INSERT INTO chats (hash, title, created_at, last_at, msgs) VALUES (?1, ?2, ?3, ?3, 0) RETURNING id'
      ).bind(me, q.slice(0, 90), now).first();
      this.chatId = ins.id;
    } else {
      const own = await this.env.LIBDB.prepare('SELECT summary FROM chats WHERE id = ?1').bind(this.chatId).first();
      summary = String((own && own.summary) || '');
      const rows = await this.env.LIBDB.prepare(
        'SELECT role, body FROM chat_msgs WHERE chat_id = ?1 AND COALESCE(done, 1) = 1 ORDER BY id DESC LIMIT ' + MERECAT_WINDOW
      ).bind(this.chatId).all();
      history = (rows.results || []).reverse().map((r: any) => ({ role: r.role, content: String(r.body).slice(0, 1200) }));
    }
    const urs = await this.env.LIBDB.batch([
      this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, created_at) VALUES (?1, 'user', ?2, ?3) RETURNING id").bind(this.chatId, q, now),
      this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, now),
    ]);
    const userMsgId = (urs && urs[0] && urs[0].results && urs[0].results[0] && urs[0].results[0].id) || 0;

    const useLocal = cfg.backend === 'local' && this.env.MERECAT_LOCAL_URL && !m.instant;
    const backend0 = useLocal ? 'local' : 'cloudflare';
    const used = { you: youQ + 1, cap: cfg.user_daily, cap_on: cfg.user_cap_on,
      today: todayQ + 1, gcap: cfg.global_daily, admin, backend: backend0 };
    this.gen = { userMsgId, answer: '', sources: [], used, startedAtMs: Date.now(),
      backend: backend0, effort: String(m.effort || 'high'), instant: !!m.instant };
    this.phase = 'thinking';
    this.#emit({ t: 'state', phase: 'thinking', chatId: this.chatId, used });
    this.ctx.storage.setAlarm(Date.now() + 30000);   // keep-alive through silent gaps
    this.#generate(q, history, summary, cfg, me, day).catch((err) => {
      console.log(JSON.stringify({ event: 'chat_generate_failed', error: String(err) }));
      this.phase = 'error';
      this.#emit({ t: 'state', phase: 'error', resting: true, error: MERECAT_RESTING });
    });
  }

  async #generate(q: any, history: any, summary: any, cfg: any, me: any, day: any) {
    /* Shared token sink: batch to the socket (~60ms) and persist the growing
       answer to D1 (done=0) every few seconds. The DO is the SOLE writer — the
       local box is called WITHOUT chat/msg, so serve.py streams only and never
       /stores, which removes the old two-writer race entirely. */
    let batch = ''; let lastSend = 0; let lastPersist = 0;
    let sources: any[] = [];
    const sendBatch = () => { if (batch) { this.#emit({ t: 'tokens', d: batch }); batch = ''; lastSend = Date.now(); } };
    const persist = async () => {
      const body = this.gen.answer.trim();
      if (!body || !this.gen.userMsgId) return;
      lastPersist = Date.now();
      try {
        const row = await this.env.LIBDB.prepare("SELECT id FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' AND answers = ?2 LIMIT 1").bind(this.chatId, this.gen.userMsgId).first();
        if (row) { await this.env.LIBDB.prepare('UPDATE chat_msgs SET body = ?2 WHERE id = ?1').bind(row.id, body).run(); }
        else {
          const t = Math.floor(Date.now() / 1000);
          await this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, sources, created_at, answers, done) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5, 0)").bind(this.chatId, body, JSON.stringify(sources), t, this.gen.userMsgId).run();
          await this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, t).run();
        }
      } catch { /* a failed flush just waits for the next */ }
    };
    const onToken = async (vis: any) => {
      if (this.phase !== 'streaming') { this.phase = 'streaming'; this.#emit({ t: 'state', phase: 'streaming' }); }
      this.gen.answer += vis; batch += vis;
      if (Date.now() - lastSend > 60) sendBatch();
      if (Date.now() - lastPersist > 6000) await persist();
    };

    let usage = null;
    let backend = this.gen.backend;   // 'local' or 'cloudflare' (decided in #ask)

    /* LOCAL: relay serve.py's stream. A pre-preamble death (or offline/busy)
       with failover on falls through to the cloud INTO the same generation. */
    if (backend === 'local') {
      let failover = false;
      const resp: any = await merecatLocalFetch(this.env, { q, history, summary, effort: this.gen.effort || 'high' });
      if (!resp || resp.busy) {
        if (cfg.failover) failover = true;
        else {
          this.phase = 'error';
          this.#emit({ t: 'state', phase: 'error', resting: true,
            error: (resp && resp.busy) ? 'The local librarian is answering others right now. Try again in a moment.' : MERECAT_RESTING });
          this.gen = null; return;
        }
      } else {
        const r = await this.#relayLocal(resp, onToken, (s: any) => {
          sources = s; this.gen.sources = s;
          this.#emit({ t: 'meta', sources: s, used: this.gen.used, rv: MERECAT_RV, backend: 'local', chatId: this.chatId });
        });
        if (r.failover && cfg.failover) failover = true;
        /* r.ok, or a post-preamble death: keep whatever streamed */
      }
      if (failover) { backend = 'cloudflare'; this.gen.backend = 'cloudflare'; this.gen.used.backend = 'cloudflare'; sources = []; this.gen.answer = ''; }
    }

    /* CLOUD: a fresh cloud ask, or a failover into the same generation. */
    if (backend === 'cloudflare') {
      const built = await merecatPrompt(this.env, q, history, summary, cfg);
      sources = built.sources; this.gen.sources = sources;
      this.gen._msgLen = JSON.stringify(built.messages).length;
      this.#emit({ t: 'meta', sources, used: this.gen.used, rv: MERECAT_RV, backend: 'cloudflare', chatId: this.chatId });
      const aiStream = await this.env.AI.run(cfg.model, { messages: built.messages, stream: true, max_tokens: cfg.max_tokens, temperature: 0.35 });
      const strip = merecatThinkStripper();
      const reader = aiStream.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.usage) usage = obj.usage;
            const delta = obj.response == null ? '' : String(obj.response);
            if (delta) { const vis = strip(delta); if (vis) await onToken(vis); }
          } catch { /* partial/non-JSON line */ }
        }
      }
      const tail = strip(null); if (tail) await onToken(tail);
    }

    sendBatch();
    if (!this.gen.answer.trim()) this.gen.answer = 'The librarian could not draw an answer this time. Ask again shortly.';

    /* Finalize: one authoritative write (done=1), tally (cloud only), fold. */
    const answer = this.gen.answer.trim();
    const nowS = Math.floor(Date.now() / 1000);
    const stmts = [];
    if (backend === 'cloudflare') {
      const inTok = usage && usage.prompt_tokens ? usage.prompt_tokens : Math.ceil((this.gen._msgLen || answer.length) / 4);
      const outTok = usage && usage.completion_tokens ? usage.completion_tokens : Math.ceil(answer.length / 4);
      stmts.push(this.env.LIBDB.prepare('INSERT INTO usage (day, q, in_tok, out_tok) VALUES (?1, 1, ?2, ?3) ON CONFLICT(day) DO UPDATE SET q = q + 1, in_tok = in_tok + ?2, out_tok = out_tok + ?3').bind(day, inTok, outTok));
      stmts.push(this.env.LIBDB.prepare('INSERT INTO user_usage (day, hash, q) VALUES (?1, ?2, 1) ON CONFLICT(day, hash) DO UPDATE SET q = q + 1').bind(day, me));
    }
    const existing = this.gen.userMsgId ? await this.env.LIBDB.prepare("SELECT id FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' AND answers = ?2 LIMIT 1").bind(this.chatId, this.gen.userMsgId).first() : null;
    if (existing) {
      stmts.push(this.env.LIBDB.prepare('UPDATE chat_msgs SET body = ?2, sources = ?3, done = 1 WHERE id = ?1').bind(existing.id, answer, JSON.stringify(sources)));
      stmts.push(this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2 WHERE id = ?1').bind(this.chatId, nowS));
    } else {
      stmts.push(this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, sources, created_at, answers, done) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5, 1)").bind(this.chatId, answer, JSON.stringify(sources), nowS, this.gen.userMsgId || null));
      stmts.push(this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, nowS));
    }
    await this.env.LIBDB.batch(stmts);
    this.phase = 'done';
    this.#emit({ t: 'state', phase: 'done', chatId: this.chatId });
    try { await merecatFold(this.env, cfg, this.chatId); } catch { /* fold waits for next turn */ }
  }

  /* Relay serve.py's stream to the socket: {queue} → state:queued, {sources} →
     onMeta, answer bytes → onToken (STX heartbeats stripped, ETX = clean end).
     Returns {ok} once the preamble was seen (finished or died after it — keep
     what streamed), or {failover} if it died before the preamble. */
  async #relayLocal(resp: any, onToken: any, onMeta: any) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let headerDone = false;
    for (;;) {
      let deadTimer: any;
      const step = await Promise.race([
        reader.read().then((x: any) => ({ read: x }), (e: any) => ({ err: e })),
        new Promise((res) => { deadTimer = setTimeout(() => res({ silent: true }), 35000); }),
      ]);
      clearTimeout(deadTimer);
      if (step.silent || step.err) { try { reader.cancel(); } catch { /* severed */ } return headerDone ? { ok: true } : { failover: true }; }
      const { done, value } = step.read;
      if (done) break;
      buf += dec.decode(value, { stream: true });
      while (!headerDone) {
        const nl = buf.indexOf('\n\n'); if (nl === -1) break;
        let head; try { head = JSON.parse(buf.slice(0, nl)); } catch { head = null; }
        buf = buf.slice(nl + 2);
        if (head && head.queue != null) { this.phase = 'queued'; this.#emit({ t: 'state', phase: 'queued', place: head.queue, backend: 'local' }); continue; }
        onMeta((head && head.sources) || []);
        headerDone = true;
      }
      if (headerDone && buf) {
        const clean = buf.replace(/\u0002/g, '');
        const etx = clean.indexOf('\u0003');
        const vis = etx === -1 ? clean : clean.slice(0, etx);
        buf = '';
        if (vis) await onToken(vis);
        if (etx !== -1) { try { reader.cancel(); } catch { /* done */ } return { ok: true }; }
      }
    }
    return headerDone ? { ok: true } : { failover: true };
  }

  async alarm() {
    /* Keep the object alive through silent generation gaps (it idle-evicts at
       ~70-140s); clear once done/error so it hibernates at zero cost. */
    if (this.phase === 'thinking' || this.phase === 'streaming' || this.phase === 'queued') {
      this.ctx.storage.setAlarm(Date.now() + 30000);
    }
  }
}

/* The WebSocket upgrade endpoint. NOT gated by READ_LIMIT — a connection is not
   a poll; a dedicated CONNECT_LIMIT bucket absorbs reconnect storms without
   starving normal reads. env-guarded so a deploy without the binding just 503s. */
