/* The Alerts section of Platform settings (2026-09-16): the panel and the
 * worker's settings door agree on the five keys, and the address is validated
 * by the ONE rule (Domain.Ops.isEmailAddress through the membrane) on both
 * ends. What would break silently: a key the panel sends that the door's
 * `allowed` map does not know is dropped without a word (the owner saves,
 * reads "Saved.", and nothing changed); a client-side validator re-inlined
 * would drift from the door's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientModule } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const admin = clientModule('admin');
const door = readFileSync(join(root, 'comments-worker', 'src', 'routes', 'admin.ts'), 'utf8');
const core = readFileSync(join(root, 'app', 'core.ts'), 'utf8');
const KEYS = ['alert_email', 'alert_email_on', 'alert_discord_webhook', 'alert_discord_on', 'alert_dm_on'];

test('every alert key the panel saves is a key the settings door allows', () => {
  /* anchored on the declaration, not its type (2026-09-17) */
  const allowed = door.slice(door.indexOf('const allowed'), door.indexOf('};', door.indexOf('const allowed')));
  for (const k of KEYS) {
    assert.ok(new RegExp('\\b' + k + ': 1').test(allowed), k + ' is in the door\'s allowed map');
    assert.ok(new RegExp(k + ': ').test(admin), k + ' is sent by the panel');
  }
  /* the switches are normalised to 1/0 at the door, like every other switch */
  assert.match(door, /k === 'alert_email_on' \|\| k === 'alert_discord_on' \|\| k === 'alert_dm_on'\) v = \(v === '1' \|\| v === 'true'\) \? '1' : '0'/);
});

test('the address is validated by the one kernel rule on both ends, and the test door is what the button presses', () => {
  assert.match(core, /export const opsIsEmailAddress = \(v: unknown\): boolean => Ops\.isEmailAddress\(/, 'the membrane erases the kernel rule once');
  assert.match(admin, /window\.mcCore\.opsIsEmailAddress\(v\)/, 'the panel asks the membrane, never a regex of its own');
  assert.doesNotMatch(admin, /\[\^\\s@\]\+@/, 'no re-inlined email regex in the client');
  assert.match(door, /if \(v && !OpsK\.isEmailAddress\(v\)\) return json\(\{ ok: false, error: 'That is not a valid email address\.' \}, 400\)/, 'the door refuses with its sentence');
  assert.match(admin, /fetch\(API \+ '\/admin\/alert-test'/, 'the button presses the test door');
  assert.match(door, /async function handleAlertTest\(request: Request, env: Env\)/);
});

test('the Health card reads the one health object and its Back up now runs the documented door', () => {
  assert.match(admin, /fetch\(API \+ '\/admin\/health'/, 'the card reads POST /admin/health');
  assert.match(door, /async function handleOpsHealth\(request: Request, env: Env\)/);
  assert.match(door, /return json\(\{ ok: true, health: await readOps\(env\) \}, 200\)/, 'the door serves ops.ts readOps, nothing of its own');
  assert.match(admin, /fetch\(API \+ '\/backup'/, 'Back up now presses POST /backup');
  for (const field of ['heartbeat', 'object', 'open', 'webtest', 'backup']) assert.match(admin, new RegExp('h\\.' + field + '\\b'), 'the card shows ' + field);
  assert.match(admin, /bk\.error \? ' Backup failed: ' \+ bk\.error/, 'a failed backup is read on screen, never swallowed');
});

