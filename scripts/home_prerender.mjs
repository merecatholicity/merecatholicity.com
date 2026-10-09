#!/usr/bin/env node
/* scripts/home_prerender.mjs --write | --check — the Home launcher, written into
   docs/index.html (2026-10-08). app/home.ts holds the launcher's one structure;
   this writes its HTML as the first child of the page's <main>, so the launcher
   paints with the stylesheet instead of after the app's script (see the head of
   app/home.ts). docs/index.html is a hand page, so the result is committed;
   --check, and tests/js/home_prerender.test.mjs, fail when it is stale. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homeTree, toHtml } from '../app/home.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'docs', 'index.html');
const MAIN = '<main class="prose">';
const BLOCK = /\n?<mc-home>[\s\S]*?<\/mc-home>/;

export function prerendered(page) {
  const block = '\n<mc-home>' + toHtml(homeTree()) + '</mc-home>';
  const bare = page.replace(BLOCK, '');
  const at = bare.indexOf(MAIN);
  if (at < 0) throw new Error('docs/index.html has no ' + MAIN);
  return bare.slice(0, at + MAIN.length) + block + bare.slice(at + MAIN.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    console.error('usage: node scripts/home_prerender.mjs --write | --check');
    process.exit(2);
  }
  const page = readFileSync(FILE, 'utf8');
  const want = prerendered(page);
  if (mode === '--write') {
    if (want !== page) writeFileSync(FILE, want);
    console.log('home_prerender: docs/index.html ' + (want === page ? 'already current' : 'written'));
  } else if (want !== page) {
    console.error('home_prerender: docs/index.html is stale — run node scripts/home_prerender.mjs --write');
    process.exit(1);
  }
}
