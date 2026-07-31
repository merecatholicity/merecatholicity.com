/* app/core.js — the ONE bridge between the PureScript domain layer
   (purescript/output/, compiled by `make psbuild`) and the JavaScript UI.

   This file is the TRANSLATION MEMBRANE. PureScript values that don't cross a
   language boundary cleanly — ADTs, Maybe, Either — are erased HERE to the
   plain JS the classic docs/comments.js path and the Lit views expect:
     Maybe a      -> a | null
     Either e a   -> { ok:true, value } | { ok:false, error }
     data T = …   -> a discriminant string, or the already-rendered value
   Nothing exported from this file returns a raw PureScript constructor. Keep it
   tiny and audited; type safety lives inside PureScript, not here. See
   PURESCRIPT.md. The bundle exposes this as window.mcCore (app/shell.js), which
   the un-bundled docs/comments.js delegates to via `if (window.mcCore) …`. */

import * as Rank from '../purescript/output/Domain.Rank/index.js';

/* rankFor(n) -> label string. Erases the `Rank` ADT to the label the classic
   docs/comments.js rankFor returns. `n | 0` guarantees the Int the PS side
   expects (post counts are small non-negative integers). */
export const rankFor = (n) => Rank.rankLabel(Rank.rankFor(n | 0));

/* rankLine(n) -> "<label> · <n> post(s)". */
export const rankLine = (n) => Rank.rankLine(n | 0);
