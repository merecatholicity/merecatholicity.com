/* app/core.js — the ONE bridge between the PureScript domain layer
   (purescript/output/, compiled by `make psbuild`) and the JavaScript UI.

   This file is the TRANSLATION MEMBRANE. PureScript values that don't cross a
   language boundary cleanly — ADTs, Maybe, Either — are erased HERE to the
   plain JS the classic docs/comments.js path and the Lit views expect:
     Maybe a      -> a | null
     Either e a   -> { ok:true, value } | { ok:false, error }
     data T = …   -> a discriminant string, or the already-rendered value
   Nothing exported from this file returns a raw PureScript constructor. Keep it
   tiny and audited; type safety lives inside PureScript, not here. See CLAUDE.md.
   The bundle exposes this as window.mcCore (app/shell.js), which
   the un-bundled docs/comments.js delegates to via `if (window.mcCore) …`. */

import * as Rank from '../purescript/output/Domain.Rank/index.js';
import * as Scripture from '../purescript/output/Domain.Scripture/index.js';
import * as Profile from '../purescript/output/Domain.Profile/index.js';
import * as Faith from '../purescript/output/Domain.Faith/index.js';
import * as Pseudonym from '../purescript/output/Domain.Pseudonym/index.js';
import * as Dm from '../purescript/output/Domain.Dm/index.js';
import * as Access from '../purescript/output/Domain.Access/index.js';
import * as Live from '../purescript/output/Domain.Live/index.js';
import * as Pager from '../purescript/output/Domain.Pager/index.js';
import * as Board from '../purescript/output/Domain.Board/index.js';
import * as Emoji from '../purescript/output/Domain.Emoji/index.js';
import * as Route from '../purescript/output/Domain.Route/index.js';
import * as Auth from '../purescript/output/Domain.Auth/index.js';
import * as Mute from '../purescript/output/Domain.Mute/index.js';
import * as Blocked from '../purescript/output/Domain.Blocked/index.js';
import * as Compose from '../purescript/output/Domain.Compose/index.js';
import * as Handle from '../purescript/output/Domain.Handle/index.js';
import * as Links from '../purescript/output/Domain.Links/index.js';
import * as Maybe from '../purescript/output/Data.Maybe/index.js';

/* rankFor(n) -> label string. Erases the `Rank` ADT to the label the classic
   docs/comments.js rankFor returns. `n | 0` guarantees the Int the PS side
   expects (post counts are small non-negative integers). */
export const rankFor = (n: number): string => Rank.rankLabel(Rank.rankFor(n | 0));

/* rankLine(n) -> "<label> · <n> post(s)". */
export const rankLine = (n: number): string => Rank.rankLine(n | 0);

/* bibleSrc: the Scripture autolink regex fragment, byte-identical to the former
   richtext.js BIBLE.src (golden-tested), spliced into the inline-markdown regex. */
export const bibleSrc = Scripture.bibleSrc;

/* bookSlug(key) -> canonical KJV slug string, or null. `key` is an already-
   normalized reference (lowercase, whitespace runs collapsed) — the boundary op
   the caller does on the regex match. The PS `Maybe` is erased to `slug | null`
   here, at the one membrane. */
export const bookSlug = (key: string): string | null => Maybe.maybe(null)((s: string) => s)(Scripture.bookSlug(key));

/* verseParts(bookKey, ch, v1, v2) -> {slug, ch, v1, v2, href} | null. A VALIDATED
   reference (real book, chapter/verse ≥ 1, ordered range); href is the kjv.html#
   fragment. ch/v1/v2 come from the regex as strings; `| 0` coerces to Int, and a
   missing range end (v2 == null) stays null. PureScript `Nullable` maps straight
   to JS null/value, so no erasure is needed here. */
export const verseParts = (bookKey: string, ch: number | string, v1: number | string, v2?: number | string | null):
  { slug: string; ch: number; v1: number; v2: number; href: string } | null =>
  Scripture.verseParts(bookKey)((ch as number) | 0)((v1 as number) | 0)(v2 == null ? null : ((v2 as number) | 0));

/* profileLimits: the single source of the profile field caps { nick, bio, sig }
   (a plain PS record). The client profile editors read these for maxLength; the
   worker's MAX_* read the same source in Phase 6. Retires the drift where the
   admin editor capped bio at 1000 while the worker rejects over 500. */
