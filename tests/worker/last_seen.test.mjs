/* "Last seen" (migration 0013, the hub's stamp, `/dm/presence` seen, the
 * thread's other.last_seen).
 *
 * What would break silently: a stamp written for a member who chose appear-
 * offline (the one privacy rule here — the mode rides the auth frame, never a
 * column, so the hub is the only party that can honour it); a stale stamp left
 * behind after a member switches to "off"; a worker handler writing the column
 * (the hub is the ONE writer); an online member's stamp served as if they were
 * away; the ledger not building. So: the ledger through 0013, and drift guards
 * over the shipping hub and handlers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handlerBody, routesSource } from '../_support/worker_src.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const idxSrc = routesSource();
const hubSrc = readFileSync(join(root, 'comments-worker', 'src', 'durable.ts'), 'utf8');

const body = (name) => handlerBody(name, idxSrc);

test('the ledger builds through 0013 and profiles carries last_seen_at', () => {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.some((f) => f.startsWith('0013_profile_last_seen')), 'migration 0013 present');
  for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  const cols = db.prepare('PRAGMA table_info(profiles)').all().map((c) => c.name);
  assert.ok(cols.includes('last_seen_at'), 'profiles.last_seen_at');
  db.close();
});

test('the hub is the one writer: a stamp at the last disconnect under auto, cleared under appear-offline', () => {
  const close = hubSrc.slice(hubSrc.indexOf('async webSocketClose(ws: WebSocket)'), hubSrc.indexOf('async #stampLastSeen('));
  assert.ok(close.length > 0, 'the close handler is where the slice begins');
  assert.ok(/if \(this\.#isOnline\(me, ws\)\) return;/.test(close), 'only the member\'s LAST socket closing counts');
  assert.ok(/if \(Presence\.recordsLastSeen\(\(a && a\.presenceMode\) \|\| 'auto'\)\) await this\.#stampLastSeen\(me\);/.test(close),
    'the stamp is gated by the kernel rule on the closing socket\'s own mode');
  const auth = hubSrc.slice(hubSrc.indexOf("if (m.t === 'auth')"), hubSrc.indexOf("if (m.t === 'typing')"));
  assert.ok(/if \(me && !Presence\.recordsLastSeen\(presenceMode\)\) await this\.#clearLastSeen\(me\);/.test(auth),
    'authenticating under off clears any stamp the member holds');
  assert.ok(/UPDATE profiles SET last_seen_at = \?2 WHERE hash = \?1/.test(hubSrc) && /UPDATE profiles SET last_seen_at = NULL WHERE hash = \?1/.test(hubSrc));
  assert.ok(!/last_seen_at = /.test(idxSrc.replace(/SELECT[^;]*last_seen_at[^;]*/g, '')), 'no worker handler writes the column');
});

test('the thread carries every member\'s last_seen, and the presence read carries seen for those not online', () => {
  const t = body('handleDmThread');
  const lib = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
  assert.ok(/pr\.last_seen_at, pr\.receipts_mode, pk\.pubkey/.test(lib.slice(lib.indexOf('export async function dmMembersPayload('))), 'the members payload reads the stamp');
  assert.ok(/SELECT nick, avatar, last_seen_at, receipts_mode FROM profiles WHERE hash = \?1/.test(lib.slice(lib.indexOf('export async function dmPairRoomRows('))), 'the empty room reads it too');
  assert.ok(/last_seen: r\.last_seen_at \|\| null,/.test(t), 'served on each member as-is (the privacy rule)');
  assert.ok(/const memberRows = thread \? await dmMembersPayload\(env, thread\.id\) : await dmPairRoomRows\(env, me, other\);/.test(t), 'both thread shapes carry it (the empty room too)');
  const p = body('handleDmPresence');
  assert.ok(/last_seen_at IS NOT NULL AND hash IN \(/.test(p), 'only stamped members');
  assert.ok(/if \(on\.indexOf\(r\.hash\) === -1\) seen\[r\.hash\] = Number\(r\.last_seen_at\)/.test(p), 'an online member\'s stamp is not served');
  assert.ok(/return json\(await cloakIds\(env, \{ ok: true, online: on, seen \}\), 200\)/.test(p), 'the presence answer is cloaked to pubids (P0 L3)');
});
