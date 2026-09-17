/* durable.ts — the worker's two Durable Objects: BoardHub (the read-only
   board fan-out over WebSockets) and ChatRoom (the merecat generation state
   machine). Both import shared helpers from lib.ts; index.ts re-exports the
   classes so wrangler finds them on the main module. */
import { DurableObject } from 'cloudflare:workers';
import * as Presence from '../../purescript/output/Domain.Presence/index.js';
import * as Dm from '../../purescript/output/Domain.Dm/index.js';
import * as Hub from '../../purescript/output/Domain.Hub/index.js';
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
  json,
  merecatConfig,
  merecatDay,
  merecatEffortFor,
  merecatFold,
  merecatHeadroom,
  merecatMentionReply,
  merecatPrompt,
  merecatQuota,
  merecatRestingNote,
  merecatThinkStripper,
  publishUser,
  quotaPublic,
  sha256hex,
  registerMember,
  hubShards,
  hubShard,
} from './lib.ts';
import type { HubStub, HubShardStats } from './lib.ts';

import type { Env } from './env.ts';

/* What one socket's attachment holds (it survives hibernation; the in-memory
   index below is rebuilt from it when the object wakes). */
type Att = { subs: string[]; n: number; me: string; presenceMode: string };
type RelayItem = { scope: string; payload: string };

const HEX64 = /^[0-9a-f]{64}$/;

function readAtt(ws: WebSocket): Att {
  let a: Partial<Att> | null = null;
  try { a = ws.deserializeAttachment() as Partial<Att> | null; } catch { a = null; }
  return {
    subs: a && Array.isArray(a.subs) ? a.subs.map(String) : [],
    n: (a && Number(a.n)) || 0,
    me: (a && a.me) ? String(a.me) : '',
    presenceMode: (a && a.presenceMode) ? String(a.presenceMode) : 'auto',
  };
}
function addTo(map: Map<string, Set<WebSocket>>, key: string, ws: WebSocket) {
  const set = map.get(key);
  if (set) set.add(ws); else map.set(key, new Set([ws]));
}
function dropFrom(map: Map<string, Set<WebSocket>>, key: string, ws: WebSocket) {
  const set = map.get(key);
  if (!set) return;
  set.delete(ws);
  if (!set.size) map.delete(key);
}

/* The BoardHub: ONE of HUB_SHARDS instances (Domain.Hub, 2026-09-17). A
   socket is placed by its member's hash, so every socket of one member lives
   here or on exactly one sibling, never split — "their last socket closed" is
   a local fact, and a private `user:<hash>` event is routed by the worker to
   this shard alone. What crosses between shards: a presence change (a watcher
   sits anywhere), a typing or call-signal relay to a member whose home is a
   sibling, and the presence seed a new subscriber asks for. Inside, every
   operation is O(its recipients): the sockets are indexed in memory by scope
   and by member, built once from the attachments when the object wakes and
   kept current by every accept, auth, sub, close and failed send — never a
   walk of every socket per event. */
