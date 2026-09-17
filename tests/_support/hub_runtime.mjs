/* The Workers runtime a Durable Object touches, in Node (2026-09-17; moved
   out of tests/worker/hub.test.mjs so the egress sweep can drive the hub
   too). Importing this module installs the three globals the runtime
   provides — WebSocketPair, WebSocketRequestResponsePair, and a Response that
   accepts status 101 with a webSocket — and exports a socket that records
   what it was sent, and a DurableObjectState over node:sqlite. */
import { DatabaseSync } from 'node:sqlite';

export class FakeSocket {
  constructor() { this.att = undefined; this.sent = []; this.closed = null; this.broken = false; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att === undefined ? undefined : structuredClone(this.att); }
  send(p) { if (this.broken) throw new Error('gone'); this.sent.push(JSON.parse(p)); }
  close(code, reason) { this.closed = [code, reason]; }
  frames(t) { return this.sent.filter((f) => f.t === t); }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); } };
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };
/* a 101 with a webSocket is a Workers extension; Node's Response refuses the status */
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init) {
    const upgraded = !!(init && init.status === 101);
    super(body, upgraded ? { ...init, status: 200 } : init);
    if (upgraded) { this.upgraded = true; this.webSocket = init.webSocket; }
  }
};

/* ctx.storage.sql over node:sqlite: exec(query, ...binds) → a cursor; every
   statement is recorded, so a test can say storage was never touched */
export function fakeSql() {
  const db = new DatabaseSync(':memory:');
  const calls = [];
  return {
    calls,
    db,
    exec(query, ...binds) {
      calls.push(query);
      const st = db.prepare(query);
      const rows = /^\s*(SELECT|PRAGMA)/i.test(query) ? st.all(...binds).map((r) => ({ ...r })) : (st.run(...binds), []);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
}
export function fakeCtx(name) {
  const sockets = [];
  return {
    id: { name },
    storage: { sql: fakeSql() },
    sockets,
    getWebSockets: () => sockets.slice(),
    acceptWebSocket: (ws) => { sockets.push(ws); },
    setWebSocketAutoResponse: () => {},
  };
}
