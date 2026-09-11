/* The classic client's module wiring (Wave F, 2026-09-11).
 *
 * client/comments.ts is the boot; client/<feature>.ts are install<Feature>(B)
 * factories. Each declares the names it takes from elsewhere as `let` bindings
 * filled by bind() from the boot object B once every module is installed, and
 * runs its former top-level effects in run(). tsc cannot see the failures this
 * shape makes possible, because every use sits inside a closure:
 *  - a binding declared but never filled in bind() — undefined at its first
 *    use, in one handler, on one page;
 *  - a name bound from B that nothing provides (no root helper, no export);
 *  - a module-level `var` whose initializer calls a binding — it runs at
 *    install, before bind(), and throws on every page;
 *  - a copied binding of state more than one module writes (B.quotedSelection
 *    and friends) — the copies diverge and the reply quote, the mention
 *    directory or the badge timer stop agreeing;
 *  - a module left out of the root's install list, or two modules exporting
 *    one name (the later install wins, silently).
 * Every check reads the sources; nothing runs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_MODULES, clientModule, clientRoot } from '../_support/client.mjs';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const ident = /[A-Za-z_$][\w$]*/;

/* the contiguous `  let NAME: …;` run after a start line (comments and blanks skipped) */
function headerLets(src, startRe) {
  const lines = strip(src).split('\n');
  const out = [];
  let i = lines.findIndex((l) => startRe.test(l));
  assert.ok(i >= 0, `no line matches ${startRe}`);
  for (i += 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('//')) continue;
    const m = l.match(/^  let ([A-Za-z_$][\w$]*)\s*:/);
    if (m) out.push(m[1]); else break;
  }
  return out;
}
/* `NAME = B.NAME;` lines inside bind() */
function bindAssigns(src) {
  const i = src.indexOf('\n  function bind() {');
  assert.ok(i > 0, 'a bind() at the factory level');
  const body = src.slice(i, src.indexOf('\n  }', i));
  return [...body.matchAll(/^\s+([A-Za-z_$][\w$]*) = B\.([A-Za-z_$][\w$]*);/gm)].map((m) => [m[1], m[2]]);
}
function exportList(src) {
  const m = src.match(/return \{ bind, run, exports: \{([^}]*)\} \};/);
  assert.ok(m, 'the factory returns { bind, run, exports: { … } }');
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}
/* names a file declares at the factory / boot level: functions and vars
   (a `var a = 0, b = 0;` declares both — one extra name per line is enough here) */
function declared(src) {
  const s = strip(src);
  return new Set([
    ...[...s.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/gm)].map((m) => m[1]),
    ...[...s.matchAll(/^  var ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ...[...s.matchAll(/^  var [^;\n]*?,\s*([A-Za-z_$][\w$]*)\s*[=;:]/gm)].map((m) => m[1]),
  ]);
}

const root = clientRoot();
const modules = Object.fromEntries(CLIENT_MODULES.map((n) => [n, clientModule(n)]));
const rootProviders = (() => {
  const m = root.match(/Object\.assign\(B, \{([^}]*)\}\);/);
  assert.ok(m, 'the root lands its helpers on B in one Object.assign');
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
})();
const exportsOf = Object.fromEntries(CLIENT_MODULES.map((n) => [n, exportList(modules[n])]));
const providers = new Set([...rootProviders, ...Object.values(exportsOf).flat()]);

test('the root installs every module, in the documented order, and each module is a factory', () => {
  const order = root.match(/const mods = \[([^\]]*)\];/);
  assert.ok(order, 'the install list');
  assert.deepEqual(order[1].split(',').map((s) => s.trim()), CLIENT_MODULES.map((n) => `install${cap(n)}(B)`),
    'the install list is CLIENT_MODULES in order');
  for (const n of CLIENT_MODULES) {
    assert.ok(root.includes(`import { install${cap(n)} } from './${n}';`), `the root imports install${cap(n)}`);
    assert.ok(modules[n].includes(`export function install${cap(n)}(B: Boot) {`), `${n}.ts exports its factory`);
    assert.ok(/\n  function run\(\) \{/.test(modules[n]), `${n}.ts has a run()`);
  }
  assert.ok(root.includes('for (const m of mods) Object.assign(B, m.exports);'), 'every export lands on B before any bind');
  const bindAt = root.indexOf('for (const m of mods) m.bind();');
  const runAt = root.indexOf('for (const m of mods) m.run();');
  assert.ok(bindAt > 0 && runAt > bindAt, 'all modules bind before any runs');
});

