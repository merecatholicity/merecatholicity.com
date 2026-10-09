#!/usr/bin/env node
/* scripts/vendor.ts — the three third-party browser libraries, written into
   docs/ from node_modules (2026-10-09). They were committed into docs/ by hand,
   with no record of where the bytes came from; now package.json pins each one
   (exact versions, in the lockfile, bumped by Dependabot like everything else)
   and this copies it out. They stay standalone classic scripts, injected
   same-origin only when a feature first needs them (script-src 'self' holds,
   and ~200 KB stays off every page that never seals a DM, records a voice note
   or shows a QR code), under the names the client asks `window.mcAsset` for:

     tweetnacl.min.js  tweetnacl's own nacl.min.js (Unlicense) — global `nacl`
     lamejs.min.js     @breezystack/lamejs's IIFE build (LGPL-3.0) — global
                       `lamejs`; never bundled into app.js, so the LGPL library
                       stays a separate, replaceable file
     qr.min.js         qrcode-generator's dist/qrcode.js (MIT), minified here — the
                       package ships no minified build; global `qrcode`

   A file is rewritten only when its bytes change, so a rebuild leaves its
   mtime alone. `npm run build:js` runs this before scripts/stamp_versions.py
   keys the three by content hash. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = (p: string): string => readFileSync(join(root, 'node_modules', p), 'utf8');

const LAME_HEAD = `/*!
 * lamejs — Pure JavaScript MP3 encoder (@breezystack/lamejs, IIFE build)
 * Upstream: https://www.npmjs.com/package/@breezystack/lamejs
 * License: LGPL-3.0 (see the package LICENSE; LAME itself is LGPL).
 * Served as a standalone classic script and deliberately NOT bundled into
 * app.js, so the library remains replaceable. Unmodified below this header.
 */
`;

export const VENDORED: Record<string, () => string> = {
  'tweetnacl.min.js': () => pkg('tweetnacl/nacl.min.js'),
  'lamejs.min.js': () => LAME_HEAD + pkg('@breezystack/lamejs/dist/lamejs.iife.js'),
  'qr.min.js': () => transformSync(pkg('qrcode-generator/dist/qrcode.js'), { minify: true, tsconfigRaw: {} }).code,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, make] of Object.entries(VENDORED)) {
    const out = join(root, 'docs', name);
    const bytes = make();
    if (!existsSync(out) || readFileSync(out, 'utf8') !== bytes) writeFileSync(out, bytes);
  }
}
