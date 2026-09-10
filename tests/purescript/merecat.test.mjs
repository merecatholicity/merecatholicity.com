/* Domain.Merecat — the librarian's dials, single-sourced.
 *
 * The reasoning ladder, its resting values, the temperature and the nine band
 * weights are read by the worker (every ask, every mention, the search leg,
 * the config endpoint) and by the client (the reader's selector, the admin
 * dials) through one module. These specs are the contract both sides hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../purescript/output/Domain.Merecat/index.js';

test('the ladder has six steps in order, off first', () => {
  assert.deepEqual(M.effortLadder, ['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(M.effortIndex('off'), 0);
  assert.equal(M.effortIndex('max'), 5);
  assert.equal(M.effortIndex('turbo'), -1);
});

test('a level is read leniently, and the retired instant folds into off', () => {
  assert.equal(M.effortParse('high')(' High '), 'high');
  assert.equal(M.effortParse('high')('instant'), 'off');
  assert.equal(M.effortParse('high')('nonsense'), 'high');
  assert.equal(M.effortParse('high')(''), 'high');
  /* a bad fallback still yields a level — the safe one */
  assert.equal(M.effortParse('bogus')('bogus'), 'off');
});

test('the ceiling clamps, and an unset ceiling caps at off', () => {
  assert.equal(M.effortClamp('high')('max'), 'high');
  assert.equal(M.effortClamp('high')('low'), 'low');
  assert.equal(M.effortClamp('high')('high'), 'high');
  assert.equal(M.effortClamp('')('max'), 'off');
  assert.equal(M.effortClamp('medium')('instant'), 'off');
});

test('off never thinks; every other level does, with a growing headroom', () => {
  assert.equal(M.effortThinks('off'), false);
  for (const lv of M.effortLadder.slice(1)) assert.equal(M.effortThinks(lv), true, lv);
  const room = M.effortLadder.map((lv) => M.effortHeadroom(lv));
  assert.equal(room[0], 0);
  for (let i = 1; i < room.length; i++) assert.ok(room[i] > room[i - 1], `headroom must grow with the level (${M.effortLadder[i]})`);
});

test('the directive is plain English at every level but medium and off', () => {
  assert.equal(M.effortDirective('off'), '');
  assert.equal(M.effortDirective('medium'), '');
  for (const lv of ['low', 'high', 'xhigh', 'max']) assert.ok(/before you answer\.$/.test(M.effortDirective(lv)), lv);
  assert.equal(M.effortLabel('xhigh'), 'Extra high');
  assert.equal(M.effortLabel('nonsense'), 'Off');
});

test('the switch is default-off: only a literal 1 turns reasoning on', () => {
  assert.equal(M.reasoningOnFrom('1'), true);
  assert.equal(M.reasoningOnFrom(' 1 '), true);
  for (const v of ['0', '', 'true', 'on', 'yes']) assert.equal(M.reasoningOnFrom(v), false, JSON.stringify(v));
  assert.deepEqual(M.reasoningDefaults, { on: false, deflt: 'low', max: 'high', mention: 'high' });
});

test('temperature reads a decimal in 0..1 and falls back to the old constant', () => {
  assert.equal(M.temperatureDefault, 0.35);
  assert.equal(M.temperatureFrom('0.2'), 0.2);
  assert.equal(M.temperatureFrom('1'), 1);
  assert.equal(M.temperatureFrom('7'), 1);
  assert.equal(M.temperatureFrom('-1'), 0);
  assert.equal(M.temperatureFrom('warm'), 0.35);
  assert.equal(M.temperatureFrom(''), 0.35);
});

test('parseDecimal reads what the config table can hold, and nothing else', () => {
  assert.equal(M.parseDecimal('1.6').value0, 1.6);
  assert.equal(M.parseDecimal('.5').value0, 0.5);
  assert.equal(M.parseDecimal('2').value0, 2);
  for (const bad of ['1.2.3', 'abc', '1e3', '', '.']) assert.equal(M.parseDecimal(bad).constructor.name, 'Nothing', JSON.stringify(bad));
});

test('the band ladder is nine weights, clamped, or the default whole', () => {
  assert.deepEqual(M.bandWeightsDefault, [1.6, 1.45, 1.35, 1.25, 1.0, 1.4, 0.9, 1.55, 1.3]);
  const csv = M.bandWeightsCsv(M.bandWeightsDefault);
  assert.deepEqual(M.bandWeightsFrom(csv), M.bandWeightsDefault, 'csv round-trips');
  assert.deepEqual(M.bandWeightsFrom('1,1,1,1,1,1,1,1'), M.bandWeightsDefault, 'eight entries is not a ladder');
  assert.deepEqual(M.bandWeightsFrom('1,1,1,1,x,1,1,1,1'), M.bandWeightsDefault, 'one unreadable entry yields the default whole');
  assert.deepEqual(M.bandWeightsFrom('0,9,1,1,1,1,1,1,1'), [0.1, 3.0, 1, 1, 1, 1, 1, 1, 1], 'each weight is clamped to 0.1..3');
});

test('the SQL arm names every band from the ladder, else 1.0', () => {
  const sql = M.bandCaseSql(M.bandWeightsDefault);
  assert.equal(sql, '(CASE w.tier WHEN 1 THEN 1.6 WHEN 2 THEN 1.45 WHEN 3 THEN 1.35 WHEN 4 THEN 1.25 WHEN 5 THEN 1.0 WHEN 6 THEN 1.4 WHEN 7 THEN 0.9 WHEN 8 THEN 1.55 WHEN 9 THEN 1.3 ELSE 1.0 END)');
  assert.equal(M.bandCaseSql([1, 2]), sql, 'a ladder of the wrong length is replaced by the default');
});
