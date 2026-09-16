/* Additive is not forever (P2-8, 2026-09-16). tests/_support/retirements.json
 * names every shim and every column nothing reads, each with the file it lives
 * in, a pattern that finds it, the day it was frozen and the day it is due.
 * Before the due date the pattern MUST match (an entry for something already
 * gone is stale — drop it); from the due date on it MUST NOT (the item is
 * overdue — retire it, or move the date with a reason in the entry). The suite
 * goes red the morning something is due: that is the point. What would break
 * silently: "one deploy longer" meaning for ever, and a schema that only grows.
 * The dmview:<hash> claim is NOT here: the client still sends it for a pair
 * whose room is not yet made (client/dm-thread.ts), so it is a live road. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ledger = JSON.parse(readFileSync(join(root, 'tests', '_support', 'retirements.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

test('every entry is well-formed: a file, a pattern, dates in order, and a way to retire it', () => {
  assert.ok(ledger.length >= 5);
  for (const r of ledger) {
    for (const k of ['what', 'where', 'pattern', 'since', 'due', 'how']) assert.ok(typeof r[k] === 'string' && r[k], k + ' in ' + JSON.stringify(r).slice(0, 80));
    assert.match(r.since, /^\d{4}-\d{2}-\d{2}$/); assert.match(r.due, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.due > r.since, r.what + ': due after since');
    assert.doesNotThrow(() => new RegExp(r.pattern), r.what + ': the pattern is a regex');
  }
});

test('a shim or a dead column stands until its due date and not a day longer', () => {
  const overdue = [], stale = [];
  for (const r of ledger) {
    const text = readFileSync(join(root, r.where), 'utf8');
    const present = new RegExp(r.pattern).test(text);
    if (today >= r.due) { if (present) overdue.push(`${r.what} — due ${r.due}: ${r.how}`); }
    else if (!present) stale.push(`${r.what} — already gone from ${r.where}: drop its entry`);
  }
  assert.deepEqual(stale, [], 'entries for things already retired');
  assert.deepEqual(overdue, [], 'overdue retirements: retire them (the how says how), or move the date with a reason');
});
