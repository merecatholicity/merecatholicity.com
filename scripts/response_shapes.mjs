#!/usr/bin/env node
/* scripts/response_shapes.mjs --write | --check — the committed shape of every
   answer the worker gives (2026-09-17). Runs the leak sweep
   (tests/_support/sweep.mjs), reads every answer into key paths and types
   (tests/_support/shapes.mjs), and writes or checks
   tests/_support/response_shapes.json. A change to what a route answers is a
   reviewable diff of that file: run --write, read the diff, and put a new key
   of a public answer into comments-worker/API.md in the same commit. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runSweep } from '../tests/_support/sweep.mjs';
import { shapeSnapshot, shapeDiff, DYNAMIC } from '../tests/_support/shapes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'tests', '_support', 'response_shapes.json');
const mode = process.argv[2];
if (mode !== '--write' && mode !== '--check') {
  console.error('usage: node scripts/response_shapes.mjs --write | --check');
  process.exit(2);
}
const log = console.log;
console.log = () => {};
const { calls } = await runSweep();
console.log = log;
const got = shapeSnapshot(calls);
if (mode === '--write') {
  /* the maps whose keys are data ride along, for the nightly's Python reader */
  writeFileSync(FILE, JSON.stringify({ _dynamic: DYNAMIC, ...got }, null, 1) + '\n');
  console.log(`response_shapes: ${Object.keys(got).length} routes written to tests/_support/response_shapes.json`);
} else {
  const { _dynamic, ...want } = JSON.parse(readFileSync(FILE, 'utf8'));
  const diff = shapeDiff(want, got);
  if (JSON.stringify(_dynamic) !== JSON.stringify(DYNAMIC)) diff.push('_dynamic: the data-keyed maps changed');
  if (diff.length) {
    console.log(diff.join('\n'));
    console.log(`response_shapes: ${diff.length} difference(s) — review them, then --write`);
    process.exit(1);
  }
  console.log(`response_shapes: ${Object.keys(got).length} routes as committed`);
}
