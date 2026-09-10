/* The librarian's config chain, held in shape.
 *
 * merecat's dials live in the LIBDB `config` table, written through
 * POST /api/merecat/config and read by merecatConfig(). Until 2026-09-10 that
 * chain had no kernel rule, no allowlist map, no coercion and no test — a
 * strict downgrade from app_settings. These are source-text drift guards, the
 * turnstile.test.mjs idiom: they read the worker and assert the RULE, so a
 * later edit that reintroduces a literal, a raw write or a hardcoded
 * temperature fails here rather than in production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const index = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
const durable = readFileSync(join(root, 'comments-worker', 'src', 'durable.ts'), 'utf8');
const client = readFileSync(join(root, 'client', 'comments.ts'), 'utf8');
const uncommented = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

test('the defaults come from the kernel, never a literal', () => {
  const d = lib.slice(lib.indexOf('export const MERECAT_DEFAULTS'), lib.indexOf('export function merecatReasoningView'));
  assert.ok(/temperature: Merecat\.temperatureDefault/.test(d), 'temperature must default through Domain.Merecat');
  assert.ok(/band_weights: Merecat\.bandWeightsCsv\(Merecat\.bandWeightsDefault\)/.test(d), 'band weights must default through Domain.Merecat');
  assert.ok(/reasoning_on: Merecat\.reasoningDefaults\.on/.test(d) && /reasoning_default: Merecat\.reasoningDefaults\.deflt/.test(d)
    && /reasoning_max: Merecat\.reasoningDefaults\.max/.test(d) && /mention_effort: Merecat\.reasoningDefaults\.mention/.test(d),
    'the four reasoning dials must default through Domain.Merecat');
});

test('every dial is read through the kernel, so a bad row yields its default', () => {
  const r = lib.slice(lib.indexOf('export async function merecatConfig('), lib.indexOf('merecatConfigCache.at = Date.now()'));
  for (const k of ['mention_effort', 'reasoning_default', 'reasoning_max']) {
    assert.ok(new RegExp(`r\\.k === '${k}'\\) cfg\\.${k} = Merecat\\.effortParse\\(`).test(r), `${k} must be parsed by Merecat.effortParse`);
  }
  assert.ok(/r\.k === 'reasoning_on'\) cfg\.reasoning_on = Merecat\.reasoningOnFrom\(/.test(r), 'reasoning_on must read through Merecat.reasoningOnFrom');
  assert.ok(/r\.k === 'temperature'\) cfg\.temperature = Merecat\.temperatureFrom\(/.test(r), 'temperature must read through Merecat.temperatureFrom');
  assert.ok(/r\.k === 'band_weights'\) cfg\.band_weights = Merecat\.bandWeightsCsv\(Merecat\.bandWeightsFrom\(/.test(r), 'band_weights must read through the kernel and be stored normalised');
  assert.ok(!/backend|failover/.test(uncommented(r)), 'the retired backend/failover keys must not come back');
});

test('the write is an allowlist MAP with coercion, and only the kernel dials are in it', () => {
  const m = index.slice(index.indexOf('const MERECAT_CONFIG_KEYS'), index.indexOf('async function handleMerecatConfigSet'));
  const keys = [...m.matchAll(/^  ([a-z_]+): \(v\) =>/gm)].map((x) => x[1]).sort();
  assert.deepEqual(keys, ['band_weights', 'global_daily', 'last_ingest', 'last_ingest_by', 'max_tokens', 'mention_effort', 'model',
    'persona_file_hash', 'reasoning_default', 'reasoning_max', 'reasoning_on', 'temperature', 'topk', 'user_cap_on', 'user_daily'].sort());
  for (const k of ['mention_effort', 'reasoning_default', 'reasoning_max']) assert.ok(new RegExp(`${k}: \\(v\\) => Merecat\\.effortParse\\(`).test(m), k);
  assert.ok(/temperature: \(v\) => String\(Merecat\.temperatureFrom\(/.test(m));
  assert.ok(/band_weights: \(v\) => Merecat\.bandWeightsCsv\(Merecat\.bandWeightsFrom\(/.test(m));
  const h = index.slice(index.indexOf('async function handleMerecatConfigSet'), index.indexOf('async function handleMerecatConfigSet') + 1400);
  assert.ok(/for \(const k of Object\.keys\(MERECAT_CONFIG_KEYS\)\)/.test(h) && /put\(k, MERECAT_CONFIG_KEYS\[k\]\(cfg\[k\]\)\)/.test(h),
    'the endpoint must write only allowlisted keys, each through its coercion');
});

test('the ChatRoom clamps every ask: the switch first, then the ceiling', () => {
  const f = lib.slice(lib.indexOf('export function merecatEffortFor'), lib.indexOf('export function merecatThinkSuffix'));
  assert.ok(/if \(!cfg\.reasoning_on\) return 'off';/.test(f), 'reasoning off means off, whatever was asked');
  assert.ok(/Merecat\.effortClamp\(String\(cfg\.reasoning_max\)\)\(Merecat\.effortParse\(String\(cfg\.reasoning_default\)\)/.test(f),
    'the reader\'s level is parsed against the default and clamped to the ceiling');
  const ask = durable.slice(durable.indexOf('async #ask('), durable.indexOf('async #generate('));
  assert.ok(/const effort = merecatEffortFor\(cfg, m\.instant \? 'off' : m\.effort\);/.test(ask), 'the ask frame\'s effort is a request the DO clamps');
  assert.ok(!/String\(m\.effort \|\| 'high'\)/.test(ask), 'the raw effort must never be stored as the level');
});

test('the prompt closes with /think and a directive, or /no_think', () => {
  const s = lib.slice(lib.indexOf('export function merecatThinkSuffix'), lib.indexOf('export function merecatHeadroom'));
  assert.ok(/Merecat\.effortThinks\(String\(effort\)\)/.test(s) && /\/think'/.test(s) && /'\/no_think'/.test(s));
  assert.ok(/export async function merecatPrompt\(env: any, q: any, history: any, summary: any, cfg: any, effort: any = 'off'\)/.test(lib),
    'merecatPrompt must take the level and default to off');
  const code = uncommented(lib);
  assert.equal([...code.matchAll(/\/no_think/g)].length, 2, 'only the suffix helper and the fold (which never reasons) may name /no_think');
});

test('temperature and headroom ride every model call from the config, not a literal', () => {
  const gen = uncommented(durable.slice(durable.indexOf('async #generate('), durable.indexOf('async #emit') > 0 ? durable.indexOf('async #emit') : durable.length));
  assert.ok(/max_tokens: cfg\.max_tokens \+ merecatHeadroom\(this\.gen\.effort\), temperature: cfg\.temperature/.test(gen),
    'the ask must add the level\'s headroom and use the configured temperature');
  assert.ok(/merecatPrompt\(this\.env, q, history, summary, cfg, this\.gen\.effort\)/.test(gen), 'the prompt must be built at the clamped level');
  assert.ok(/effort: this\.gen\.effort/.test(gen), 'the meta frame must tell the reader the level that actually ran');
  const mention = uncommented(lib.slice(lib.indexOf('const mentionEffort = merecatEffortFor(cfg, cfg.mention_effort);'), lib.indexOf('answer = merecatFinishAnswer(answer, sources);')));
  assert.ok(/max_tokens: 900 \+ merecatHeadroom\(mentionEffort\), temperature: cfg\.temperature/.test(mention));
  assert.ok(!/temperature: 0\.35/.test(uncommented(durable)) && !/temperature: 0\.35/.test(uncommented(lib)), 'no ask or mention may hardcode the temperature');
});

test('the search leg weights the bands from the config, through the kernel', () => {
  const r = lib.slice(lib.indexOf('export async function merecatRetrieve'), lib.indexOf('export async function merecatPrompt'));
  assert.ok(/Merecat\.bandCaseSql\(Merecat\.bandWeightsFrom\(String\(cfg\.band_weights \|\| ''\)\)\)/.test(r), 'the CASE must be built from cfg.band_weights');
  assert.ok(!/WHEN 1 THEN 1\.6/.test(uncommented(r)), 'the hardcoded ladder is back');
  assert.ok(/export const MERECAT_RV = (1[6-9]|[2-9]\d);/.test(lib), 'MERECAT_RV must be bumped for the retrieval change');
});

test('the client is told, so the selector can show only what is allowed', () => {
  assert.ok(/reasoning: merecatReasoningView\(cfg\)/.test(index), '/usage and /backends must carry the reasoning view');
  assert.ok(index.split('reasoning: merecatReasoningView(cfg)').length >= 3, 'both /usage and /backends');
  const c = client.slice(client.indexOf('function offerModes('), client.indexOf('function renderQuota('));
  assert.ok(/if \(!r \|\| !r\.on\) \{ modeRow\.hidden = true; return; \}/.test(c), 'the selector hides when the admin has reasoning off');
  assert.ok(/core\.merecatEffortClamp\(cap, lv\) === lv/.test(c), 'the selector offers nothing above the ceiling');
  assert.ok(/a\.effort = mode;/.test(client) && !/a\.instant = true/.test(client), 'the ask frame sends the level, and the retired instant flag is gone');
});

test('the pipeline\'s door: the ingest key opens the three librarian endpoints and nothing else', () => {
  const ri = lib.slice(lib.indexOf('export async function requireIngest'), lib.indexOf('export async function requireIngest') + 900);
  assert.ok(/env\.MERECAT_INGEST_KEY/.test(ri) && /return requireAdmin\(env, k\)/.test(ri), 'the ingest key or an admin key');
  assert.ok(/diff \|= a\[i\] \^ b\[i\]/.test(ri), 'compared in constant time');
  for (const fn of ['handleMerecatWorks', 'handleMerecatConfigSet', 'handleMerecatIngest']) {
    const h = index.slice(index.indexOf('async function ' + fn + '('), index.indexOf('async function ' + fn + '(') + 500);
    assert.ok(/requireIngest\(env/.test(h), fn + ' must accept the ingest key');
  }
  const admins = [...index.matchAll(/requireIngest\(env/g)].length;
  assert.equal(admins, 3, 'exactly the three librarian endpoints accept the ingest key');
  const f = index.slice(index.indexOf('async fetch(request: Request'), index.indexOf('for (const r of ROUTES)'));
  assert.ok(/url\.hostname\.endsWith\('\.workers\.dev'\)/.test(f) && /INGEST_DOORS\.indexOf\(path\) !== -1/.test(f),
    'workers.dev must serve only the ingest doors');
  assert.ok(/INGEST_DOORS = \['\/api\/merecat\/works', '\/api\/merecat\/config', '\/api\/merecat\/ingest'\]/.test(index));
  const wr = readFileSync(join(root, 'comments-worker', 'wrangler.jsonc'), 'utf8');
  assert.ok(/"workers_dev": true/.test(wr) && /"preview_urls": false/.test(wr), 'the workers.dev route is declared, previews are not');
});
