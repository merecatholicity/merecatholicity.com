/* app/core.js — the ONE translation membrane between the PureScript Domain layer
   and the JS UI. The domain RULES are proved in tests/purescript/; THIS file
   proves the membrane's job: the JS-side coercions the PS side deliberately
   omits (n|0, ||'' , !!, Number()||default) and the ADT erasure (Maybe -> null
   or ''). If a coercion here were wrong, the rule would be right but the UI would
   get the wrong shape — so this is where those seams are guarded. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../../app/core.ts';

test('rankFor/rankLine coerce their argument to an Int (n | 0)', () => {
  assert.equal(Core.rankFor(10), 'Apprentice');
  assert.equal(Core.rankFor(10.9), 'Apprentice', 'truncates via | 0');
  assert.equal(Core.rankFor('250'), 'Scribe', 'numeric string coerces');
  assert.equal(Core.rankLine(1), 'Novice · 1 post');
});

test('bookSlug erases Maybe to slug | null', () => {
  assert.equal(Core.bookSlug('1 cor'), '1-corinthians');
  assert.equal(Core.bookSlug('nope'), null, 'Nothing -> null');
});

test('verseParts coerces ch/v1/v2 and passes Nullable through', () => {
  const r = Core.verseParts('rom', '8', '28', '30'); // strings from the regex
  assert.ok(r && r.slug === 'romans' && r.href === 'romans-8-28' && r.v2 === 30);
  const single = Core.verseParts('john', 3, 16); // v2 omitted -> undefined -> single verse
  assert.ok(single && single.v2 === 16, 'missing range end -> single verse');
  assert.equal(Core.verseParts('nope', 1, 1), null, 'non-book -> null');
});

test('faithLabel erases Maybe to label | "" (empty for unknown)', () => {
  assert.equal(Core.faithLabel('nicene'), 'Nicene');
  assert.equal(Core.faithLabel('bogus'), '', 'Nothing -> ""');
  assert.equal(Core.faiths.length, 3);
});

test('profileLimits is the plain caps record', () => {
  assert.deepEqual(Core.profileLimits, { nick: 40, bio: 500, sig: 200 });
});

test('dmTtlLabel coerces a missing/zero TTL to the 30-day default', () => {
  assert.equal(Core.dmTtlLabel(86400), '24 hours');
  assert.equal(Core.dmTtlLabel(0), '30 days', '0 -> default (Domain.Dm.defaultTtl)');
  assert.equal(Core.dmTtlLabel(null), '30 days', 'null -> default');
  assert.equal(Core.dmTtlLabel(604800), '7 days', 'an explicit 7-day value still labels 7 days');
  assert.equal(Core.dmTtlLabel('2592000'), '30 days', 'numeric string coerces');
});

test('the DM reaction membrane erases Maybe to string | null and coerces nullish input', () => {
  assert.equal(Core.dmQuickReactions.length, 6, 'the press-and-hold bar\'s six pass through as a plain array');
  assert.equal(Core.dmReaction('👍'), '👍');
  assert.equal(Core.dmReaction(':PepeHeart:'), ':pepeheart:', 'a custom token comes back lower-cased');
  assert.equal(Core.dmReaction('lol'), null, 'Nothing -> null (the picker refuses before the wire)');
  assert.equal(Core.dmReaction(null), null, 'nullish -> "" -> null, never a throw');
  assert.equal(Core.dmReplyExcerpt('  a \n b  '), 'a b');
  assert.equal(Core.dmReplyExcerpt(undefined), '', 'nullish -> ""');
  assert.equal(Core.dmReplySentinel, '\u0001', 'the envelope opener the client tests the first character against');
});

test('the Access predicates coerce nullish hashes to a keyless viewer', () => {
  assert.equal(Core.canInteract('x', 'me', 'bot'), true);
  assert.equal(Core.canInteract('x', null, 'bot'), false, 'null viewer = keyless -> false');
  assert.equal(Core.canReport('x', 'me', 'bot', 1), false, 'truthy admin -> no report link');
  assert.equal(Core.canReport('x', 'me', 'bot', 0), true);
  assert.equal(Core.canEdit('me', 'me'), true);
  assert.equal(Core.canEdit('x', 'me'), false, 'isAdmin omitted -> false');
  assert.equal(Core.canEdit('x', 'me', 1), true, 'admin edits any (truthy coerces)');
  assert.equal(Core.canDelete('x', 'me', 1), true, 'admin deletes any');
});

test('topicCompare/replyPage coerce their record/number inputs', () => {
  assert.equal(Math.sign(Core.topicCompare({ sticky: 1, last: 10 }, { sticky: 0, last: 99 })), -1);
  assert.equal(Core.topicCompare({}, {}), 0, 'missing sticky/last default to 0');
  assert.equal(Core.replyPage(21, 20), 2);
});

test('pagerItems returns plain cells, [] for a single page', () => {
  assert.deepEqual(Core.pagerItems(0, 20, 1), []);
  const cells = Core.pagerItems(45, 20, 1);
  assert.ok(Array.isArray(cells) && cells.length > 0 && 'n' in cells[0]);
});

test('board data + emoji data pass through as plain values', () => {
  assert.equal(Core.boardCatRows.length, 14);
  assert.equal(Core.boardCatKeys.length, 14);
  assert.equal(Core.adminCat, 'board:adminsonly');
  assert.equal(Core.emojiPacks.memes.length, 33);
  assert.equal(typeof Core.emojiNamedTokens, 'string');
});

test('parseRoute runs the topic integer-gate at the JS boundary', () => {
  const route = (qs) => { const p = new URLSearchParams(qs); return Core.parseRoute((k) => p.get(k)); };
  assert.equal(route('topic=42').tag, 'Topic');
  assert.equal(route('topic=42').n, 42);
  assert.equal(route('topic=0').tag, 'Index', 'topic=0 -> not a topic');
  assert.equal(route('topic=5.5').tag, 'Index', 'non-integer -> not a topic');
  assert.equal(route('merecat=1&topic=5').tag, 'Merecat', 'priority ladder');
  assert.equal(route('feed=1').tag, 'Feed', 'the public feed route');
  assert.equal(route('post=7').tag, 'Post', 'a single public post route');
});

test('auth predicates coerce every signal to Boolean', () => {
  assert.equal(Core.authIsMember({ hasKey: true, hasHash: true }), true);
  assert.equal(Core.authIsAdmin({ hasKey: true, profileLoaded: true, myAdmin: true }), true);
  assert.equal(Core.authGate({}), 'deny', 'no key -> deny');
  assert.equal(Core.authGate({ hasKey: true }), 'wait', 'key, still loading, not admin -> wait');
});

test('mute helpers coerce null list/hash and never mute the bot', () => {
  assert.equal(Core.isMuted('bot', 'a', ['a']), true);
  assert.equal(Core.isMuted('bot', 'bot', ['bot']), false);
  assert.equal(Core.isMuted(null, null, null), false, 'nullish inputs never throw');
  assert.deepEqual(Core.toggleMute('x', null), { list: ['x'], added: true }, 'null list -> []');
});

test('blockedMessage / mentionsIn tolerate nullish input', () => {
  assert.ok(Core.blockedMessage('ipban').startsWith('Your network is banned'));
  assert.ok(Core.blockedMessage(null).startsWith('This identity has been locked'), 'null -> identity lock');
  assert.deepEqual(Core.mentionsIn('hi @a', [{ token: '@a', hash: 'h1' }]), ['h1']);
  assert.deepEqual(Core.mentionsIn(null, null), [], 'nullish -> []');
});

test('wallEnabledFrom survives the boundary: nullish is the default, not "off"', () => {
  assert.equal(Core.wallEnabledDefault, true);
  assert.equal(Core.wallEnabledFrom('0'), false);
  assert.equal(Core.wallEnabledFrom('1'), true);
  /* The admin settings box reads a stored value that may simply not be there.
     A missing row means the default (ON); coercing null to the string "null"
     would also read ON, but going through '' says so on purpose. */
  assert.equal(Core.wallEnabledFrom(null), true, 'no stored row -> the default');
  assert.equal(Core.wallEnabledFrom(undefined), true);
});

