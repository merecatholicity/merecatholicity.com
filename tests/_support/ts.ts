/* Running TypeScript source as the build ships it (2026-10-09). A test that
   evaluates a slice of a page script or the service worker (vm.runInContext,
   new Function) hands it through here first: esbuild — the pinned one that
   builds the served bytes — erases the types and changes nothing else. No
   tsconfig is read (the page scripts are classic scripts, and `strict` would
   add a file-wide "use strict" the shipped file does not carry); comments go,
   so slice by a comment anchor BEFORE stripping. */
import { transformSync } from 'esbuild';

export const stripTypes = (src: string): string => transformSync(src, { loader: 'ts', tsconfigRaw: {} }).code;
