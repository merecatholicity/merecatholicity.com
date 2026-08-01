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
import * as Scripture from '../purescript/output/Domain.Scripture/index.js';
import * as Maybe from '../purescript/output/Data.Maybe/index.js';

/* rankFor(n) -> label string. Erases the `Rank` ADT to the label the classic
   docs/comments.js rankFor returns. `n | 0` guarantees the Int the PS side
   expects (post counts are small non-negative integers). */
export const rankFor = (n) => Rank.rankLabel(Rank.rankFor(n | 0));

/* rankLine(n) -> "<label> · <n> post(s)". */
export const rankLine = (n) => Rank.rankLine(n | 0);

/* bibleSrc: the Scripture autolink regex fragment, byte-identical to the former
   richtext.js BIBLE.src (golden-tested), spliced into the inline-markdown regex. */
export const bibleSrc = Scripture.bibleSrc;

/* bookSlug(key) -> canonical KJV slug string, or null. `key` is an already-
   normalized reference (lowercase, whitespace runs collapsed) — the boundary op
   the caller does on the regex match. The PS `Maybe` is erased to `slug | null`
   here, at the one membrane. */
export const bookSlug = (key) => Maybe.maybe(null)((s) => s)(Scripture.bookSlug(key));

/* verseParts(bookKey, ch, v1, v2) -> {slug, ch, v1, v2, href} | null. A VALIDATED
   reference (real book, chapter/verse ≥ 1, ordered range); href is the kjv.html#
   fragment. ch/v1/v2 come from the regex as strings; `| 0` coerces to Int, and a
   missing range end (v2 == null) stays null. PureScript `Nullable` maps straight
   to JS null/value, so no erasure is needed here. */
export const verseParts = (bookKey, ch, v1, v2) =>
  Scripture.verseParts(bookKey)(ch | 0)(v1 | 0)(v2 == null ? null : (v2 | 0));
