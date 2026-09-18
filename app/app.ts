/* app/app.ts — the shell's entry point, so esbuild names its output app.js
   while chrome.js (the early bars) rides the same build and shares its chunks
   (2026-09-17). The shell itself is app/shell.ts; this file exists only to
   give the entry the name every page has always loaded. */
import './shell.ts';
