/* Lérins Press's mailing list (contact-worker/src/list.ts), RUN against a real SQLite: the two
   doors write and delete as they should, and the list tells no one who is on it. A join of a
   listed address, a join of a new one, a leave of a listed address and a leave of an unlisted
   one answer alike to the byte, run the same statement, and leave at the same fixed time. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1, limiter, netSpy } from '../_support/worker.ts';
import worker from '../../contact-worker/src/index.ts';
import { CONSENT, FLOOR_MS, clock, normalEmail } from '../../contact-worker/src/list.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRESS = 'https://press.merecatholicity.com';

let db: DatabaseSync;
let sql: string[];
let net: ReturnType<typeof netSpy>;
let t: number;
let slept: number[];
const real = { ...clock };

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(root, 'contact-worker/migrations/0001_list.sql'), 'utf8'));
  sql = [];
  /* Turnstile passes for the action it is asked about, on the press's host, and takes 200 ms of
     the clock below. */
  net = netSpy(async (_url, init) => {
    t += 200;
    const action = new URLSearchParams(String(init?.body)).get('response');
    return Response.json({ success: true, hostname: 'press.merecatholicity.com', action });
  });
  /* A clock that only moves when told: the challenge takes its time, the floor sleeps the rest. */
  t = 1_000_000;
  slept = [];
  clock.now = () => t;
  clock.sleep = async (ms) => { slept.push(ms); t += ms; };
});
afterEach(() => { net.restore(); Object.assign(clock, real); });

function env() {
  const list = d1(db);
  return {
    TURNSTILE_SECRET: 'secret-for-the-test',
    TURNSTILE_HOSTNAMES: 'press.merecatholicity.com',
    SEND_LIMIT: limiter(),
    LIST_LIMIT: limiter(),
    EMAIL: { send: async () => { throw new Error('the list never sends mail'); } },
    LIST: { prepare: (s: string) => { sql.push(s); return list.prepare(s); } },
  };
}

/* The token stands for the action it was solved for (the spy above echoes it back). */
async function post(door: string, email: string, { consent = true, token = door.slice(1), origin = PRESS } = {}) {
  const body = new FormData();
  body.set('email', email);
  if (consent) body.set('consent', 'yes');
  body.set('website', '');
  body.set('cf-turnstile-response', token);
  const req = new Request('https://contact-api.merecatholicity.com' + door, {
    method: 'POST', body, headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.9' },
  });
  const res = await worker.fetch(req, env() as never);
  return { status: res.status, body: await res.text(), headers: [...res.headers].sort().join('\n') };
}
const rows = () => db.prepare('SELECT email, consent, joined_at FROM list').all();

test('a join writes the address with its consent key and the day, and nothing else', async () => {
  const r = await post('/subscribe', '  Reader@Example.COM ');
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  const [row] = rows();
  assert.equal(row.email, 'reader@example.com');
  assert.ok(String(row.consent) in CONSENT);
  assert.equal(row.joined_at, new Date(1_000_000).toISOString());
  assert.equal(net.calls.length, 1, 'one call, the challenge, and no mail');
});

test('a second join of the same address answers exactly as the first, and keeps its first day', async () => {
  const first = await post('/subscribe', 'reader@example.com');
  const again = await post('/subscribe', 'READER@example.com');
  assert.deepEqual(again, first);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].joined_at, new Date(1_000_000).toISOString());
  assert.equal(sql[0], sql[1], 'the same one statement either way');
});

test('a leave answers alike whether or not the address was on the list', async () => {
  await post('/subscribe', 'reader@example.com');
  const listed = await post('/unsubscribe', 'reader@example.com');
  assert.equal(rows().length, 0);
  const unlisted = await post('/unsubscribe', 'stranger@example.com');
  const gone = await post('/unsubscribe', 'reader@example.com');
  assert.deepEqual(unlisted, listed);
  assert.deepEqual(gone, listed);
  assert.equal(new Set(sql.slice(1)).size, 1, 'the same one statement either way');
});

test('a join and a leave answer alike to each other too', async () => {
  const join = await post('/subscribe', 'reader@example.com');
  const leave = await post('/unsubscribe', 'reader@example.com');
  assert.deepEqual(leave, join);
});

test('every answer, a refusal included, leaves at the same fixed time after arrival', async () => {
  const cases = [
    () => post('/subscribe', 'reader@example.com'),
    () => post('/subscribe', 'reader@example.com'),
    () => post('/unsubscribe', 'stranger@example.com'),
    () => post('/subscribe', 'not an address'),
    () => post('/subscribe', 'reader@example.com', { consent: false }),
    () => post('/subscribe', 'reader@example.com', { origin: 'https://evil.example' }),
  ];
  for (const c of cases) {
    const start = t;
    await c();
    assert.equal(t - start, FLOOR_MS, 'held to the floor');
  }
  /* the ones that reached the challenge slept less, by exactly the time it took */
  assert.deepEqual(slept, [1300, 1300, 1300, 1500, 1500, 1500]);
});

test('a token solved for one door opens no other', async () => {
  const r = await post('/unsubscribe', 'reader@example.com', { token: 'subscribe' });
  assert.equal(r.status, 403);
  const s = await post('/subscribe', 'reader@example.com', { token: 'unsubscribe' });
  assert.equal(s.status, 403);
  assert.equal(rows().length, 0);
});

test('a join needs the consent box; a leave does not', async () => {
  assert.equal((await post('/subscribe', 'reader@example.com', { consent: false })).status, 400);
  assert.equal(rows().length, 0);
  assert.equal((await post('/unsubscribe', 'reader@example.com', { consent: false })).status, 200);
});

test('only the press may post to the list', async () => {
  const r = await post('/subscribe', 'reader@example.com', { origin: 'https://merecatholicity.com' });
  assert.equal(r.status, 403);
  assert.equal(rows().length, 0);
  assert.equal(net.calls.length, 0, 'refused before the challenge is spent');
});

test('the address check takes what a browser email field takes', () => {
  assert.equal(normalEmail(' A.B+press@Mail.Example.org '), 'a.b+press@mail.example.org');
  for (const bad of ['', 'plain', 'a@b', 'a@@b.org', 'a b@c.org', 'a@b.org\nBcc: x@y.org', 'x'.repeat(250) + '@b.org']) {
    assert.equal(normalEmail(bad), null, JSON.stringify(bad));
  }
});