test('every binding a module declares is filled by bind() from B under its own name — and nothing else is', () => {
  for (const n of CLIENT_MODULES) {
    const lets = headerLets(modules[n], /^export function install/);
    const binds = bindAssigns(modules[n]);
    assert.ok(lets.length > 0, `${n}: header bindings found`);
    assert.deepEqual(binds.filter((b) => b[0] !== b[1]), [], `${n}: a binding keeps the name it has on B`);
    assert.deepEqual([...lets].sort(), binds.map((b) => b[0]).sort(), `${n}: the header and bind() name the same set`);
  }
  const rootLets = headerLets(root, /^  const B: Boot = /);
  const rootAssigns = [...root.matchAll(/^  ([A-Za-z_$][\w$]*) = B\.([A-Za-z_$][\w$]*);/gm)].map((m) => [m[1], m[2]]);
  assert.ok(rootLets.length > 0, 'the root binds its late names too');
  assert.deepEqual(rootAssigns.filter((b) => b[0] !== b[1]), [], 'root: same names');
  assert.deepEqual([...rootLets].sort(), rootAssigns.map((b) => b[0]).sort(), 'root: the header and the assignments name the same set');
});

test('every bound name has one provider: a root helper or a module export; no export is declared twice or shadows a helper', () => {
  for (const n of CLIENT_MODULES) {
    const unprovided = bindAssigns(modules[n]).map((b) => b[1]).filter((name) => !providers.has(name));
    assert.deepEqual(unprovided, [], `${n}: every bound name is provided`);
  }
  const rootUnprovided = [...root.matchAll(/^  [A-Za-z_$][\w$]* = B\.([A-Za-z_$][\w$]*);/gm)].map((m) => m[1]).filter((name) => !providers.has(name));
  assert.deepEqual(rootUnprovided, [], 'root: every bound name is provided');
  const seen = new Map();
  for (const n of CLIENT_MODULES) {
    const decl = declared(modules[n]);
    for (const e of exportsOf[n]) {
      assert.ok(decl.has(e), `${n} exports ${e}, which it declares`);
      assert.ok(!seen.has(e), `${e} is exported by ${seen.get(e)} and ${n}`);
      assert.ok(!rootProviders.includes(e), `${n} exports ${e}, which the root already provides`);
      seen.set(e, n);
    }
  }
});

test('a module-level var never touches a binding in its initializer (it is not bound at install)', () => {
  for (const n of CLIENT_MODULES) {
    const lets = headerLets(modules[n], /^export function install/);
    const lines = strip(modules[n]).split('\n');
    const balance = (t) => (t.match(/[([{]/g) || []).length - (t.match(/[)\]}]/g) || []).length;
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^  var /.test(lines[i])) continue;
      let text = lines[i];
      for (let j = i; j + 1 < lines.length && !(balance(text) <= 0 && /;\s*$/.test(text)); j++) text += '\n' + lines[j + 1];
      for (const name of lets) {
        if (new RegExp('(?<![\\w$.\'"])' + name.replace(/\$/g, '\\$') + '(?![\\w$:])').test(text)) hits.push(`${name} in var at line ${i + 1}`);
      }
    }
    assert.deepEqual(hits, [], `${n}: a var initializer that needs a binding belongs in run()`);
  }
});

test('state more than one module writes lives on B alone — never a copied binding', () => {
  const files = { comments: root, ...modules };
  const shared = new Set();
  for (const src of Object.values(files)) for (const m of src.matchAll(/\bB\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) shared.add(m[1]);
  for (const name of ['quotedSelection', 'mentionDir', 'notifBadgeT', 'profileWaiters', 'COMMENTS_KEY', 'COMMENTS_HREF']) {
    assert.ok(shared.has(name), `${name} is written through B`);
  }
  for (const [f, src] of Object.entries(files)) {
    const lets = headerLets(src, f === 'comments' ? /^  const B: Boot = / : /^export function install/);
    const decl = declared(src);
    const copies = [...shared].filter((name) => lets.includes(name) || decl.has(name));
    assert.deepEqual(copies, [], `${f}.ts holds no local copy of shared state`);
    assert.ok(!new RegExp('^  let (?:' + [...shared].join('|') + ')\\b', 'm').test(strip(src)), `${f}.ts declares no let for shared state`);
  }
  assert.ok(!/\bexports: \{[^}]*\b(?:quotedSelection|mentionDir|notifBadgeT|profileWaiters)\b/.test(Object.values(modules).join('\n')), 'shared state is never exported as a value');
});
