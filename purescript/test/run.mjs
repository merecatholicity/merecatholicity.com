// Layer 1: PureScript pure-unit tests, run under Node over the compiled ESM
// output (no browser, no framework). `make pstest` builds then runs this.
// Layer 2 (headless delegate/render parity vs the classic JS) lives in webtest/.
//
// This asserts Domain.Rank against the classic docs/comments.js ladder it
// replaces, so the parity gate can license deleting the classic fallback.
import assert from 'node:assert/strict';
import * as Rank from '../output/Domain.Rank/index.js';
import * as Scripture from '../output/Domain.Scripture/index.js';
import * as Profile from '../output/Domain.Profile/index.js';
import * as Faith from '../output/Domain.Faith/index.js';
import * as Pseudonym from '../output/Domain.Pseudonym/index.js';
import * as Dm from '../output/Domain.Dm/index.js';
import * as Access from '../output/Domain.Access/index.js';
import * as Live from '../output/Domain.Live/index.js';
import * as Fts from '../output/Domain.Fts/index.js';
import * as Pager from '../output/Domain.Pager/index.js';
import * as Board from '../output/Domain.Board/index.js';
import * as Emoji from '../output/Domain.Emoji/index.js';
import * as Route from '../output/Domain.Route/index.js';
import * as Auth from '../output/Domain.Auth/index.js';
import * as Mute from '../output/Domain.Mute/index.js';
import * as Blocked from '../output/Domain.Blocked/index.js';
import * as Compose from '../output/Domain.Compose/index.js';
import * as Maybe from '../output/Data.Maybe/index.js';
import * as Either from '../output/Data.Either/index.js';

const label = (n) => Rank.rankLabel(Rank.rankFor(n));

// The classic RANKS ladder (docs/comments.js:53-57): highest label reached.
const cases = [
  [0, 'Novice'], [9, 'Novice'],
  [10, 'Apprentice'], [49, 'Apprentice'],
  [50, 'Scriptorium Hand'], [99, 'Scriptorium Hand'],
  [100, 'Copyist'], [249, 'Copyist'],
  [250, 'Scribe'], [499, 'Scribe'],
  [500, 'Illuminator'], [999, 'Illuminator'],
  [1000, 'Master Scribe'], [2499, 'Master Scribe'],
  [2500, 'Keeper of Scrolls'], [4999, 'Keeper of Scrolls'],
  [5000, 'Treasury of Wisdom'], [10000, 'Treasury of Wisdom'],
  [-5, 'Novice'], // negatives stay at the seed rank, like the JS loop
];
for (const [n, want] of cases) assert.equal(label(n), want, `rankFor(${n})`);

// rankLine formatting + singular/plural (docs/comments.js:65).
assert.equal(Rank.rankLine(1), 'Novice · 1 post');
assert.equal(Rank.rankLine(0), 'Novice · 0 posts');
assert.equal(Rank.rankLine(10), 'Apprentice · 10 posts');
assert.equal(Rank.rankLine(250), 'Scribe · 250 posts');

// Monotonic: a higher count never yields a lower rank (by ladder index).
const order = [
  'Novice', 'Apprentice', 'Scriptorium Hand', 'Copyist', 'Scribe',
  'Illuminator', 'Master Scribe', 'Keeper of Scrolls', 'Treasury of Wisdom',
];
let prev = -1;
for (let n = 0; n <= 6000; n++) {
  const idx = order.indexOf(label(n));
  assert.ok(idx >= prev, `rank not monotonic at ${n}`);
  prev = idx;
}

console.log(`pstest: Domain.Rank OK (${cases.length} ladder cases + rankLine + monotonicity 0..6000)`);

// --- Domain.Scripture: the book table + autolink regex fragment ---
const slug = (k) => Maybe.maybe(null)((s) => s)(Scripture.bookSlug(k));
// bibleSrc invariants (full byte-equality vs the classic src is verified live in
// webtest/test_core_rank.py against a freshly recomputed oracle).
assert.equal(Scripture.bibleSrc.length, 2267, 'bibleSrc length');
assert.ok(Scripture.bibleSrc.startsWith('(second\\s+thessalonians|'), 'longest spelling first (stable sort)');
assert.ok(Scripture.bibleSrc.endsWith(')\\.?[ \\t]+(\\d+):(\\d+)(?:[\\-\\u2013](\\d+))?'), 'chapter:verse tail');
// bookSlug: a normalized key → canonical KJV slug, or null for a non-book.
const slugCases = [
  ['1 cor', '1-corinthians'], ['john', 'john'], ['ii samuel', '2-samuel'],
  ['song of solomon', 'song-of-solomon'], ['rev', 'revelation'], ['ps', 'psalms'],
  ['first thessalonians', '1-thessalonians'], ['nope', null], ['so', null],
];
for (const [k, want] of slugCases) assert.equal(slug(k), want, `bookSlug(${k})`);
console.log(`pstest: Domain.Scripture OK (bibleSrc 2267 chars + ${slugCases.length} bookSlug cases)`);

