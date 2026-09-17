/* The env-flow law, as a function (2026-09-17): where the worker env may go as
   a value. Into a parameter named env (or rawEnv, an entry's unsealed one), or
   tested for truth right before a property read (`env && env.SITE`) — nowhere
   else: not into a row mapper, a spread, a serializer or a log. The
   /api/comments/recent disclosure was `withNames(env, items)`, a call this
   law refuses. Types are stripped by Node's own stripper (positions kept),
   the result parsed with espree (eslint's parser), and each call's callee
   resolved to its definition: the same file first, then the file it was
   imported from, then any file.

   Used by tests/worker/env_leak.test.mjs over every worker file, and by
   tests/worker/sweep_control.test.mjs over planted sources, to prove it
   bites. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import * as espree from 'espree';

export const ENV_PARAMS = new Set(['env', 'rawEnv']);

export function workerFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(ts|js|mjs)$/.test(n) && !n.endsWith('.d.ts')) out.push(f);
    }
  };
  for (const d of ['comments-worker/src', 'contact-worker/src']) walk(join(root, d));
  return out.sort();
}

function parse(file, source) {
  let code = source;
  if (file.endsWith('.ts')) {
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => (String(w).includes('stripTypeScriptTypes') ? undefined : emit.call(process, w, ...rest));
    try { code = stripTypeScriptTypes(code, { mode: 'strip' }); } finally { process.emitWarning = emit; }
  }
  const ast = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', loc: true, range: true });
  const visit = (node, parent, key) => {
    node.parent = parent;
    node.parentKey = key;
    for (const k of Object.keys(node)) {
      if (k === 'parent' || k === 'loc' || k === 'range') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, node, k); }
      else if (v && typeof v.type === 'string') visit(v, node, k);
    }
  };
  visit(ast, null, null);
  return { code, ast };
}
const each = (node, f) => {
  f(node);
  for (const k of Object.keys(node)) {
    if (k === 'parent' || k === 'loc' || k === 'range') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') each(c, f); }
    else if (v && typeof v.type === 'string') each(v, f);
  }
};
const paramName = (p) => (p.type === 'Identifier' ? p.name : p.type === 'AssignmentPattern' ? paramName(p.left) : p.type);
const keyName = (k) => (k && (k.type === 'Identifier' || k.type === 'PrivateIdentifier') ? k.name : k && k.type === 'Literal' ? String(k.value) : null);

/* sources: [{ file (absolute), rel, code }]; exempt: Set of rel; allowed:
   [[rel, RegExp, why]]. Returns { checked, bad: [string], used: Set }. */
export function envFlow(sources, { exempt = new Set(), allowed = [] } = {}) {
  const parsed = new Map(sources.map((s) => [s.file, { rel: s.rel, ...parse(s.file, s.code) }]));
  /* definitions by name, per file; imports per file */
  const defs = new Map();   // file -> Map(name -> [params])
  const imports = new Map();   // file -> Map(local -> { file, name })
  for (const [file, { ast }] of parsed) {
    const d = new Map();
    const add = (name, fn) => { if (name) { if (!d.has(name)) d.set(name, []); d.get(name).push(fn.params.map(paramName)); } };
    const im = new Map();
    each(ast, (n) => {
      if (n.type === 'FunctionDeclaration' && n.id) add(n.id.name, n);
      else if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && /Function/.test(n.init.type)) add(n.id.name, n.init);
      else if ((n.type === 'MethodDefinition' || n.type === 'Property') && n.value && /Function/.test(n.value.type)) add(keyName(n.key), n.value);
      else if (n.type === 'ImportDeclaration' && n.source.value.startsWith('.')) {
        const target = resolve(dirname(file), n.source.value);
        for (const s of n.specifiers) if (s.type === 'ImportSpecifier') im.set(s.local.name, { file: target, name: s.imported.name });
      }
    });
    defs.set(file, d);
    imports.set(file, im);
  }
  const lookup = (file, name) => {
    const own = defs.get(file).get(name);
    if (own) return own;
    const im = imports.get(file).get(name);
    if (im && defs.has(im.file) && defs.get(im.file).get(im.name)) return defs.get(im.file).get(im.name);
    const any = [];
    for (const d of defs.values()) if (d.get(name)) any.push(...d.get(name));
    return any;
  };

  const bad = [];
  const used = new Set();
  let checked = 0;
  for (const [file, { rel, code, ast }] of parsed) {
    if (exempt.has(rel)) continue;
    each(ast, (n) => {
      const isEnvId = n.type === 'Identifier' && ENV_PARAMS.has(n.name);
      const isThisEnv = n.type === 'MemberExpression' && !n.computed && n.object.type === 'ThisExpression' && n.property.name === 'env';
      if (!isEnvId && !isThisEnv) return;
      const p = n.parent;
      const k = n.parentKey;
      if (!p) return;
      if (isEnvId) {
        if (p.type === 'MemberExpression' && k === 'object') return;
        if (p.type === 'MemberExpression' && k === 'property' && !p.computed) return;
        if (/Function/.test(p.type) && k === 'params') return;
        if (p.type === 'AssignmentPattern' && k === 'left') return;
        if (p.type === 'VariableDeclarator' && k === 'id') return;
        if (p.type === 'Property' && k === 'key') return;   // a shorthand is judged once, as its value
        if (p.type === 'Property' && p.parent && p.parent.type === 'ObjectPattern') return;
        if (p.type === 'MethodDefinition' || p.type === 'PropertyDefinition' || /Import|Export/.test(p.type)) return;
      } else {
        if (p.type === 'MemberExpression' && k === 'object') return;   // this.env.X
        if (p.type === 'AssignmentExpression' && k === 'left') return;
      }
      checked++;
      const name = isEnvId ? n.name : 'this.env';
      /* `env && env.X` */
      if (p.type === 'LogicalExpression' && k === 'left' && p.right.type === 'MemberExpression' &&
          code.slice(...p.right.object.range) === code.slice(...n.range)) return;
      if ((p.type === 'CallExpression' || p.type === 'NewExpression') && k === 'arguments') {
        const i = p.arguments.indexOf(n);
        const c = p.callee;
        const callee = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? keyName(c.property) : c.type === 'Super' ? 'super' : null;
        const params = callee ? lookup(file, callee) : [];
        if (params.length && params.every((ps) => ENV_PARAMS.has(ps[i]))) return;
      }
      /* name the use by its statement when the env sits inside a literal */
      let at = p;
      while (at.parent && /^(Property|ObjectExpression|ArrayExpression|SpreadElement)$/.test(at.type)) at = at.parent;
      const snippet = code.slice(...at.range).replace(/\s+/g, ' ').slice(0, 100);
      const allow = allowed.find(([f, re]) => f === rel && re.test(snippet));
      if (allow) { used.add(allow); return; }
      bad.push(`${rel}:${n.loc.start.line} ${name} in: ${snippet}`);
    });
  }
  return { checked, bad, used };
}
