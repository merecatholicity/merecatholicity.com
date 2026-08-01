/* Domain.Fts — the FTS5 query sanitizer (the single source behind the worker's
   forum search and merecat retrieval MATCH). This is SECURITY-critical: a raw
   user query must never let an FTS5 operator (* - : ^ NEAR AND OR NOT ( ))
   through as an operator. We prove two things: byte-parity with the classic
   worker buildMatch/merecatMatch it replaced, and that injection is
   unrepresentable — after stripping the "..."-quoted spans, nothing survives. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Fts from '../../purescript/output/Domain.Fts/index.js';

// The classic worker buildMatch/merecatMatch, verbatim, as the parity oracle.
function classicBuildMatch(q) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(q || ''))) && tokens.length < 10) {
    const raw = (m[1] !== undefined ? m[1] : m[2]).trim();
    if (raw) tokens.push('"' + raw.replace(/"/g, '""') + '"');
  }
  return tokens.join(' ');
}
const MERECAT_STOP = new Set(('a about all an and any are as at be been but by can could did do does for from had has have ' +
  'he her his how i if in into is it its just like me my no not of on one or our out over say says said she should so some ' +
  'than that the their them then there these they this to under up us was we were what when where which who why will with ' +
  'would you your').split(' '));
function classicMerecatMatch(q) {
  const out = [];
  const seen = new Set();
  const re = /"([^"]*)"|([A-Za-z0-9À-ɏ'’]+)/g;
  let m;
  while ((m = re.exec(String(q || ''))) && out.length < 16) {
    if (m[1] !== undefined) {
      const p = m[1].trim();
      if (p) out.push('"' + p.replace(/"/g, '""') + '"');
      continue;
    }
    const w = m[2].toLowerCase().replace(/[’']/g, '');
    if (w.length < 2 || MERECAT_STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push('"' + w.replace(/"/g, '""') + '"');
  }
  return out.join(' OR ');
}

const ftsCorpus = [
  '', ' ', '   ', 'grace', 'grace alone', 'faith and works',
  '"exact phrase"', '"faith alone" grace', 'a "b c" d',
  'foo OR bar', 'foo AND bar', 'foo NOT bar', 'a NEAR b', 'col:val',
  'wild*', '-neg', '^anchor', '(group)', 'a AND (b OR c)', 'x - y', 'a:b:c',
  'say "hi"', 'a"b', '""', '" "', '"  spaced  "', 'a""b', 'foo"bar"baz',
  '"un', 'closed"', 'a\tb', 'a\nb', 'a b', 'a　b', 'a​b',
  ' leading', 'trailing ', 'the the the', 'What is grace and how does it work',
  'grace GRACE Grace', 'a an the of', 'i', 'is', "God's grace", 'God’s grace',
  "can't won't", 'café', 'naïve œuvre', 'John 3:16', '123 456', '!!!', '::',
  Array.from({ length: 30 }, (_, i) => 'w' + i).join(' '),
  Array.from({ length: 30 }, (_, i) => '"p' + i + '"').join(' '),
  'x'.repeat(300), '\t"phrase"\t',
];

test('buildMatch + merecatMatch are byte-identical to the classic worker (55 queries)', () => {
  for (const q of ftsCorpus) {
    assert.equal(Fts.unSafeMatch(Fts.buildMatch(q)), classicBuildMatch(q),
      `buildMatch parity: ${JSON.stringify(q)}`);
    assert.equal(Fts.unSafeMatch(Fts.merecatMatch(q)), classicMerecatMatch(q),
      `merecatMatch parity: ${JSON.stringify(q)}`);
  }
});

test('injection is unrepresentable: no FTS5 operator survives outside a quoted span', () => {
  // Strip well-formed "..."-quoted spans (with "" escapes); only spaces
  // (buildMatch) or " OR " joins (merecatMatch) may remain.
  const stripQuoted = (s) => s.replace(/"(?:[^"]|"")*"/g, '');
  for (const q of ['a OR b', 'x AND y', 'a* -b c:d NEAR(e f 2)', 'a"OR"b', '(a)']) {
    assert.equal(stripQuoted(Fts.unSafeMatch(Fts.buildMatch(q))).replace(/ /g, ''), '',
      `buildMatch injection-proof: ${JSON.stringify(q)}`);
    assert.equal(stripQuoted(Fts.unSafeMatch(Fts.merecatMatch(q))).replace(/ OR /g, '').replace(/ /g, ''), '',
      `merecatMatch injection-proof: ${JSON.stringify(q)}`);
  }
});