// verseParts: a validated reference {slug, ch, v1, v2, href}, or null. Illegal
// refs (chapter/verse below 1, non-book) are unrepresentable — they return null.
const vp = (b, c, v1, v2) => Scripture.verseParts(b)(c)(v1)(v2 == null ? null : v2);
const r1 = vp('rom', 8, 28, 30);
assert.ok(r1 && r1.slug === 'romans' && r1.href === 'romans-8-28' && r1.v2 === 30, 'rom 8:28-30');
const r2 = vp('john', 3, 16, null);
assert.ok(r2 && r2.href === 'john-3-16' && r2.v2 === 16, 'john 3:16 (no range)');
assert.equal(vp('rom', 0, 0, null), null, 'chapter 0 -> null');
assert.equal(vp('rom', 5, 0, null), null, 'verse 0 -> null');
assert.equal(vp('nope', 1, 1, null), null, 'non-book -> null');
const r3 = vp('rom', 3, 16, 10);
assert.ok(r3 && r3.v2 === 16 && r3.href === 'romans-3-16', 'backward range collapses to single verse');
console.log('pstest: Domain.Scripture.verseParts OK (validated refs + rejections)');

// --- Domain.Profile: the field caps (single source) + validators ---
assert.equal(Profile.limits.nick, 40, 'nick cap 40');
assert.equal(Profile.limits.bio, 500, 'bio cap 500 (drift lock: was 1000 in the admin editor)');
assert.equal(Profile.limits.sig, 200, 'sig cap 200');
assert.ok(Profile.mkBio('x'.repeat(500)) instanceof Either.Right, 'bio of 500 accepted');
assert.ok(Profile.mkBio('x'.repeat(501)) instanceof Either.Left, 'bio of 501 rejected');
assert.ok(Profile.mkNick('x'.repeat(41)) instanceof Either.Left, 'nick of 41 rejected');
console.log('pstest: Domain.Profile OK (caps 40/500/200 + validators; bio locked at 500)');

// --- Domain.Faith: the closed code↔label set + order ---
const flabel = (c) => Maybe.maybe('')((s) => s)(Faith.labelForCode(c));
assert.equal(Faith.faithList.length, 3);
assert.deepEqual(Faith.faithList.map((f) => f.code), ['nicene', 'indo-european', 'seeker']);
assert.equal(flabel('nicene'), 'Nicene');
assert.equal(flabel('indo-european'), 'pre-Christian Indo European');
assert.equal(flabel('seeker'), 'Seeker');
assert.equal(flabel('bogus'), '', 'unknown faith -> no label');
console.log('pstest: Domain.Faith OK (3 codes, ordered, labels)');

// --- Domain.Pseudonym: the "Adjective-Noun xxxx" derivation ---
assert.equal(Pseudonym.displayName('d1915a05c2583f437b1316971563b3c4c404cff016a016770d91af1f2645f7f6'), 'Constant-Almond d191');
assert.equal(Pseudonym.displayName('0000000000000000'), 'Patient-Cedar 0000');
assert.equal(Pseudonym.displayName('ffffffffffffffff'), 'Green-Wheat ffff');
assert.equal(Pseudonym.displayName('abcdef0123456789aa'), 'Swift-Field abcd');
console.log('pstest: Domain.Pseudonym OK (displayName parity)');

// --- Domain.Dm: DM lifetimes ---
assert.deepEqual(Dm.ttlOptions.map((o) => o.secs), [86400, 604800, 2592000]);
assert.equal(Dm.ttlLabel(86400), '24 hours');
assert.equal(Dm.ttlLabel(604800), '7 days');
assert.equal(Dm.ttlLabel(2592000), '30 days');
assert.equal(Dm.ttlLabel(3600), '24 hours');
console.log('pstest: Domain.Dm OK (ttl options + labels)');

