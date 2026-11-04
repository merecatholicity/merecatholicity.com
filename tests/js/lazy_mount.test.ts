/* One mount per route (app/lazyviews.ts, 2026-11-04).
 *
 * Live on the day: an admin opened a thread and saw it twice. There were two
 * heads, two opening posts and two reply forms, and the fingerprint drawer sat
 * on the first copy only. A refresh repeated it; leaving the thread and coming
 * back cured it. The admin activity audit doubled the same way.
 *
 * The topic view is one of the four lazy view modules, so its first mount on a
 * page waits for a chunk, and the router ran twice inside that wait: every
 * admin's boot redrew the board when the profile landed (the pre-load hint
 * never matched; tests/js/identity_two_names.test.ts holds that half). Each
 * run cleared the section and called the stub, and when the chunk arrived both
 * calls mounted. The classic client's lazyView doubled even with its module
 * installed, because an installed module still answers a microtask late, after
 * the redraw.
 *
 * The rule held here: a late mount ends as an immediate one would have. Each
 * call holds its section with a mark, a route that clears the section takes
 * the mark with it, and the call that lost its mark stands down. The stubs are
 * RUN below over a fake DOM of the four operations they use; the classic road
 * takes the same hold through window.mcHoldSection, and the textual test at
 * the end keeps it on it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installLazyViews, holdSection } from '../../app/lazyviews.ts';
import { clientRoot } from '../_support/client.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* appendChild, remove, parentNode, and the clear every route starts with
   (`section.textContent = ''`). Nothing else is touched. */
class FakeNode {
  name: string;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  constructor(name: string) { this.name = name; }
  appendChild(n: FakeNode) {
    n.remove();
    this.childNodes.push(n);
    n.parentNode = this;
    return n;
  }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.childNodes.splice(p.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  clear() { for (const n of [...this.childNodes]) n.remove(); }
  names() { return this.childNodes.map((n) => n.name); }
}
const doc = { createComment: () => new FakeNode('#comment') } as unknown as Pick<Document, 'createComment'>;

/* A topic chunk that lands when told to, registering its real view as the
   module's evaluation does. */
function topicChunk() {
  let land!: () => void;
  const arrived = new Promise<void>((r) => { land = r; });
  const views: Record<string, (...a: any[]) => any> = {};
  const mounts: number[] = [];
  installLazyViews(views, {
    topic: () => arrived.then(() => {
      views.topic = (section: FakeNode, _kit: unknown, id: number) => {
        section.appendChild(new FakeNode('mc-topic'));
        mounts.push(id);
      };
    }),
  }, doc);
  return { views, mounts, land };
}

test('the router runs again while the chunk is in flight: the thread mounts once', async () => {
  const { views, mounts, land } = topicChunk();
  const section = new FakeNode('section');
  const first = views.topic(section, {}, 227);    // the boot's route
  section.clear();                                // the profile lands: route() clears…
  const second = views.topic(section, {}, 227);   // …and calls again
  land();
  await Promise.all([first, second]);
  assert.deepEqual(mounts, [227], 'one mount, for the route that still owns the section');
  assert.deepEqual(section.names(), ['mc-topic'], 'no second copy, and no mark left behind');
});

test('a call nothing supersedes mounts when the chunk lands, as before', async () => {
  const { views, mounts, land } = topicChunk();
  const section = new FakeNode('section');
  const call = views.topic(section, {}, 9);
  land();
  await call;
  assert.deepEqual(mounts, [9]);
  assert.deepEqual(section.names(), ['mc-topic']);
});

test('a route that draws something else in the meantime keeps its screen', async () => {
  const { views, mounts, land } = topicChunk();
  const section = new FakeNode('section');
  const stale = views.topic(section, {}, 227);
  section.clear();                                // a newer route, and an eager view
  section.appendChild(new FakeNode('mc-board-index'));
  land();
  await stale;
  assert.deepEqual(mounts, [], 'the topic stands down');
  assert.deepEqual(section.names(), ['mc-board-index']);
});

test('while it waits, the section holds only a comment, so the CSS loading ring still shows', () => {
  /* styles/main.css paints the ring on section.comments.board:empty, and
     :empty ignores comment nodes. An element as the mark would hide the ring
     for exactly the wait it exists for. */
  const { views } = topicChunk();
  const section = new FakeNode('section');
  views.topic(section, {}, 1);
  assert.deepEqual(section.names(), ['#comment']);
});

test('the answer is given once per hold, and lets the hold go either way', () => {
  const kept = new FakeNode('section');
  const keep = holdSection(kept, doc);
  assert.equal(keep(), true);
  assert.deepEqual(kept.names(), []);
  const lost = new FakeNode('section');
  const lose = holdSection(lost, doc);
  lost.clear();
  lost.appendChild(new FakeNode('p'));
  assert.equal(lose(), false);
  assert.deepEqual(lost.names(), ['p']);
  assert.equal(holdSection(null, doc)(), true, 'no section, nothing to lose');
});

test('the classic lazyView takes the same hold, from the shell', () => {
  /* lazyView lives inside the boot closure, so it cannot be run here. It must
     take its hold before the chunk wait and test it before rendering, and the
     shell must be what hands the hold over (client/ may not import app/). */
  const src = clientRoot();
  const at = src.indexOf('function lazyView(');
  assert.ok(at !== -1, 'client/comments.ts defines lazyView');
  const body = src.slice(at, src.indexOf('\n  }\n', at));
  const hold = body.indexOf('window.mcHoldSection!(section)');
  assert.ok(hold !== -1, 'lazyView holds its section');
  assert.ok(hold < body.indexOf('B.ensure('), 'the hold is taken before the chunk wait');
  assert.match(body, /if \(!held\(\) \|\|/, 'a render whose section was cleared stands down');
  const shell = readFileSync(join(root, 'app', 'shell.ts'), 'utf8');
  assert.match(shell, /window\.mcHoldSection = function \(section\) \{ return holdSection\(section, document\); \};/);
  assert.match(shell, /installLazyViews\(window\.mcViews, LAZY_VIEWS, document\);/);
});
