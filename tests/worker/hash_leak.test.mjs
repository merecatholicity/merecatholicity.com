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
import * as Pseudonym from '../../purescript/output/Domain.Pseudonym/index.js';

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

test('no answer NAMES a member by the pseudonym their account hash mints', () => {
  /* The id is not the only thing minted from a hash. `assigned` — "Adjective-
     Noun xxxx" — carries the first four hex of whatever id produced it, so a
     name built from the ACCOUNT hash both calls the member something no other
     surface calls them AND goes on publishing four hex of the digest of their
     key. That is 16 bits of the secret's hash, which filters a wordlist hard.
     cloakIds only recomputes a field literally named `assigned` (or
     `actor_assigned`) BESIDE a known id field, so a name built anywhere else,
     or beside an id field missing from ASSIGNED_BESIDE, survives the cloak
     untouched and nothing says so. Live on 2026-09-19: /dm/threads named the
     other member from `other_hash`, which was not in that map, so every inbox
     row still read "Cheerful-Tower ffd9" while her profile read
     "Upright-Bell af67". This is the sweep that would have caught it. */
  const minted = hashes.filter(([, h]) => h).map(([name, h]) => [name, h, Pseudonym.displayName(h)]);
  const leaks = [];
  for (const c of calls) {
    if (!c.text) continue;
    for (const [name, , pn] of minted) {
      if (c.text.includes(pn)) leaks.push(`${c.m} ${c.p} as ${c.as} → ${name} named "${pn}"`);
    }
  }
  /* the same names go out to Discord and in notification bodies, which the
     account-hash sweep above checks for IDS but never for names */
  for (const cr of crons) {
    for (const d of (cr.discord || [])) {
      for (const [name, , pn] of minted) {
        if (String(d.body).includes(pn)) leaks.push(`${cr.cron} discord → ${name} named "${pn}"`);
      }
    }
  }
  assert.deepEqual([...new Set(leaks)], [],
    'a pseudonym minted from an account hash reached a client: ' + JSON.stringify([...new Set(leaks)].slice(0, 20)));
});
