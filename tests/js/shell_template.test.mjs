/* The shell paints platform pages from a LOCAL template so a tap lands
 * instantly, with no network at all (app/shell.ts PLATFORM_PAGES + instantMain).
 * That is only honest while the served documents really are the same thin shell
 * differing in one string. If someone edits docs/community.html — adds a banner,
 * renames the heading, changes the section — the shell would keep painting the
 * old shape for a beat before the reconcile, and nothing would say so.
 *
 * So: assert the table against the actual served files. A drift fails HERE,
 * loudly, at build time, instead of as a flicker nobody can reproduce. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shellSrc = readFileSync(join(root, 'app', 'shell.ts'), 'utf8');

/* Parse the table out of the source rather than duplicating it here — a test
   that keeps its own copy of the thing under test guards nothing. */
function shellTable() {
  const block = shellSrc.slice(
    shellSrc.indexOf('var PLATFORM_PAGES'),
    shellSrc.indexOf('function platformPage'),
  );
  const out = {};
  for (const m of block.matchAll(
    /'([a-z-]+\.html)':\s*\{\s*h1:\s*'([^']*)',\s*title:\s*'([^']*)'\s*\}/g)) {
    out[m[1]] = { h1: m[2], title: m[3] };
  }
  return out;
}

const TABLE = shellTable();

test('the table was actually found (anti-vacuum guard)', () => {
  assert.ok(Object.keys(TABLE).length >= 5,
    `parsed only ${Object.keys(TABLE).length} entries — has PLATFORM_PAGES moved or changed shape?`);
});

test('every templated page still serves the h1 and title the shell paints', () => {
  for (const [page, want] of Object.entries(TABLE)) {
    const html = readFileSync(join(root, 'docs', page), 'utf8');
    const h1 = /<h1 class="home-title"[^>]*>([^<]*)<\/h1>/.exec(html);
    assert.ok(h1, `${page}: no <h1 class="home-title"> — the template would paint a heading the page does not have`);
    assert.equal(h1[1], want.h1, `${page}: served <h1> drifted from the shell's template`);
    const title = /<title>([^<]*)<\/title>/.exec(html);
    assert.ok(title, `${page}: no <title>`);
    assert.equal(title[1], want.title, `${page}: served <title> drifted from the shell's template`);
  }
});

test('every templated page is still the same empty thin shell', () => {
  for (const page of Object.keys(TABLE)) {
    const html = readFileSync(join(root, 'docs', page), 'utf8');
    /* The exact element the template builds, and EMPTY — the client fills it.
       If a page ever ships server-rendered content inside it, the local
       template would blank that content on every soft nav. */
    assert.ok(html.includes('<section class="comments board" data-board></section>'),
      `${page}: the board section is no longer the empty '<section class="comments board" data-board>' the template builds`);
    assert.ok(/<main class="prose">/.test(html), `${page}: <main class="prose"> changed`);
    /* One script, and it is the client the shell boots by name. */
    assert.ok(/<script defer src="comments\.js\?v=\d+"><\/script>/.test(html),
      `${page}: no comments.js script tag — bootLoaded() would have nothing to boot`);
  }
});

test('the instant path only runs where the client is already loaded', () => {
  /* The guard that keeps a first-hop-from-Home honest: index.html loads
     index.js, not comments.js, so painting a local platform page there would
     leave an empty shell until the document arrived anyway. */
  assert.ok(shellSrc.includes("if (platformPage(url.pathname) && loadedScripts['comments.js'])"),
    'the instant swap must be gated on comments.js already being loaded');
  const idx = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
  assert.ok(!/comments\.js/.test(idx),
    'index.html now loads comments.js — the gate above is no longer exercised; re-check the first-hop path');
});

test('a locally painted page pushes history itself, and only when painted', () => {
  /* A document-driven navigation must NOT push before it paints, or a hop that
     never rendered would still leave a back-button entry. */
  const soft = shellSrc.slice(shellSrc.indexOf('function softNav'));
  const pushes = (soft.match(/history\.pushState/g) || []).length;
  assert.equal(pushes, 2,
    'expected exactly two pushState sites in softNav: the instant paint and the document swap');
});
