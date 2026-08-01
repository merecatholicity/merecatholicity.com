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
import * as Profile from '../purescript/output/Domain.Profile/index.js';
import * as Faith from '../purescript/output/Domain.Faith/index.js';
import * as Pseudonym from '../purescript/output/Domain.Pseudonym/index.js';
import * as Dm from '../purescript/output/Domain.Dm/index.js';
import * as Access from '../purescript/output/Domain.Access/index.js';
import * as Live from '../purescript/output/Domain.Live/index.js';
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

/* profileLimits: the single source of the profile field caps { nick, bio, sig }
   (a plain PS record). The client profile editors read these for maxLength; the
   worker's MAX_* read the same source in Phase 6. Retires the drift where the
   admin editor capped bio at 1000 while the worker rejects over 500. */
export const profileLimits = Profile.limits;

/* faithLabel(code) -> the display label, or '' for an unrecognized code (the
   client checks truthiness). faiths -> the ordered [{code,label}] the signup
   radios render. Single-sources the FAITH/FAITH_ORDER copy in comments.js. */
export const faithLabel = (code) => Maybe.maybe('')((s) => s)(Faith.labelForCode(code));
export const faiths = Faith.faithList;

/* displayName(hash) -> the "Adjective-Noun xxxx" pseudonym for an identity with
   no nick. Single-sources the ADJ/NOUN wordlists + derivation duplicated in
   comments.js and the worker (Phase 6). Returns a plain string. */
export const displayName = Pseudonym.displayName;

/* DM lifetimes: dmTtlLabel(secs) -> the label ("24 hours"/"7 days"/"30 days"),
   coercing a missing/zero value to the 7-day default as the classic did.
   dmTtlOptions -> the ordered [{secs,label}] chooser. Single-sources the
   DM_TTLS the worker also holds (Phase 6). */
export const dmTtlLabel = (ttl) => Dm.ttlLabel((Number(ttl) || 604800) | 0);
export const dmTtlOptions = Dm.ttlOptions;

/* Post permission predicates (Domain.Access): pure UI authorization over the
   author hash, the viewer's hash, the bot hash, and admin-ness. canInteract =
   DM/mute; canReport = interact & !admin; canEdit = own; canDelete = own|admin.
   Nullish hashes coerce to '' (a keyless viewer). Server authority unchanged. */
export const canInteract = (author, me, bot) => Access.canInteract(author || '')(me || '')(bot || '');
export const canReport = (author, me, bot, isAdmin) => Access.canReport(author || '')(me || '')(bot || '')(!!isAdmin);
export const canEdit = (author, me) => Access.canEdit(author || '')(me || '');
export const canDelete = (author, me, isAdmin) => Access.canDelete(author || '')(me || '')(!!isAdmin);

/* Live-forum pure decisions (Domain.Live). topicCompare(a,b) is the category
   sort comparator (stickies first, then recency) for Array.sort; replyPage
   (total, per) is the 1-based page a reply lands on. The DOM effects stay in
   the views. */
export const topicCompare = (a, b) =>
  Live.topicCompare({ sticky: Number(a.sticky || 0), last: Number(a.last || 0) })({ sticky: Number(b.sticky || 0), last: Number(b.last || 0) });
export const replyPage = (total, per) => Live.replyPage(total | 0)(per | 0);
