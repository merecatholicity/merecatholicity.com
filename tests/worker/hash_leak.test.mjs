/* No account hash crosses the wire (the P0 chain, layer three, 2026-09-18).
 * A member's public id was `SHA-256(key)` — the very digest the server stores to
 * verify the key — so a hash on every board and feed read was a wordlist away
 * from the account. Layer three serves `pubid = SHA-256(PEPPER || hash)` in its
 * place: same 64-hex shape (the field NAMES are unchanged — `author_hash`,
 * `hash`, `sender_hash` still — only their VALUES become pubids), but inverting
 * one needs a pepper the edge never serves.
 *
 * This is the reach proof, modelled on env_leak: the whole route table is driven
 * as four identities, and NO identity's account hash may appear in any answer or
 * any hub frame — only its pubid. A new egress that forgets to cloak an id fails
 * here, because a floor with a hole is not a floor and neither is this. The sweep
 * runs with PUBLIC_ID_PEPPER set (env.ts declares it a secret, so the sweep's
 * sentinel fills it), so every id served is a pubid. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { runSweep } from '../_support/sweep.mjs';

let calls = [], crons = [], hashes = [];
before(async () => {
  const log = console.log;
  console.log = () => {};
  try {
    const sweep = await runSweep();
    calls = sweep.calls;
    crons = sweep.crons;
    hashes = Object.entries(sweep.who).map(([name, id]) => [name, id.hash]);
  } finally { console.log = log; }
});

function scan(text) {
  const hit = [];
  for (const [name, hash] of hashes) if (hash && text.includes(hash)) hit.push(name);
  return hit;
}

test('no answer body carries an identity account hash — only the pubid stands in', () => {
  const leaks = [];
  for (const c of calls) {
    if (!c.text) continue;
    for (const name of scan(c.text)) leaks.push(`${c.m} ${c.p} as ${c.as} → ${name}`);
  }
  assert.deepEqual([...new Set(leaks)], [],
    'account hashes on the wire (serveId missing at an egress point): ' + JSON.stringify([...new Set(leaks)].slice(0, 20)));
});

test('no hub frame REACHING A CLIENT carries an identity account hash', () => {
  /* The hub spy captures the event as `publish` receives it — WITH `scopes`,
     the `user:<account hash>` routing metadata. The real DO (durable.ts publish)
     strips scopes before it sends to a socket, so the client never sees them;
     mirror that here, and assert on the client-facing body. */
  const leaks = [];
  for (const c of calls) {
    for (const ev of (c.events || [])) {
      const { scopes, ...body } = ev;
      for (const name of scan(JSON.stringify(body))) leaks.push(`${c.m} ${c.p} as ${c.as} hub[${ev.t}] → ${name}`);
    }
  }
  assert.deepEqual([...new Set(leaks)], [],
    'account hashes in a client-facing hub frame: ' + JSON.stringify([...new Set(leaks)].slice(0, 20)));
});

test('no cron output (a backup, a Discord embed) carries an account hash — the backup is the one exception it must NOT be', () => {
  /* the backup MIRRORS the ledger, which is keyed by account hash, so a backup
     OBJECT legitimately holds hashes; a Discord embed (member content fanned
     out) must not. Assert on the Discord side only. */
  const leaks = [];
  for (const cr of crons) {
    for (const d of (cr.discord || [])) for (const name of scan(d.body)) leaks.push(`${cr.cron} discord → ${name}`);
  }
  assert.deepEqual([...new Set(leaks)], [], 'account hashes in a Discord embed: ' + JSON.stringify([...new Set(leaks)]));
});