// --- Domain.Access: the post permission matrix ---
const ci = (a, m, b) => Access.canInteract(a)(m)(b);
const cr = (a, m, b, ad) => Access.canReport(a)(m)(b)(ad);
const ce = (a, m) => Access.canEdit(a)(m);
const cd = (a, m, ad) => Access.canDelete(a)(m)(ad);
assert.equal(ci('x', 'me', 'bot'), true);
assert.equal(ci('me', 'me', 'bot'), false, 'no self-interact');
assert.equal(ci('bot', 'me', 'bot'), false, 'no bot-interact');
assert.equal(ci('x', '', 'bot'), false, 'keyless cannot interact');
assert.equal(cr('x', 'me', 'bot', true), false, 'admin has no report link');
assert.equal(cr('x', 'me', 'bot', false), true);
assert.equal(ce('me', 'me'), true);
assert.equal(ce('x', 'me'), false, 'only own post editable');
assert.equal(cd('x', 'me', true), true, 'admin deletes any');
assert.equal(cd('x', 'me', false), false, 'non-admin cannot delete other');
assert.equal(cd('me', 'me', false), true, 'own post deletable');
assert.equal(cd('x', '', true), false, 'keyless cannot delete');
console.log('pstest: Domain.Access OK (permission matrix)');

// --- Domain.Live: the pure live-forum decisions ---
const tc = (a, b) => Live.topicCompare(a)(b);
// comparator < 0 means the first arg sorts first (Array.sort)
assert.equal(Math.sign(tc({ sticky: 1, last: 10 }, { sticky: 0, last: 99 })), -1, 'sticky sorts first');
assert.equal(Math.sign(tc({ sticky: 0, last: 5 }, { sticky: 0, last: 9 })), 1, 'more recent sorts first');
assert.equal(tc({ sticky: 0, last: 9 }, { sticky: 0, last: 9 }), 0, 'equal keeps order');
assert.equal(Live.replyPage(21)(20), 2);
assert.equal(Live.replyPage(20)(20), 1);
assert.equal(Live.replyPage(1)(20), 1);
console.log('pstest: Domain.Live OK (topicCompare + replyPage)');

// --- Domain.Fts: the FTS5 SafeMatch sanitizer (worker-only single source) ---
// The classic worker buildMatch/merecatMatch, verbatim, as the parity oracle:
// a SafeMatch must be byte-identical to what the worker produced before.
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
  '"un', 'closed"', 'a\tb', 'a\nb', 'a b', 'a　b', 'a​b',
  ' leading', 'trailing ', 'the the the', 'What is grace and how does it work',
  'grace GRACE Grace', 'a an the of', 'i', 'is', "God's grace", 'God’s grace',
  "can't won't", 'café', 'naïve œuvre', 'John 3:16', '123 456', '!!!', '::',
  Array.from({ length: 30 }, (_, i) => 'w' + i).join(' '),
  Array.from({ length: 30 }, (_, i) => '"p' + i + '"').join(' '),
  'x'.repeat(300), '\t"phrase"\t',
];
for (const q of ftsCorpus) {
  assert.equal(Fts.unSafeMatch(Fts.buildMatch(q)), classicBuildMatch(q),
    `buildMatch parity: ${JSON.stringify(q)}`);
  assert.equal(Fts.unSafeMatch(Fts.merecatMatch(q)), classicMerecatMatch(q),
    `merecatMatch parity: ${JSON.stringify(q)}`);
}
// Injection is unrepresentable: an FTS5 operator can never survive as an operator.
// Strip well-formed "..."-quoted spans (with "" escapes) — only spaces (buildMatch)
// or " OR " joins (merecatMatch) may remain.
const stripQuoted = (s) => s.replace(/"(?:[^"]|"")*"/g, '');
for (const q of ['a OR b', 'x AND y', 'a* -b c:d NEAR(e f 2)', 'a"OR"b', '(a)']) {
  assert.equal(stripQuoted(Fts.unSafeMatch(Fts.buildMatch(q))).replace(/ /g, ''), '',
    `buildMatch injection-proof: ${JSON.stringify(q)}`);
  assert.equal(stripQuoted(Fts.unSafeMatch(Fts.merecatMatch(q))).replace(/ OR /g, '').replace(/ /g, ''), '',
    `merecatMatch injection-proof: ${JSON.stringify(q)}`);
}
console.log('pstest: Domain.Fts OK (buildMatch + merecatMatch parity + injection-proof)');