test('the comments-section rules cross with null-safe coercions (Domain.Comments)', () => {
  assert.ok(Core.commentablePages.length >= 7);
  assert.equal(Core.commentablePages[0].path, '/book.html');
  assert.equal(Core.commentablePages[0].kind, 'book');
  assert.equal(typeof Core.commentablePages[0].title, 'string');
  assert.deepEqual(Core.commentsParseEnabledPages(null), [], 'an absent row -> nothing open');
  assert.deepEqual(Core.commentsParseEnabledPages(' /credo.html ,/anf01.html'), ['/credo.html']);
  assert.equal(Core.commentsSerializeEnabledPages(['/about.html', '/book.html']), '/book.html,/about.html');
  assert.equal(Core.commentsPageEnabled(undefined, '/credo.html'), false);
  assert.equal(Core.commentsPageEnabled('/credo.html', '/credo.html'), true);
  assert.equal(Core.commentsJournalFrom(undefined), false, 'absent -> off: the OPPOSITE polarity of the social switch');
  assert.equal(Core.commentsJournalFrom('1'), true);
  assert.equal(Core.commentsJournalFrom('true'), false);
  assert.equal(Core.commentsPageHref('journal:3'), '/journal.html?a=3');
  assert.equal(Core.commentsPageHref('/book.html'), '/book.html');
  assert.equal(Core.commentsPageHref(null), '', 'null -> "" (String(null || \'\'))');
});

