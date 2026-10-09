/* The Workers runtime a Durable Object touches, in Node (2026-09-17; moved
   out of tests/worker/hub.test.ts so the egress sweep can drive the hub
   too). Importing this module installs the three globals the runtime
   provides — WebSocketPair, WebSocketRequestResponsePair, and a Response that
   accepts status 101 with a webSocket — and exports a socket that records
   what it was sent, and a DurableObjectState over node:sqlite. */
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { Row } from './worker.ts';

export class FakeSocket {
  att: unknown;
  sent: Row[];
  closed: [number | undefined, string | undefined] | null;
  broken: boolean;
  constructor() { this.att = undefined; this.sent = []; this.closed = null; this.broken = false; }
  serializeAttachment(a: unknown): void { this.att = structuredClone(a); }
  deserializeAttachment(): unknown { return this.att === undefined ? undefined : structuredClone(this.att); }
  send(p: string): void { if (this.broken) throw new Error('gone'); this.sent.push(JSON.parse(p)); }
  close(code?: number, reason?: string): void { this.closed = [code, reason]; }
  frames(t: string): Row[] { return this.sent.filter((f) => f.t === t); }
}
(globalThis as Row).WebSocketPair = class { 0: FakeSocket; 1: FakeSocket; constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); } };
(globalThis as Row).WebSocketRequestResponsePair = class { req: unknown; res: unknown; constructor(req: unknown, res: unknown) { this.req = req; this.res = res; } };
/* a 101 with a webSocket is a Workers extension; Node's Response refuses the status */
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {
  declare upgraded?: boolean;
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    const upgraded = !!(init && init.status === 101);
    super(body, upgraded ? { ...init, status: 200 } : init);
    if (upgraded) { this.upgraded = true; this.webSocket = init!.webSocket as WebSocket | null; }
  }
};

/* ctx.storage.sql over node:sqlite: exec(query, ...binds) → a cursor; every
   statement is recorded, so a test can say storage was never touched */
export type Cursor = { toArray: () => Row[]; one: () => Row | undefined; [Symbol.iterator]: () => Iterator<Row> };
export type FakeSql = { calls: string[]; db: DatabaseSync; exec: (query: string, ...binds: SQLInputValue[]) => Cursor };
export function fakeSql(): FakeSql {
  const db = new DatabaseSync(':memory:');
  const calls: string[] = [];
  return {
    calls,
    db,
    exec(query: string, ...binds: SQLInputValue[]): Cursor {
      calls.push(query);
      const st = db.prepare(query);
      const rows = /^\s*(SELECT|PRAGMA)/i.test(query) ? st.all(...binds).map((r): Row => ({ ...r })) : (st.run(...binds), [] as Row[]);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
}
export type FakeCtx = {
  id: { name: string }; storage: { sql: FakeSql }; sockets: FakeSocket[];
  getWebSockets: () => FakeSocket[]; acceptWebSocket: (ws: FakeSocket) => void; setWebSocketAutoResponse: () => void;
};
export function fakeCtx(name: string): FakeCtx {
  const sockets: FakeSocket[] = [];
  return {
    id: { name },
    storage: { sql: fakeSql() },
    sockets,
    getWebSockets: () => sockets.slice(),
    acceptWebSocket: (ws: FakeSocket) => { sockets.push(ws); },
    setWebSocketAutoResponse: () => {},
  };
}