// --- Domain.Pager: the page-bar windowing (single source for the href + button pagers) ---
function origPagerPages(total, per, active) {
  const pages = Math.ceil(total / per);
  if (pages < 2) return null;
  const shown = [];
  for (let n = 1; n <= pages; n++) if (n === 1 || n === pages || Math.abs(n - active) <= 1) shown.push(n);
  const out = []; let prev = 0;
  shown.forEach((n) => {
    if (prev) { if (n - prev === 2) out.push({ n: prev + 1 }); else if (n - prev > 2) out.push({ gap: true }); }
    out.push({ n, active: n === active }); prev = n;
  });
  return out;
}
const pproj = (it) => ({ gap: !!it.gap, active: !!it.active, n: it.gap ? 0 : it.n });
let pagerN = 0;
for (let total = 0; total <= 90; total++) for (const per of [1, 2, 5, 10, 20]) {
  for (let active = 0; active <= Math.ceil(total / per) + 2; active++) {
    pagerN++;
    const orig = origPagerPages(total, per, active);
    const ps = Pager.pagerItems(total)(per)(active);
    assert.deepEqual(ps.map(pproj), (orig === null ? [] : orig).map(pproj),
      `pagerItems(${total},${per},${active})`);
  }
}
assert.deepEqual(Pager.pagerItems(0)(20)(1), [], 'single/empty page -> []');
console.log(`pstest: Domain.Pager OK (${pagerN} windowing cases vs classic pagerPages)`);

// --- Domain.Board: the category table (single source for worker CAT_META/BOARD_CATS + client CATS) ---
assert.equal(Board.catRows.length, 14, '14 categories');
assert.equal(Board.catKeys.length, 14);
assert.deepEqual(Board.catKeys, Board.catRows.map((r) => r[0]), 'catKeys === row keys');
assert.deepEqual(Board.catRows[0], ['pub', 'Pub', 'General discussion, for whatever fits nowhere more specific. New here? ', 'Introduce yourself and say hello', 'community.html?topic=37']);
assert.deepEqual(Board.catRows[13], ['adminsonly', 'Admins only', 'The back room.']);
assert.equal(Board.adminCat, 'board:adminsonly');
console.log('pstest: Domain.Board OK (14 categories, keys, adminCat)');

// --- Domain.Emoji: the packs + named-alias tokens (single source for worker /config + client) ---
assert.equal(Emoji.packs.memes.length, 33, '33 meme emoji');
assert.equal(Emoji.packs.pepe.length, 27, '27 pepe emoji');
assert.deepEqual(Emoji.packs.memes[0], ['cry', 'emoji/memes/cry.webp']);
const toks = Emoji.namedTokens.trim().split(/\s+/);
assert.equal(toks.length % 2, 0, 'named tokens pair up');
assert.equal(toks.length, 364, '182 name/emoji pairs');
assert.equal(toks[0], 'smile'); assert.equal(toks[1], '\u{1F604}');
console.log('pstest: Domain.Emoji OK (33 memes, 27 pepe, 182 named pairs)');

// --- Domain.Route: the URL->view priority ladder (single source for route()) ---
function psRoute(qs) {
  const params = new URLSearchParams(qs);
  const topicRaw = params.get('topic');
  const topicNum = Number(topicRaw);
  const topic = (topicRaw != null && Number.isInteger(topicNum) && topicNum > 0) ? topicNum : null;
  const g = (k) => params.get(k);
  return Route.routeTag(Route.parseRoute({
    ipbans: g('ipbans'), settings: g('settings'), admins: g('admins'), admin: g('admin'),
    merecatadmin: g('merecatadmin'), merecatthread: g('merecatthread'), merecatthreads: g('merecatthreads'),
    merecat: g('merecat'), notifications: g('notifications'), inbox: g('inbox'), users: g('users'),
    q: g('q'), dm: g('dm'), me: g('me'), profile: g('profile'), audit: g('audit'), topic, cat: g('cat'),
  }));
}
assert.equal(psRoute('').tag, 'Index');
assert.equal(psRoute('cat=rc').tag, 'Cat');
assert.equal(psRoute('cat=rc').s, 'rc');
assert.equal(psRoute('topic=42').tag, 'Topic');
assert.equal(psRoute('topic=42').n, 42);
assert.equal(psRoute('topic=0').tag, 'Index', 'topic=0 -> not a topic');
assert.equal(psRoute('topic=5.5').tag, 'Index', 'non-integer topic -> not a topic');
assert.equal(psRoute('q=').tag, 'Search', 'bare ?q= (present) -> search');
assert.equal(psRoute('merecatthreads').tag, 'MerecatThreads', 'bare ?merecatthreads (present)');
assert.equal(psRoute('ipbans=1').tag, 'IpBans');
assert.equal(psRoute('merecat=1&topic=5').tag, 'Merecat', 'priority: earlier param wins');
assert.equal(psRoute('dm=abc').tag, 'Dm');
assert.equal(psRoute('dm=abc').s, 'abc');
assert.equal(psRoute('me=1').tag, 'Me');
assert.equal(psRoute('ipbans').tag, 'Index', 'bare ?ipbans (empty value) is falsy -> not ipbans');
console.log('pstest: Domain.Route OK (priority ladder + topic/present edge cases)');