export const profileLimits = Profile.limits;

/* handleValidate(raw) -> { ok, handle, error }: the custom @handle format rules
   (Domain.Handle), single-sourced with the worker. `ok` true carries the
   normalized (lower-cased) handle; false carries a discriminant error tag
   ('too_short'|'too_long'|'bad_chars'|'bad_start'|'bad_underscore'|'reserved').
   Already a plain record (erased inside PureScript), so no further work here.
   handleMax is the max length for the input's maxLength. */
export const handleValidate = (raw: string): { ok: boolean; handle: string; error: string } => Handle.validate(String(raw == null ? '' : raw));
export const handleMax = Handle.maxLen;

/* linkNormalize(platform, raw) -> { ok, url, error }: sanitize/normalize one
   offsite profile link (website/x/facebook/instagram/tiktok) to a safe https URL,
   single-sourced with the worker (Domain.Links). Already a plain record. */
export const linkNormalize = (platform: string, raw: string) => Links.normalize(String(platform == null ? '' : platform))(String(raw == null ? '' : raw));
export const linkPlatforms = Links.platforms;

/* faithLabel(code) -> the display label, or '' for an unrecognized code (the
   client checks truthiness). faiths -> the ordered [{code,label}] the signup
   radios render. Single-sources the FAITH/FAITH_ORDER copy in comments.js. */
export const faithLabel = (code: string): string => Maybe.maybe('')((s: string) => s)(Faith.labelForCode(code));
export const faiths = Faith.faithList;

/* displayName(hash) -> the "Adjective-Noun xxxx" pseudonym for an identity with
   no nick. Single-sources the ADJ/NOUN wordlists + derivation duplicated in
   comments.js and the worker (Phase 6). Returns a plain string. */
export const displayName = Pseudonym.displayName;

/* DM lifetimes: dmTtlLabel(secs) -> the label ("24 hours"/"7 days"/"30 days"),
   coercing a missing/zero value to the 7-day default as the classic did.
   dmTtlOptions -> the ordered [{secs,label}] chooser. Single-sources the
   DM_TTLS the worker also holds (Phase 6). */
export const dmTtlLabel = (ttl: number | string): string => Dm.ttlLabel((Number(ttl) || Dm.defaultTtl) | 0);
export const dmTtlOptions = Dm.ttlOptions;

/* Post permission predicates (Domain.Access): pure UI authorization over the
   author hash, the viewer's hash, the bot hash, and admin-ness. canInteract =
   DM/mute; canReport = interact & !admin; canEdit = own; canDelete = own|admin.
   Nullish hashes coerce to '' (a keyless viewer). Server authority unchanged. */
export const canInteract = (author: string, me: string, bot: string): boolean => Access.canInteract(author || '')(me || '')(bot || '');
export const canReport = (author: string, me: string, bot: string, isAdmin: boolean): boolean => Access.canReport(author || '')(me || '')(bot || '')(!!isAdmin);
export const canEdit = (author: string, me: string): boolean => Access.canEdit(author || '')(me || '');
export const canDelete = (author: string, me: string, isAdmin: boolean): boolean => Access.canDelete(author || '')(me || '')(!!isAdmin);

/* Live-forum pure decisions (Domain.Live). topicCompare(a,b) is the category
   sort comparator (stickies first, then recency) for Array.sort; replyPage
   (total, per) is the 1-based page a reply lands on. The DOM effects stay in
   the views. */
export const topicCompare = (a: { sticky?: number; last?: number }, b: { sticky?: number; last?: number }): number =>
  Live.topicCompare({ sticky: Number(a.sticky || 0), last: Number(a.last || 0) })({ sticky: Number(b.sticky || 0), last: Number(b.last || 0) });
export const replyPage = (total: number, per: number): number => Live.replyPage(total | 0)(per | 0);

/* pagerItems(total, per, active) -> the page-bar window as plain cells
   [{gap, n, active}]: page 1, the last page, the active page's neighbours, with
   one-page gaps filled and wider gaps an ellipsis; [] for a single page. Single-
   sources the windowing the util.js href pager and the member.js button pager
   both computed. The cells are already plain records, so no erasure. */
export const pagerItems = (total: number, per: number, active: number): Array<{ gap: boolean; n: number; active: boolean }> => Pager.pagerItems(total | 0)(per | 0)(active | 0);