test('reaction/quickReactions are the one grammar (Domain.Reaction); the dm-prefixed names are the same values', () => {
  assert.equal(Core.reaction, Core.dmReaction, 'one validator under two names');
  assert.equal(Core.quickReactions, Core.dmQuickReactions);
  assert.equal(Core.reaction('😂'), '😂');
  assert.equal(Core.reaction('two 😂😂'), null);
  assert.deepEqual([...Core.reactionTargets], ['post', 'wall', 'wallc']);
  assert.equal(Core.isReactionTarget('wallc'), true);
  assert.equal(Core.isReactionTarget(undefined), false, 'nullish -> "" -> false, never a throw');
});

test('notifLabel/notifHref/notifHasSnippet coerce the wire row (missing fields -> "" / 0) and erase nothing', () => {
  const it = { kind: 'wall-react', actor_nick: '', actor_hash: 'c'.repeat(64), topic_id: '7', comment_id: 3 };
  assert.match(Core.notifLabel(it), /^[A-Z][a-z]+-[A-Z][a-z]+ [0-9a-f]{4} reacted to your comment$/, 'the pseudonym for a nickless actor; "7" coerces to 7 (a comment)');
  assert.equal(Core.notifHref(it), 'feed.html?post=3#wc-7');
  assert.equal(Core.notifLabel({ kind: 'react', actor_nick: 'Ann' }), 'Ann reacted to your post');
  assert.equal(Core.notifHref({ kind: 'react', actor_nick: 'Ann' }), 'community.html?topic=0#comment-0', 'missing ids coerce to 0');
  assert.equal(Core.notifLabel(null), 'Someone replied in a thread', 'a null row never throws');
  assert.equal(Core.notifHasSnippet('dm-react'), false);
  assert.equal(Core.notifHasSnippet(undefined), true, 'an unknown/missing kind may show its excerpt');
  assert.ok(Core.notifKinds.includes('dm-react'));
});
