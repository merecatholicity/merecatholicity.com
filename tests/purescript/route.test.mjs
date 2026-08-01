/* Domain.Route — the forum's URL -> view priority ladder (the single source for
   comments.js route()). The ORDER is load-bearing: when several params are
   present the earlier one in the ladder wins (?merecat beats ?topic). The
   `topic` param's integer-gate coercion is done at the JS boundary (mirrored
   here), so topic=0 and topic=5.5 are "not a topic". */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Route from '../../purescript/output/Domain.Route/index.js';

// Mirror the app/core.js parseRoute boundary: the topic integer-gate lives in JS.
function psRoute(qs) {
  const params = new URLSearchParams(qs);
  const topicRaw = params.get('topic');
  const topicNum = Number(topicRaw);
  const topic = (topicRaw != null && Number.isInteger(topicNum) && topicNum > 0) ? topicNum : null;
  const g = (k) => params.get(k);
  return Route.routeTag(Route.parseRoute({
    ipbans: g('ipbans'), settings: g('settings'), admins: g('admins'), admin: g('admin'),
    merecatadmin: g('merecatadmin'), merecatthread: g('merecatthread'), merecatthreads: g('merecatthreads'),
    merecat: g('merecat'), feed: g('feed'), notifications: g('notifications'), inbox: g('inbox'), users: g('users'),
    q: g('q'), dm: g('dm'), me: g('me'), profile: g('profile'), post: g('post'), audit: g('audit'), topic, cat: g('cat'),
  }));
}

test('the common views resolve from their params', () => {
  assert.equal(psRoute('').tag, 'Index');
  assert.equal(psRoute('cat=rc').tag, 'Cat');
  assert.equal(psRoute('cat=rc').s, 'rc');
  assert.equal(psRoute('topic=42').tag, 'Topic');
  assert.equal(psRoute('topic=42').n, 42);
  assert.equal(psRoute('ipbans=1').tag, 'IpBans');
  assert.equal(psRoute('dm=abc').tag, 'Dm');
  assert.equal(psRoute('dm=abc').s, 'abc');
  assert.equal(psRoute('me=1').tag, 'Me');
});

test('topic must be a positive integer, else it is not a topic', () => {
  assert.equal(psRoute('topic=0').tag, 'Index', 'topic=0 -> not a topic');
  assert.equal(psRoute('topic=5.5').tag, 'Index', 'non-integer -> not a topic');
});

test('presence is by truthy value; a bare empty param does not select', () => {
  assert.equal(psRoute('q=').tag, 'Search', 'bare ?q= (present) -> search');
  assert.equal(psRoute('merecatthreads').tag, 'MerecatThreads', 'bare ?merecatthreads (present)');
  assert.equal(psRoute('ipbans').tag, 'Index', 'bare ?ipbans (empty value) is falsy -> not ipbans');
});

test('priority ladder: an earlier param wins over a later one', () => {
  assert.equal(psRoute('merecat=1&topic=5').tag, 'Merecat');
});

test('the public posting routes: feed and single post', () => {
  assert.equal(psRoute('feed=1').tag, 'Feed', '?feed=1 -> the global feed');
  assert.equal(psRoute('post=42').tag, 'Post');
  assert.equal(psRoute('post=42').s, '42', 'post id rides as a string (JS Number()s it)');
  assert.equal(psRoute('feed=1&topic=9').tag, 'Feed', 'feed beats topic in the ladder');
  assert.equal(psRoute('').tag, 'Index', 'no feed/post param -> not a wall route (absent = null, not truthy)');
});