/* Board categories (Domain.Board), single-sourced with the worker. boardCatRows
   = the display rows [key,label,blurb,(linkText,linkHref)] the client CATS held;
   boardCatKeys = the key order (the worker's BOARD_CATS); adminCat = the back
   room's board key. Already plain arrays/string, so no erasure. */
export const boardCatRows = Board.catRows;
export const boardCatKeys = Board.catKeys;
export const adminCat = Board.adminCat;

/* Emoji data (Domain.Emoji), single-sourced with the worker's /config copy.
   emojiPacks = { memes:[[code,path]…], pepe:[…] } (the image packs); the
   standard ~250-emoji set stays client-only. emojiNamedTokens = the space-
   separated "name emoji …" alias source the client pairs into NAMED_EMOJI.
   Both already plain, so no erasure. */
export const emojiPacks = Emoji.packs;
export const emojiNamedTokens = Emoji.namedTokens;

/* parseRoute(get) -> {tag, s, n}: the forum's URL→view decision (Domain.Route),
   the priority ladder comments.js route() ran. `get` is URLSearchParams.get
   (name -> string|null). The `topic` param's Number()+isInteger coercion runs
   HERE at the JS boundary (those quirks belong in JS); the id or null is passed
   in, and PS decides the route. The ADT is erased to {tag, s, n} inside PS. */
export const parseRoute = (get: (k: string) => string | null): { tag: string; s: string; n: number } => {
  const topicRaw = get('topic');
  const topicNum = Number(topicRaw);
  const topic = (topicRaw != null && Number.isInteger(topicNum) && topicNum > 0) ? topicNum : null;
  return Route.routeTag(Route.parseRoute({
    ipbans: get('ipbans'), settings: get('settings'), admins: get('admins'),
    admin: get('admin'), discord: get('discord'), shadowbans: get('shadowbans'), merecatadmin: get('merecatadmin'), merecatthread: get('merecatthread'),
    merecatthreads: get('merecatthreads'), merecat: get('merecat'), feed: get('feed'),
    notifications: get('notifications'), inbox: get('inbox'), users: get('users'), q: get('q'),
    dm: get('dm'), me: get('me'), profile: get('profile'), post: get('post'),
    audit: get('audit'), topic, cat: get('cat'),
  }));
};

/* Auth classification (Domain.Auth): the reader's identity state as one typed
   decision. authIsAdmin(sig) is the isAdmin() logic (server authority once the
   profile loads, else server-or-hint); authIsMember(sig) is key && hash;
   authGate(sig) -> "pass"|"deny"|"wait" is the admin-page guard. `sig` carries
   the raw state signals; each is coerced to Boolean at this membrane. */
const authSignals = (s: Record<string, unknown>) => ({
  hasKey: !!s.hasKey, hasHash: !!s.hasHash, profileLoaded: !!s.profileLoaded,
  myAdmin: !!s.myAdmin, hint: !!s.hint,
});
export const authIsAdmin = (s: Record<string, unknown>): boolean => Auth.isAdmin(authSignals(s));
export const authIsMember = (s: Record<string, unknown>): boolean => Auth.isMember(authSignals(s));
export const authGate = (s: Record<string, unknown>): string => Auth.gate(authSignals(s));

/* Mute (Domain.Mute): a client-only list of hashes whose posts collapse for this
   reader. isMuted(bot, hash, list) is bot-exempt non-empty membership;
   toggleMute(hash, list) -> {list, added} for the caller to persist. */
export const isMuted = (bot: string, hash: string, list: string[]): boolean => Mute.isMuted(bot || '')(hash || '')(list || []);
export const toggleMute = (hash: string, list: string[]): { list: string[]; added: boolean } => Mute.toggleMute(hash || '')(list || []);

/* blockedMessage(reason): the flash-banner string for a moderation-block code
   (Domain.Blocked; 'ipban' -> network-banned, else identity-locked). */
export const blockedMessage = (reason: string): string => Blocked.messageFor(reason || '');

/* mentionsIn(text, picks) -> the mention hashes to send: the @-picks whose token
   still stands in the body, deduped, in order (Domain.Compose; collectMentions).
   `picks` is [{token, hash}]. Returns a plain string array. */
export const mentionsIn = (text: string, picks: Array<{ token: string; hash: string }>): string[] => Compose.mentionsIn(text || '')(picks || []);
