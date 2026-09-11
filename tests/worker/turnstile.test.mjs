/* The worker's half of the verification rule.
 *
 * The client may believe it is spared, but only the server knows whether an
 * identity is established, and only the server can be trusted to ask. These
 * hold the three properties that make the skip safe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const index = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');

const verify = lib.slice(lib.indexOf('export async function verifyTurnstile'),
  lib.indexOf('/* ---- Shadow ban'));

test('the skip only applies when no token was offered', () => {
  /* A presented token is still verified against siteverify. Skipping that
     would let a spent or forged token through on a technicality. */
  assert.ok(/if \(!token && key\) \{/.test(verify),
    'the skip must be gated on there being no token at all');
  assert.ok(/siteverify/.test(verify), 'a presented token is still verified');
});

test('it asks the server, never the caller', () => {
  assert.ok(/turnstileSkipEstablished\(s\)/.test(verify), 'the setting is read from app_settings');
  assert.ok(/isEstablished\(env, await sha256hex\(key\)\)/.test(verify),
    'establishment is looked up from the identity hash, not taken on trust');
  /* Nothing in the request may influence this: no header, no body flag, no
     user-agent sniff. The hash and the setting are the only inputs. */
  assert.ok(!/User-Agent|userAgent|standalone|display-mode/i.test(verify),
    'nothing about the client may earn the exemption');
});

test('it fails closed, like the rest of the function', () => {
  /* A settings read or an establishment probe that throws must demand a token,
     never wave the write through. */
  const guard = verify.slice(verify.indexOf('if (!token && key)'), verify.indexOf('try {\n    const res'));
  assert.ok(/catch \(err\) \{/.test(guard), 'the skip must be wrapped');
  assert.ok(!/return true/.test(guard.slice(guard.indexOf('catch'))),
    'the catch must fall through to demanding a token, not return true');
});

test('the setting is reachable, coerced, and served', () => {
  /* The standing gap this file also closes: nothing had ever guarded the
     /admin/settings allowlist, so a mistyped key was a silent no-op. */
  assert.ok(/turnstile_skip_established: 1/.test(index), 'not in the /admin/settings allowlist');
  /* Assert the RULE, not the line (the social test's lesson): the key sits in
     the shared 1/0 coercion chain, whatever siblings join it later. */
  const coercion = index.slice(index.indexOf("if (k === 'media_enabled'"));
  const chain = coercion.slice(0, coercion.indexOf(';') + 1);
  assert.ok(/k === 'turnstile_skip_established'/.test(chain) && /v = \(v === '1' \|\| v === 'true'\) \? '1' : '0';/.test(chain),
    'not coerced to 1/0 like its sibling switches');
  assert.ok(/turnstile: \{ skip_established: turnstileSkipEstablished\(s\) \}/.test(index),
    '/config must tell the client whether a challenge is worth mounting');
  assert.ok(/turnstile_skip_established: Turnstile\.skipEstablishedDefault/.test(lib),
    'the default must come from the kernel, not a literal');
});