export class BoardHub extends DurableObject<Env> {
  #idx: number;
  #ready = false;
  #att = new Map<WebSocket, Att>();
  #bySub = new Map<string, Set<WebSocket>>();
  #byMe = new Map<string, Set<WebSocket>>();
  #misrouted = new WeakSet<WebSocket>();
  /* the watch registry (2026-09-17): members homed on a sibling that this
     shard has registered a presence watch for, in this lifetime */
  #registered = new Set<string>();
  #storeReady = false;
  #lastAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    /* Which shard this is, from its own name (idFromName keeps it). */
    this.#idx = Hub.shardIndex(String((ctx.id && ctx.id.name) || 'board'));
    /* The client's {t:'ping'} is answered {t:'pong'} by the runtime without
       waking the object, so a hibernating socket stays warm at zero cost. */
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pong' })));
  }

  /* ---- the index ---- */
  #index() {
    if (this.#ready) return;
    this.#ready = true;
    for (const ws of this.ctx.getWebSockets()) this.#track(ws, readAtt(ws));
  }
  #track(ws: WebSocket, a: Att) {
    if (this.#att.has(ws)) this.#untrack(ws);
    this.#att.set(ws, a);
    for (const s of a.subs) addTo(this.#bySub, s, ws);
    if (a.me) addTo(this.#byMe, a.me, ws);
  }
  #untrack(ws: WebSocket) {
    const a = this.#att.get(ws);
    if (!a) return;
    this.#att.delete(ws);
    for (const s of a.subs) dropFrom(this.#bySub, s, ws);
    if (a.me) dropFrom(this.#byMe, a.me, ws);
  }
  /* Store the attachment (the truth across hibernation) AND index it. */
  #set(ws: WebSocket, a: Att) {
    ws.serializeAttachment(a);
    this.#track(ws, a);
  }
  #attOf(ws: WebSocket): Att {
    return this.#att.get(ws) || readAtt(ws);
  }
  #send(ws: WebSocket, payload: string) {
    try { ws.send(payload); } catch { this.#untrack(ws); }   // a socket the runtime never closed
  }

  async fetch(request: Request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    this.#index();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ['v1']);   // hibernation-eligible; one static tag
    this.#set(server, { subs: [], n: 0, me: '', presenceMode: 'auto' });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    this.#index();
    let m;
    try { m = JSON.parse(typeof msg === 'string' ? msg : ''); } catch { return; }
    if (!m) return;   // a stray {t:'ping'} is handled by the auto-responder
    const a = this.#attOf(ws);
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
      this.#set(ws, { subs: a.subs, n: a.n, me, presenceMode });
      /* A socket whose member belongs on a sibling (a bundle from before the
         routing hint, or a hint that lies): accepted — the loss is theirs
         alone (their private frames go to their home shard) — and said once. */
      if (me && Hub.shardOf(hubShards(this.env))(me) !== this.#idx && !this.#misrouted.has(ws)) {
        this.#misrouted.add(ws);
        console.log(JSON.stringify({ event: 'hub_misrouted', shard: this.#idx, home: Hub.shardOf(hubShards(this.env))(me) }));
      }
      if (me) await this.#broadcastPresence(me, this.#isOnline(me));
      /* Appear-offline hides the "last seen" moment too: a socket authenticating
         under "off" clears any stamp the member holds, so nothing stale can be
         served after the choice (Domain.Presence.recordsLastSeen — the same
         rule that gates the write at disconnect). */
      if (me && !Presence.recordsLastSeen(presenceMode)) await this.#clearLastSeen(me);
      return;
    }
    /* A transient typing signal (client → client, no storage): fan it to the
       recipients' own sockets only, tagged with the authenticated sender and
       the conversation. `to` is one hash (a pair) or the members of a group
       (at most Domain.Dm.typingFanCap — the hub keeps no roster, the client
       names who it is typing to, exactly as a send does); the typist is never
       told of their own keystrokes. Each recipient is reached on their home
       shard (here, or a sibling by relay). */
    if (m.t === 'typing') {
      const me = a.me;
      const list = (Array.isArray(m.to) ? m.to : [m.to]).map((h: unknown) => String(h || '')).filter((h: string) => HEX64.test(h) && h !== me);
      if (!me || !list.length || list.length > Dm.typingFanCap) return;
      /* A member who chose to appear offline is not seen typing either: the
         kernel rule that hides their socket hides their keystrokes (2026-09-11). */
      if (!Presence.isVisible((a && a.presenceMode) || 'auto')(true)) return;
      const thread = Math.floor(Number(m.thread) || 0);
      const frame = JSON.stringify({ v: 1, t: 'typing', from: me, thread, state: m.state === 'stop' ? 'stop' : 'start' });
      await this.#toUsers(Array.from(new Set(list)).map((to) => ({ scope: 'user:' + to, payload: frame })));
      return;
    }
    /* Transient 1v1 call signaling (client → client, no storage): the ICE
       trickle and the end/decline/busy/taken control words — typing's exact
       contract, fanned only to the recipient's own sockets, tagged with the
       authenticated sender. SDP never rides here (the gated /call/offer and
       /call/answer POSTs carry it, where the block rules live); 'taken' goes
       to one's OWN hash to hush the other tabs after answering. Size-capped:
       an ICE batch is a few hundred bytes — anything past 4 KB is not call
       signaling. */
    if (m.t === 'call-sig') {
      const me = a.me;
      const to = String(m.to || '');
      const call = String(m.call || '');
      const kind = String(m.kind || '');
      if (!me || !HEX64.test(to)) return;
      if (!/^[0-9a-f]{16,64}$/.test(call)) return;
      if (['ice', 'end', 'decline', 'busy', 'taken'].indexOf(kind) === -1) return;
      if (typeof msg !== 'string' || msg.length > 4096) return;
      await this.#toUsers([{ scope: 'user:' + to, payload: JSON.stringify({ v: 1, t: 'call-sig', from: me, call, kind, payload: m.payload }) }]);
      return;
    }
    if (m.t !== 'sub') return;
    const me = a.me;
    const subs = sanitizeScopes(m.scope, me, BOARD_CATS);
    const n = a.n + 1;
    if (n > 500) { try { ws.close(1008, 'too many'); } catch { /* gone */ } this.#untrack(ws); return; }
    this.#set(ws, { subs, n, me, presenceMode: a.presenceMode });
    /* Seed each newly-watched member's current presence to this socket — from
       their home shard, which alone holds their sockets. */
    const watched = subs.filter((s) => s.startsWith('presence:')).map((s) => s.slice(9));
    if (watched.length) {
      const online = new Set(await this.#presenceAcross(watched));
      for (const h of watched) this.#send(ws, JSON.stringify({ v: 1, t: 'presence', hash: h, online: online.has(h) }));
    }
  }

  /* A socket dropped: if it was the member's last online connection, tell anyone
     watching that they went offline. (webSocketError has no such last-socket
     meaning; it just logs.) */
  async webSocketClose(ws: WebSocket) {
    this.#index();
    const a = this.#attOf(ws);
    this.#untrack(ws);
    const me = a && a.me;
    if (!me) return;
    if (this.#isOnline(me, ws)) return;
    await this.#broadcastPresence(me, false);
    /* The member's last live socket closed: stamp the moment for the "Last
       seen …" line — only under "auto". The hub is the ONE writer of this
       column, being the one party that knows the mode (it rides the auth
       frame, never a column); a member who chose appear-offline gets no stamp. */
    if (Presence.recordsLastSeen((a && a.presenceMode) || 'auto')) await this.#stampLastSeen(me);
  }

  async #stampLastSeen(hash: string) {
    const now = Math.floor(Date.now() / 1000);
    try {
      await registerMember(this.env, hash, now);
      await this.env.DB.prepare('UPDATE profiles SET last_seen_at = ?2 WHERE hash = ?1').bind(hash, now).run();
    } catch (e) { console.log(JSON.stringify({ event: 'hub_last_seen_error', error: String(e) })); }
  }
  async #clearLastSeen(hash: string) {
    try {
      await this.env.DB.prepare('UPDATE profiles SET last_seen_at = NULL WHERE hash = ?1').bind(hash).run();
    } catch (e) { console.log(JSON.stringify({ event: 'hub_last_seen_error', error: String(e) })); }
  }

  webSocketError(ws: WebSocket, err: unknown) {
    this.#index();
    this.#untrack(ws);
    console.log(JSON.stringify({ event: 'hub_ws_error', error: String(err) }));
  }

  /* Is <hash> online HERE? True iff some live socket of theirs authenticated
     with a non-"off" presence mode. `exclude` skips one socket (the one
     closing). A member's sockets all live on their home shard, so "here" is
     the whole answer for a member whose home this is. */
  #isOnline(hash: string, exclude?: WebSocket) {
    const set = this.#byMe.get(hash);
    if (!set) return false;
    for (const s of set) {
      if (exclude && s === exclude) continue;
      const a = this.#att.get(s);
      if (a && a.presenceMode !== 'off') return true;
    }
    return false;
  }

  /* Send a frame to every socket subscribed to `scope`, here. */
  #fan(scope: string, payload: string) {
    const set = this.#bySub.get(scope);
    if (!set) return;
    for (const s of Array.from(set)) this.#send(s, payload);
  }

  /* The sibling shards' stubs (none when HUB_SHARDS is 1). */
  #siblings(): Array<{ i: number; stub: HubStub }> {
    const n = hubShards(this.env);
    const out: Array<{ i: number; stub: HubStub }> = [];
    for (let i = 0; i < n; i++) if (i !== this.#idx) out.push({ i, stub: hubShard(this.env, i) });
    return out;
  }
  async #relayTo(targets: Array<{ i: number; stub: HubStub }>, items: RelayItem[]) {
    if (!targets.length || !items.length) return;
    const results = await Promise.allSettled(targets.map((t) => t.stub.relay(items)));
    results.forEach((r, k) => {
      if (r.status === 'rejected') console.log(JSON.stringify({ event: 'hub_relay_failed', from: this.#idx, to: targets[k].i, error: String(r.reason).slice(0, 200) }));
    });
  }

  /* ---- the watch registry (2026-09-17) ----
     A presence change used to be relayed to EVERY sibling, so each shard
     received every login and logout on the site — a ceiling no shard count
     could lift. Now a member's home shard keeps, in its own SQLite, which
     siblings hold a watcher of that member (`watch`: registered by the
     watcher's shard when a socket subscribes, in the same turn that answers
     the presence seed), and relays a change to those alone. A sibling that
     finds nobody watching answers `idle`, and the row goes — guarded by the
     row's `at`, so a registration that lands while that answer is in flight
     survives it. Rows left by another shard count are dropped on wake.
     Untouched when HUB_SHARDS is 1 (no siblings, no storage). Storage does
     not keep an object from hibernating. */
  #store(): SqlStorage | null {
    const n = hubShards(this.env);
    const sql = n > 1 && this.ctx.storage ? this.ctx.storage.sql : null;
    if (!sql) return null;
    if (!this.#storeReady) {
      sql.exec('CREATE TABLE IF NOT EXISTS watch (hash TEXT NOT NULL, shard INTEGER NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (hash, shard)) WITHOUT ROWID');
      sql.exec('DELETE FROM watch WHERE n != ?', n);
      this.#storeReady = true;
    }
    return sql;
  }
  /* A registration stamp that only ever grows within a lifetime (the clock
     does not advance inside one event). */
  #tick(): number {
    this.#lastAt = Math.max(Date.now(), this.#lastAt + 1);
    return this.#lastAt;
  }

  /* A presence change reaches every watcher: here, and on each sibling the
     registry names. A member whose socket sits off their home shard (an old
     bundle, `hub_misrouted`) has no registry here, so their change goes to
     every sibling, as before the registry. */
  async #broadcastPresence(hash: string, online: boolean) {
    const scope = 'presence:' + hash;
    const payload = JSON.stringify({ v: 1, t: 'presence', hash, online: !!online });
    this.#fan(scope, payload);
    const n = hubShards(this.env);
    if (n <= 1) return;
    const items = [{ scope, payload }];
    const sql = this.#store();
    if (!sql || Hub.shardOf(n)(hash) !== this.#idx) { await this.#relayTo(this.#siblings(), items); return; }
    const rows = sql.exec<{ shard: number; at: number }>('SELECT shard, at FROM watch WHERE hash = ?', hash).toArray();
    const targets = rows.filter((r) => r.shard !== this.#idx && r.shard >= 0 && r.shard < n);
    if (!targets.length) return;
    const answers = await Promise.allSettled(targets.map((t) => hubShard(this.env, t.shard).relay(items)));
    answers.forEach((a, k) => {
      const t = targets[k];
      if (a.status === 'rejected') {
        console.log(JSON.stringify({ event: 'hub_relay_failed', from: this.#idx, to: t.shard, error: String(a.reason).slice(0, 200) }));
        return;
      }
      const idle = a.value && Array.isArray(a.value.idle) ? a.value.idle : [];
      if (idle.indexOf(scope) !== -1) sql.exec('DELETE FROM watch WHERE hash = ? AND shard = ? AND at = ?', hash, t.shard, t.at);
    });
  }

  /* Frames for members' private scopes, each delivered on that member's home
     shard: here directly, a sibling by one relay per shard. */
  async #toUsers(items: RelayItem[]) {
    const n = hubShards(this.env);
    const bound = new Map<number, RelayItem[]>();
    for (const it of items) {
      const i = Hub.shardOf(n)(it.scope.slice(5));
      if (i === this.#idx) { this.#fan(it.scope, it.payload); continue; }
      const list = bound.get(i);
      if (list) list.push(it); else bound.set(i, [it]);
    }
    await Promise.allSettled(Array.from(bound.entries()).map(([i, list]) => this.#relayTo([{ i, stub: hubShard(this.env, i) }], list)));
  }

  /* Who, of these, is online — each asked of their home shard, which in the
     same turn registers this shard as a watcher of the ones not yet
     registered here (the seed and the registration cannot be split). */
  async #presenceAcross(hashes: string[]): Promise<string[]> {
    const n = hubShards(this.env);
    const bound = new Map<number, string[]>();
    const online: string[] = [];
    for (const h of hashes) {
      const i = Hub.shardOf(n)(h);
      if (i === this.#idx) { if (this.#isOnline(h)) online.push(h); continue; }
      const list = bound.get(i);
      if (list) list.push(h); else bound.set(i, [h]);
    }
    const asks = Array.from(bound.entries()).map(([i, list]) => {
      const fresh = list.filter((h) => !this.#registered.has(h));
      const known = list.filter((h) => this.#registered.has(h));
      return { fresh, answer: hubShard(this.env, i).watch(this.#idx, fresh, known) };
    });
    const parts = await Promise.allSettled(asks.map((a) => a.answer));
    parts.forEach((p, k) => {
      if (p.status !== 'fulfilled') return;
      for (const h of asks[k].fresh) this.#registered.add(h);
      if (Array.isArray(p.value)) online.push(...p.value.map(String));
    });
    return online;
  }

  /* ---- RPC, from the worker and from sibling shards ---- */

  /* A sibling's frames for scopes held here (presence changes, typing, call
     signals). Local delivery only — a relay never relays. The answer names the
     scopes nobody here holds, so a home shard can forget a watch that ended;
     this shard forgets it registered one too, and registers afresh on the
     next subscribe. */
  async relay(items: RelayItem[]): Promise<{ idle: string[] }> {
    this.#index();
    const idle: string[] = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it.scope !== 'string' || typeof it.payload !== 'string') continue;
      if (!this.#bySub.has(it.scope)) {
        idle.push(it.scope);
        if (it.scope.startsWith('presence:')) this.#registered.delete(it.scope.slice(9));
        continue;
      }
      this.#fan(it.scope, it.payload);
    }
    return { idle };
  }

  /* RPC from a sibling whose socket subscribed to these members' presence:
     register it as a watcher of `register` (members homed here), and answer
     which of `register` and `also` are online now — one turn, no await. */
  async watch(from: number, register: string[], also: string[] = []) {
    this.#index();
    const n = hubShards(this.env);
    const src = Math.floor(Number(from));
    const fresh = (Array.isArray(register) ? register : []).map(String).filter((h) => HEX64.test(h));
    const known = (Array.isArray(also) ? also : []).map(String).filter((h) => HEX64.test(h));
    const sql = src >= 0 && src < n && src !== this.#idx ? this.#store() : null;
    if (sql && fresh.length) {
      const at = this.#tick();
      for (const h of fresh) {
        sql.exec('INSERT INTO watch (hash, shard, n, at) VALUES (?, ?, ?, ?) ON CONFLICT (hash, shard) DO UPDATE SET n = excluded.n, at = excluded.at', h, src, n, at);
      }
    }
    return fresh.concat(known).filter((h) => this.#isOnline(h));
  }

  /* RPC for the batched inbox check: of these hashes, which are online now
     (honouring appear-offline)? The worker asks each home shard about its own. */
  async presenceOf(hashes: string[]) {
    this.#index();
    return (Array.isArray(hashes) ? hashes : []).map(String).filter((h) => this.#isOnline(h));
  }

  /* RPC for the quiet-bell check: does `recipient` have the DM thread with
     `sender` ON SCREEN right now? True only when one of the recipient's own
     authenticated sockets carries the dmview:<sender> sub — the client sets it
     while that thread is mounted, and the socket closes on a hidden tab, so a
     backgrounded or navigated-away reader still gets the bell. Since
     2026-09-13 the claim is dmview:t<thread id> (viewersOf below); this form,
     by the counterpart's hash, is honoured one deploy for the older bundle. */
  async dmViewing(recipient: string, sender: string) {
    this.#index();
    const want = 'dmview:' + sender;
    const set = this.#byMe.get(String(recipient));
    if (!set) return false;
    for (const s of set) {
      const a = this.#att.get(s);
      if (a && a.subs.includes(want)) return true;
    }
    return false;
  }

  /* RPC for the quiet bell of a conversation with members (2026-09-13): of
     these members, which have the thread tagged `tag` ('t' + id) ON SCREEN
     right now — an authenticated socket of theirs carrying dmview:<tag>. */
  async viewersOf(tag: string, hashes: string[]) {
    this.#index();
    const want = 'dmview:' + String(tag || '');
    const seen: string[] = [];
    for (const h of new Set((Array.isArray(hashes) ? hashes : []).map(String))) {
      const set = this.#byMe.get(h);
      if (!set) continue;
      for (const s of set) {
        const a = this.#att.get(s);
        if (a && a.subs.includes(want)) { seen.push(h); break; }
      }
    }
    return seen;
  }

  /* RPC, called by the worker for every live event this shard should carry
     (sendToHub routes: a private event to its home shard, a public one to all). */
  async publish(event: { scopes?: unknown }) {
    if (!event || !Array.isArray(event.scopes)) return;
    this.#index();
    const payload = JSON.stringify(event);
    const targets = new Set<WebSocket>();
    for (const scope of event.scopes) {
      const set = this.#bySub.get(String(scope));
      if (set) for (const s of set) targets.add(s);
    }
    for (const s of targets) this.#send(s, payload);
  }

  /* RPC for the Health card: this shard's load. */
  async stats(): Promise<HubShardStats> {
    this.#index();
    return { shard: this.#idx, sockets: this.#att.size, members: this.#byMe.size };
  }
}

/* ---- merecat as a state machine (Phase 2): the ChatRoom Durable Object ----
   One instance per conversation (getByName('chat:'+id)). It OWNS the generation
   and is the single D1 writer for its thread, so the disconnect contract is
   structural: it keeps generating whether or not a reader is attached, persists
   the growing answer to chat_msgs (done=0 → done=1), and on (re)connect replays
   the current state + answer-so-far via a `hello` frame — which replaces the
   whole polling resume/reconcile/recover machinery. States: idle → thinking →
   streaming → done | error. It runs the cloud model (env.AI) and nothing else:
   the GPU box that used to sit behind a routing switch was retired on
   2026-09-10 (its relay, failover and queue states left with it). Auth is the
   member's key in the auth frame (same trust as a POST body), never in the
   URL. Reuses merecatConfig/merecatPrompt/merecatThinkStripper/merecatFold
   verbatim. This is the ONLY merecat generation path — the HTTP /ask
   streaming endpoint and its store callback were retired once this was
   proven live. */
/* What a ChatRoom socket carries: whether #auth accepted it, who it belongs
   to, the conversation, and the IP the block gate reads. */
type ChatAtt = { auth: boolean; me?: string; admin?: boolean; chatId: number; ip: string };

/* The merecat config record (lib.ts's merecatConfig): the dials this file
   reads by name, open on the rest (the prompt builder and the fold read their
   own). It moves to lib.ts when merecatConfig itself is typed. */
type MerecatCfg = {
  model: string; max_tokens: number; temperature: number;
  global_daily: number; user_daily: number; user_cap_on: number;
  [k: string]: unknown;
};

/* The room's state machine, in the words the frames use. */
type ChatPhase = 'idle' | 'queued' | 'thinking' | 'streaming' | 'done' | 'error';

/* One in-flight generation. It is created whole in #ask and read by
   #generate and the finalize path; `stopped` is set by #stop, `_msgLen` by
   the prompt builder for the token estimate. */
type Gen = {
  userMsgId: number;
  answer: string;
  sources: unknown[];
  used: Record<string, unknown>;
  startedAtMs: number;
  effort: string;
  stopped?: boolean;
  _msgLen?: number;
};

export class ChatRoom extends DurableObject<Env> {
  declare phase: ChatPhase;
  declare chatId: number;
  declare gen: Gen | null;
  declare mentionsPending: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.phase = 'idle';
    this.chatId = 0;
    this.gen = null;   // in-flight: { userMsgId, answer, sources, used, startedAtMs, backend }
    this.mentionsPending = 0;
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pong' })));
  }

  /* Broadcast a frame to the OWNER's sockets only. Every state/meta/tokens frame
     carries the in-flight answer, so it must never reach an unauthenticated (or
     someone-else's) socket — only #auth, which checks chats(id, hash=me), can set
     auth:true, so the authed set is exactly the owner's connections. The hello
     resume frame is sent per-socket from #auth, not here. */
  #emit(obj: Record<string, unknown>) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      let a; try { a = ws.deserializeAttachment(); } catch { a = null; }
      if (!a || a.auth !== true) continue;
      try { ws.send(s); } catch { /* dropped */ }
    }
  }

  async fetch(request: Request) {
    /* The internal mention lane ('mention:<comment id>' instances): the ack
       returns at once and the generation runs on the DO's own lifetime. A
       stateless worker's waitUntil is cancelled ~30 seconds after its response,
       so running merecatMentionReply there silently lost every local-backend
       mention (the generation takes minutes) — the DO is the one place a long
       generation legitimately lives. Only worker code can reach a DO stub, so
       this needs no auth of its own; the kickers gate. */
    if (request.method === 'POST' && new URL(request.url).pathname === '/mention') {
      let id = 0;
      try { id = Number((await request.json<{ id?: unknown }>()).id) || 0; } catch { /* bad body */ }
      if (!id) return json({ ok: false, error: 'Bad request.' }, 400);
      this.mentionsPending += 1;
      this.ctx.storage.setAlarm(Date.now() + 30000);   // keep-alive while it works
      merecatMentionReply(this.env, id)
        .catch((e: unknown) => console.log(JSON.stringify({ event: 'merecat_mention_failed', error: String(e), id })))
        .finally(() => { this.mentionsPending -= 1; });
      return json({ ok: true });
    }
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

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    let m;
    try { m = JSON.parse(typeof msg === 'string' ? msg : ''); } catch { return; }
    if (!m) return;
    if (m.t === 'auth') return this.#auth(ws, m);
    if (m.t === 'ask') return this.#ask(ws, m);
    if (m.t === 'stop') return this.#stop(ws);
  }

  /* Stop a running generation at the asker's word: the loops see the flag,
     cancel their model reads, and the finalize path keeps whatever streamed
     (done=1), so a stop is just an early, honest end — and an economy win
     (cloud neurons and the single local GPU stop burning). */
  #stop(ws: WebSocket) {
    let a; try { a = ws.deserializeAttachment(); } catch { a = null; }
    if (!a || a.auth !== true) return;
    if (!this.gen || (this.phase !== 'thinking' && this.phase !== 'streaming' && this.phase !== 'queued')) return;
    this.gen.stopped = true;
  }

  webSocketError(ws: WebSocket, err: unknown) { console.log(JSON.stringify({ event: 'chat_ws_error', error: String(err) })); }
  /* A closing reader does NOT stop the generation — that is the whole point. */

  #hello(ws: WebSocket) {
    const g = this.gen;
    ws.send(JSON.stringify({ t: 'hello', chatId: this.chatId, phase: this.phase,
      answer: (g && g.answer) || '', sources: (g && g.sources) || [], used: (g && g.used) || null,
      startedAtMs: (g && g.startedAtMs) || 0, backend: 'cloudflare' }));
  }

  async #auth(ws: WebSocket, m: Record<string, unknown>) {
    const a = ws.deserializeAttachment() || {};
    const fail = (err: string) => { try { ws.send(JSON.stringify({ t: 'state', phase: 'error', error: err })); } catch { /* gone */ }
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

  async #ask(ws: WebSocket, m: Record<string, unknown>) {
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
    let youQ = 0; let todayQ = 0;
    try {
      const g = await this.env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first<{ q: number }>();
      todayQ = (g && g.q) || 0;
      if (!admin && todayQ >= cfg.global_daily) {
        ws.send(JSON.stringify({ t: 'state', phase: 'error', resting: true, error: merecatRestingNote() })); return;
      }
      const u = await this.env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2').bind(day, me).first<{ q: number }>();
      youQ = (u && u.q) || 0;
      if (!admin && cfg.user_cap_on && youQ >= cfg.user_daily) {
        ws.send(JSON.stringify({ t: 'state', phase: 'error', capped: true,
          error: 'You have used your ' + cfg.user_daily + ' questions for today. The counter resets at midnight UTC.' }));
        return;
      }
    } catch (err) { console.log(JSON.stringify({ event: 'chat_caps_failed', error: String(err) })); }
    /* The account's own wall, admins included: the Workers AI meter against
       the admin's line (Domain.Merecat through quota.ts). Checked before the
       thread is minted, so a refused ask leaves no empty conversation. */
    const quota = await merecatQuota(this.env, cfg);
    if (quota.resting) {
      console.log(JSON.stringify({ event: 'merecat_quota_rest', meter_pct: quota.meter_pct, line: quota.pct }));
      ws.send(JSON.stringify({ t: 'state', phase: 'error', resting: true, quota: true, reset_in_h: quota.reset_in_h, error: quota.note }));
      return;
    }

    /* Mint the thread + question row BEFORE generating (the thread must outlive a
       fragile stream). A fresh conversation gets its id here and rides the first
       frame back so the client adopts ?chat=<id> at once. */
    const now = Math.floor(Date.now() / 1000);
    let history: { role: string; content: string }[] = []; let summary = '';
    if (!this.chatId) {
      const ins = await this.env.LIBDB.prepare(
        'INSERT INTO chats (hash, title, created_at, last_at, msgs) VALUES (?1, ?2, ?3, ?3, 0) RETURNING id'
      ).bind(me, q.slice(0, 90), now).first<{ id: number }>();
      this.chatId = ins!.id;
    } else {
      const own = await this.env.LIBDB.prepare('SELECT summary FROM chats WHERE id = ?1').bind(this.chatId).first<{ summary: string | null }>();
      summary = String((own && own.summary) || '');
      const rows = await this.env.LIBDB.prepare(
        'SELECT role, body FROM chat_msgs WHERE chat_id = ?1 AND COALESCE(done, 1) = 1 ORDER BY id DESC LIMIT ' + MERECAT_WINDOW
      ).bind(this.chatId).all<{ role: string; body: string }>();
      history = (rows.results || []).reverse().map((r) => ({ role: r.role, content: String(r.body).slice(0, 1200) }));
    }
    const urs = await this.env.LIBDB.batch<{ id: number }>([
      this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, created_at) VALUES (?1, 'user', ?2, ?3) RETURNING id").bind(this.chatId, q, now),
      this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, now),
    ]);
    const userMsgId = (urs && urs[0] && urs[0].results && urs[0].results[0] && urs[0].results[0].id) || 0;

    /* `backend` stays in the preamble for one deploy: clients built before the
       GPU box was retired still read it to decide what to show. */
    const used = { you: youQ + 1, cap: cfg.user_daily, cap_on: cfg.user_cap_on,
      today: todayQ + 1, gcap: cfg.global_daily, admin, backend: 'cloudflare', quota: quotaPublic(quota) };
    /* The reader's level is a request; the admin's switch and ceiling decide
       (Domain.Merecat, through merecatEffortFor). */
    const effort = merecatEffortFor(cfg, m.instant ? 'off' : m.effort);
    this.gen = { userMsgId, answer: '', sources: [], used, startedAtMs: Date.now(), effort };
    this.phase = 'thinking';
    this.#emit({ t: 'state', phase: 'thinking', chatId: this.chatId, used });
    this.ctx.storage.setAlarm(Date.now() + 30000);   // keep-alive through silent gaps
    this.#generate(q, history, summary, cfg, me, day).catch((err) => {
      console.log(JSON.stringify({ event: 'chat_generate_failed', error: String(err) }));
      this.phase = 'error';
      this.#emit({ t: 'state', phase: 'error', resting: true, error: MERECAT_RESTING });
    });
  }

  async #generate(q: string, history: { role: string; content: string }[], summary: string,
    cfg: MerecatCfg, me: string, day: string) {
    /* The generation this call was started for. #ask creates it whole and
       nothing replaces it while this runs, so the alias IS this.gen. */
    const gen = this.gen!;
    /* Shared token sink: batch to the socket (~60ms) and persist the growing
       answer to D1 (done=0) every few seconds. The DO is the SOLE writer. */
    let batch = ''; let lastSend = 0; let lastPersist = 0;
    let sources: unknown[] = [];
    const sendBatch = () => { if (batch) { this.#emit({ t: 'tokens', d: batch }); batch = ''; lastSend = Date.now(); } };
    const persist = async () => {
      const body = gen.answer.trim();
      if (!body || !gen.userMsgId) return;
      lastPersist = Date.now();
      try {
        const row = await this.env.LIBDB.prepare("SELECT id FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' AND answers = ?2 LIMIT 1").bind(this.chatId, gen.userMsgId).first();
        if (row) { await this.env.LIBDB.prepare('UPDATE chat_msgs SET body = ?2 WHERE id = ?1').bind(row.id, body).run(); }
        else {
          const t = Math.floor(Date.now() / 1000);
          await this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, sources, created_at, answers, done) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5, 0)").bind(this.chatId, body, JSON.stringify(sources), t, gen.userMsgId).run();
          await this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, t).run();
        }
      } catch { /* a failed flush just waits for the next */ }
    };
    const onToken = async (vis: string) => {
      if (this.phase !== 'streaming') { this.phase = 'streaming'; this.#emit({ t: 'state', phase: 'streaming' }); }
      gen.answer += vis; batch += vis;
      if (Date.now() - lastSend > 60) sendBatch();
      if (Date.now() - lastPersist > 6000) await persist();
    };

    let usage = null;
    const built = await merecatPrompt(this.env, q, history, summary, cfg, gen.effort);
    sources = built.sources; gen.sources = sources;
    gen._msgLen = JSON.stringify(built.messages).length;
    this.#emit({ t: 'meta', sources, used: gen.used, rv: MERECAT_RV, backend: 'cloudflare', effort: gen.effort, chatId: this.chatId });
    if (gen.stopped) {
      /* stopped during retrieval: no model call at all */
    } else {
    const aiStream = await this.env.AI.run(cfg.model, { messages: built.messages, stream: true,
      max_tokens: cfg.max_tokens + merecatHeadroom(gen.effort), temperature: cfg.temperature }) as unknown as ReadableStream<Uint8Array>;
    const strip = merecatThinkStripper();
    const reader = aiStream.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      if (gen.stopped) { try { reader.cancel(); } catch { /* done */ } break; }
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
    if (gen.stopped && !gen.answer.trim()) gen.answer = 'Stopped at your request.';
    if (!gen.answer.trim()) gen.answer = 'The librarian could not draw an answer this time. Ask again shortly.';

    /* Finalize: one authoritative write (done=1), tally, fold. */
    const answer = gen.answer.trim();
    const nowS = Math.floor(Date.now() / 1000);
    const stmts = [];
    const inTok = usage && usage.prompt_tokens ? usage.prompt_tokens : Math.ceil((gen._msgLen || answer.length) / 4);
    const outTok = usage && usage.completion_tokens ? usage.completion_tokens : Math.ceil(answer.length / 4);
    stmts.push(this.env.LIBDB.prepare('INSERT INTO usage (day, q, in_tok, out_tok) VALUES (?1, 1, ?2, ?3) ON CONFLICT(day) DO UPDATE SET q = q + 1, in_tok = in_tok + ?2, out_tok = out_tok + ?3').bind(day, inTok, outTok));
    stmts.push(this.env.LIBDB.prepare('INSERT INTO user_usage (day, hash, q) VALUES (?1, ?2, 1) ON CONFLICT(day, hash) DO UPDATE SET q = q + 1').bind(day, me));
    const existing = gen.userMsgId ? await this.env.LIBDB.prepare("SELECT id FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' AND answers = ?2 LIMIT 1").bind(this.chatId, gen.userMsgId).first() : null;
    if (existing) {
      stmts.push(this.env.LIBDB.prepare('UPDATE chat_msgs SET body = ?2, sources = ?3, done = 1 WHERE id = ?1').bind(existing.id, answer, JSON.stringify(sources)));
      stmts.push(this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2 WHERE id = ?1').bind(this.chatId, nowS));
    } else {
      stmts.push(this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, sources, created_at, answers, done) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5, 1)").bind(this.chatId, answer, JSON.stringify(sources), nowS, gen.userMsgId || null));
      stmts.push(this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, nowS));
    }
    await this.env.LIBDB.batch(stmts);
    this.phase = 'done';
    const wasStopped = !!gen.stopped;
    this.#emit({ t: 'state', phase: 'done', chatId: this.chatId, stopped: wasStopped });
    /* Answer-ready bell: a long generation that finished with NOBODY attached
       (the asker walked away, as the disconnect contract invites) rings the
       ordinary in-app notification, one unread row per conversation, linking
       back to the thread. A stop is the asker's own act and rings nothing. */
    if (!wasStopped) {
      let attached = 0;
      for (const s of this.ctx.getWebSockets()) {
        let at; try { at = s.deserializeAttachment(); } catch { at = null; }
        if (at && at.auth === true) attached += 1;
      }
      if (!attached && me) {
        try {
          const r = await this.env.DB.prepare(
            "INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) " +
            "SELECT ?1, 'merecat', ?2, 0, NULL, ?3 WHERE NOT EXISTS (" +
            "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'merecat' AND topic_id = ?2 AND read_at IS NULL)"
          ).bind(me, this.chatId, nowS).run();
          if (r.meta && r.meta.changes > 0) {
            await publishUser(this.env, [{ v: 1, t: 'notification', scopes: ['user:' + me],
              kind: 'merecat', topic_id: this.chatId, comment_id: 0, actor_hash: null, created_at: nowS }]);
          }
        } catch (e) { console.log(JSON.stringify({ event: 'chat_notify_failed', error: String(e) })); }
      }
    }
    try { await merecatFold(this.env, cfg, this.chatId); } catch { /* fold waits for next turn */ }
  }

  async alarm() {
    /* Keep the object alive through silent generation gaps (it idle-evicts at
       ~70-140s); clear once done/error so it hibernates at zero cost. A
       pending mention reply holds it alive the same way. */
    if (this.phase === 'thinking' || this.phase === 'streaming' || this.phase === 'queued' ||
        this.mentionsPending > 0) {
      this.ctx.storage.setAlarm(Date.now() + 30000);
    }
  }
}

/* The WebSocket upgrade endpoint. NOT gated by READ_LIMIT — a connection is not
   a poll; a dedicated CONNECT_LIMIT bucket absorbs reconnect storms without
   starving normal reads. env-guarded so a deploy without the binding just 503s. */