// --- Domain.Auth: the identity/admin classification (single source for isAdmin/adminGate) ---
function cAdmin(hasKey, profileLoaded, myAdmin, hint) { if (!hasKey) return false; if (profileLoaded) return myAdmin; return myAdmin || hint; }
function cGate(hasKey, profileLoaded, myAdmin, hint) { if (cAdmin(hasKey, profileLoaded, myAdmin, hint)) return 'pass'; if (!hasKey || profileLoaded) return 'deny'; return 'wait'; }
let authN = 0;
for (const hasKey of [false, true]) for (const hasHash of [false, true]) for (const profileLoaded of [false, true])
  for (const myAdmin of [false, true]) for (const hint of [false, true]) {
    authN++;
    const sig = { hasKey, hasHash, profileLoaded, myAdmin, hint };
    assert.equal(Auth.isAdmin(sig), cAdmin(hasKey, profileLoaded, myAdmin, hint), 'isAdmin ' + JSON.stringify(sig));
    assert.equal(Auth.isMember(sig), !!(hasKey && hasHash), 'isMember ' + JSON.stringify(sig));
    assert.equal(Auth.gate(sig), cGate(hasKey, profileLoaded, myAdmin, hint), 'gate ' + JSON.stringify(sig));
  }
assert.equal(Auth.stateTag(Auth.classify({ hasKey: false, hasHash: false, profileLoaded: false, myAdmin: false, hint: false })), 'Anonymous');
assert.equal(Auth.stateTag(Auth.classify({ hasKey: true, hasHash: false, profileLoaded: false, myAdmin: false, hint: false })), 'Authenticating');
assert.equal(Auth.stateTag(Auth.classify({ hasKey: true, hasHash: true, profileLoaded: false, myAdmin: false, hint: false })), 'Pending');
assert.equal(Auth.stateTag(Auth.classify({ hasKey: true, hasHash: true, profileLoaded: true, myAdmin: false, hint: false })), 'Member');
assert.equal(Auth.stateTag(Auth.classify({ hasKey: true, hasHash: true, profileLoaded: true, myAdmin: true, hint: false })), 'Admin');
assert.equal(Auth.stateTag(Auth.classify({ hasKey: true, hasHash: true, profileLoaded: false, myAdmin: false, hint: true })), 'Admin', 'hint before load = Admin');
console.log('pstest: Domain.Auth OK (' + authN + ' signal combos + AuthState classify)');

// --- Domain.Mute + Domain.Blocked (moderation) ---
const BOT = 'botHASH';
assert.equal(Mute.isMuted(BOT)('a')(['a']), true);
assert.equal(Mute.isMuted(BOT)(BOT)([BOT]), false, 'bot never muted');
assert.equal(Mute.isMuted(BOT)('')([]), false, 'empty hash');
assert.equal(Mute.isMuted(BOT)('z')(['a', 'b']), false);
assert.deepEqual(Mute.toggleMute('x')([]), { list: ['x'], added: true });
assert.deepEqual(Mute.toggleMute('x')(['x', 'y']), { list: ['y'], added: false });
assert.equal(Blocked.messageFor('ipban').startsWith('Your network is banned'), true);
assert.equal(Blocked.messageFor('locked').startsWith('This identity has been locked'), true);
assert.equal(Blocked.messageFor('banned').startsWith('This identity has been locked'), true);
assert.equal(Blocked.messageFor('unknown').startsWith('This identity has been locked'), true, 'unknown -> identity (classic else)');
console.log('pstest: Domain.Mute + Domain.Blocked OK');

// --- Domain.Compose.mentionsIn (send-time mention resolution) ---
assert.deepEqual(Compose.mentionsIn('hi @alice and @bob')([{ token: '@alice', hash: 'h1' }, { token: '@bob', hash: 'h2' }]), ['h1', 'h2']);
assert.deepEqual(Compose.mentionsIn('only @alice')([{ token: '@alice', hash: 'h1' }, { token: '@bob', hash: 'h2' }]), ['h1'], 'token gone -> dropped');
assert.deepEqual(Compose.mentionsIn('@a @a')([{ token: '@a', hash: 'h1' }, { token: '@a', hash: 'h1' }]), ['h1'], 'dedup by hash');
assert.deepEqual(Compose.mentionsIn('none')([{ token: '@x', hash: 'h9' }]), []);
console.log('pstest: Domain.Compose OK (mentionsIn)');
