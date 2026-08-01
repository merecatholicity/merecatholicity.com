================================================================================
 MERE CATHOLICITY — FRONT-END / UX REVIEW
 Desktop + mobile, light + dark. Live site (merecatholicity.com), 2026-08-01.
================================================================================

METHOD & SCOPE
--------------
- 50 screenshots captured of the LIVE site across 15 surfaces at two viewports
  (mobile 402px @2x, desktop 1440px) in light and dark themes, driving the
  real app-shell (sidebar/deskbar/tab-bar/home-launcher all booted).
- 10 expert reviewers, one per UI dimension (desktop layout, mobile chrome,
  colour/dark-mode, typography, components, forum UX, onboarding, reading prose,
  accessibility, contact/book/footer), each grounded in the screenshots + the
  CSS/JS source (styles/main.css, app/appchrome.js, docs/comments.js).
- Every finding independently VERIFIED against the screenshot and the CSS by a
  separate skeptic agent; a completeness critic then swept for system-level
  issues the per-dimension pass missed.
- 59 agents, 0 errors. 48 findings survived verification (30 confirmed,
  18 downgraded); 5 system-level items added; 1 candidate HIGH rejected as a
  capture artifact (see below).

Surfaces reviewed: Home, Where-to-begin, The Book, About, Credo, Objections,
Community (index / category / topic / feed), Ask Merecat, Messages/Inbox,
Profile, Library, Contact, On the Incarnation (corpus), KJV reader.


A NOTE ON RIGOUR — one HIGH was a false positive, and it was killed
------------------------------------------------------------------
In the full-page desktop captures the primary "Create an identity" button on
the Community page rendered as a solid maroon blob with no visible label — a
textbook high-severity "illegible primary CTA". It is NOT real. Chasing it to
ground with live computed-style reads, per-pixel sampling, an element-stack
enumeration, timing sweeps, and a screenshot-method toggle proved it a
`captureBeyondViewport` (full-page screenshot) rasterisation artifact: with a
normal viewport screenshot, and per getComputedStyle on the live page at
1440px, the button is a correct white outline pill with readable maroon text,
identical to "I have a key". Real users see a correct button. It is excluded
from this report. (The residual, real issue is only that the two pills have no
primary/secondary hierarchy on desktop — see P4.) Two of the reviewers
independently reached the same "capture artifact" conclusion; one did not, and
was overruled by the direct measurement. Flagging this because it is exactly
the class of finding a review must not ship wrong.


WHAT'S WORKING WELL (keep it)
-----------------------------
- A genuinely coherent visual identity: deep maroon + cream + thin rules, a
  calm serif for reading and a modern system-sans for the platform UI. It reads
  as one considered product, not a template.
- The reading surface itself is excellent: measured typography, tasteful
  epigraphs, well-set creed/confession boxes, quiet TOCs. This is the site's
  soul and it shows.
- The mobile app is the strongest execution on the site: the tab bar, the Home
  launcher cards, the slide-up sheets, the keyboard-aware chat composer, the
  empty-state icons — it genuinely feels like a native app.
- Dark mode is thoughtful and multi-variant (charcoal/slate/ink + paper/mist/
  sepia) and mostly holds up.
- A real depth language (shared radius/shadow/lift/tap tokens) and PWA/app-shell
  polish (soft-nav, audio dock, offline shell).

The issues below are, with one exception, refinements to a good design — not a
rescue. They cluster on the DESKTOP composition and on a few cross-surface
consistency gaps.


================================================================================
 P1 — HIGH: the reading column has no measure cap on desktop
================================================================================
The single most important finding. Four independent reviewers found it.

  Where:    Every long-form page under the app shell — Credo, About, the papers,
            On the Incarnation, KJV, the whole ~265-page corpus (main.prose).
  Evidence: credo.d.light, about.d.light, incarnation.d.light, kjv.d.light.
            styles/main.css: the .prose block (~447-528) sets reading typography
            but NO max-width; body ladders to 1320px (line 224).
  Impact:   On a 1440px desktop the reading column inherits the full ~1050-1080px
            content box — a serif measure of ~110-150 characters per line, far
            past the 45-75ch readability band. The eye loses the next line's
            start on every wrap. This is the site's CORE FUNCTION and it reads
            worse than a forum post: section.board is capped at 66rem,
            section.comments at 34rem, form.contact at 34rem, even the Library
            intro at 42rem — every platform surface caps its measure EXCEPT the
            reading corpus. On Credo the 36rem confession box and TOC sit as
            capped islands while the surrounding paragraphs sprawl full width, so
            the column has no consistent edge.
  Fix:      Cap the reading column only: `main.prose { max-width: 46rem;
            margin-inline: auto; }` (≈75-80ch, matching the site's 46rem base).
            Scope to main.prose so app-chrome / library grid / forum (which set
            their own widths) are untouched; leave tables + the >2MB Bible/
            Fathers readers on their existing overflow-x scroll. Pair with the
            desktop-balance fix (P2-a) so the centred column doesn't drift
            further right of the rail. Effort: S.
  Corollary (LOW): the KJV audio player + seek bar and the pandoc TOC/§-argument
            boxes also stretch full-width and read as oversized empty strips —
            capping the column fixes most of it; add explicit caps
            (.bible-player, nav#TOC { max-width: 46rem }) if the parent cap
            targets text blocks only.


================================================================================
 P2 — MEDIUM: worth doing next
================================================================================

P2-a  Desktop composition: the floating rail is marooned in a ~350px left void,
      and the Home launcher under-fills the wide canvas.
  Where:    Home, Contact, Profile/DM, register pages (any capped-column page).
  Evidence: home.d.light, contact.d.light; library.d.light (the counter-example).
            body max-width:1320px + margin:auto (213-224); body.mc-app
            padding-left:calc(rail+1.5rem) (1963-64) shoves the centred box right;
            .mc-sidebar position:fixed; left:0.7rem (1933) pins the rail to the
            window edge. .mc-home is a single 34rem flex column (1371) at all
            widths.
  Impact:   The rail sits hard-left, then a ~340px empty band, then the content
            column centred ~110px right of true centre, then a matching void on
            the right. The rail floats detached with nothing beside it. Home —
            the first thing a desktop visitor sees — is the emptiest page on the
            site, while the Library page one click over proves the same card
            vocabulary fills the width beautifully as a grid.
  Fix:      (1) Treat [rail + gap + content] as one optically-centred unit
            instead of pinning the rail to the window edge over a right-shifted
            box. (2) At >=992px, switch .mc-home-feats + the shelves to a grid
            (repeat(auto-fill, minmax(16rem,1fr))) mirroring .mc-lib-grid and
            widen .mc-home so the launcher fills the canvas — which also makes
            the void disappear on Home by itself. Effort: M-L.

P2-b  The page title renders twice on desktop (deskbar + H1), and the dedupe is
      mobile-only + .home-title-only so the ~250 corpus pages duplicate on BOTH
      breakpoints.
  Where:    Every content page; every pandoc corpus/Scripture page; inner forum
            views (stale generic "Community" H1).
  Evidence: credo.d.light ("Credo" twice), incarnation.d.light, contact.d.light,
            library.d.light ("Library" 1.05rem bar + 2rem H1 within ~60px).
            body.mc-app main.prose > .home-title{display:none} lives INSIDE
            @media(max-width:600px) (1365) and matches only .home-title; corpus
            pages use header#title-block-header h1.title, never .home-title.
  Impact:   Redundant title burns the top of every reading page; the same page
            looks different across breakpoints; directly contradicts the code's
            own stated intent ("the title rides the app bar now").
  Fix:      Lift the rule out of the mobile media query to a shared scope and
            broaden the selector: `body.mc-app main.prose > .home-title,
            body.mc-app main.prose > #title-block-header { ... }`. Prefer a
            visually-hidden (offscreen) treatment over display:none so each
            document keeps one real H1 in the a11y tree (the deskbar title is a
            div, not a heading). Effort: S.

P2-c  Light-mode muted-ink ramp fails WCAG AA.
  Where:    Timestamps, "edited"/locked/admin marks, assigned pseudonyms, rank
            counts, page counts, board stats — across the forum and profiles.
  Evidence: forum-topic.d.light, community.d.light.
            --faintest #999 (main.css:42) = 2.85:1 on white (fails AA 4.5:1 AND
            the 3:1 large-text floor); --muted-d #777 = 4.48:1 (just fails).
            Both drive real, useful metadata at 0.78-0.85rem.
  Impact:   Low-vision users struggle to read who wrote a post, its rank, and
            when. Dark mode is fine — this is a light-mode ramp one step too
            light.
  Fix:      Darken the light values: --faintest -> ~#6d6d6d (~4.6:1),
            --muted-d -> ~#696969 (~5.0:1); re-check against cream/cream-2, not
            just white. Leave dark values alone. Effort: S.

P2-d  Anchored deep-link / verse jumps land underneath the fixed top bar.
  Where:    Fathers headings/paragraphs, KJV verse permalinks, pandoc TOC jumps.
  Evidence: (CSS-provable) .dl and .bible-verse set scroll-margin-top:2rem
            (1157, 1203); the fixed deskbar is 3.25rem and the app bar 3rem
            (1798, 1229) — both TALLER than 2rem.
  Impact:   Following a ¶ permalink, a TOC entry, or a verse anchor clips the top
            ~20px of the very target you jumped to behind the chrome. These
            anchors are load-bearing (shared permalinks AND the RAG bot).
  Fix:      body.mc-app :where(.dl,.bible-verse){ scroll-margin-top:
            calc(var(--mc-deskbar-h) + 1rem) } on desktop and
            calc(var(--mc-appbar-h) + 1rem) at <=600px; extend to any
            TOC-linked heading not already .dl. Effort: S.

P2-e  The desktop / dark JOIN modal drops all the mobile onboarding polish.
  Where:    "Join the conversation" — the site's single conversion moment, shown
            on Ask Merecat / Feed / Profile / Inbox when logged out.
  Evidence: merecat.d.light, feed.d.light, merecat.d.dark; vs merecat.m.light.
            .faith-option cards, the accent-color radios, .mc-onboard-havekey,
            .mc-onboard-create are ALL inside @media(max-width:600px)
            (1486-1502, 1690-1702). The desktop modal block (1724-41) styles only
            the container.
  Impact:   On desktop the faith choices fall back to tiny native OS radios with
            run-together descriptions and no selected state, and "I already have
            a key" renders as a raw gray-bevel browser <button> — a glaring
            break in the all-maroon system on the most important screen for a new
            member. In dark mode those native controls read as light chips on the
            dark sheet.
  Fix:      Ungate the .faith-option card + :has(input:checked) highlight + the
            >=1.25rem accent-color radio, and the .mc-onboard-havekey maroon-link
            styling, so they apply at all widths (or duplicate into the >=601px
            block). Constrain radio hit areas >=44px. Effort: M.

P2-f  The auto-opened modal has no close control, no Escape, no focus management.
  Where:    Same modal (McSheet as desktop dialog), auto-popped on Merecat /
            Messages / Profile via viewJoin().
  Evidence: profile.d.light, merecat.d.light. McSheet renders role="dialog"
            aria-modal="true" (appchrome.js:241) but the desktop grip is
            display:none (main.css:1739), there is no header X, and McSheet has
            NO keydown handler; the only Escape handler is on the deskbar
            dropdowns (appchrome.js:495).
  Impact:   A visitor who came only to read the "Ask Merecat" intro is boxed in —
            the sole dismissal is clicking the dimmed scrim (undiscoverable, and
            unavailable to keyboard/AT users). With aria-modal set and no
            keyboard exit or focus trap, it is a broken-dialog accessibility
            failure.
  Fix:      Add a visible close X in the sheet header (shown when the grip is
            hidden), a keydown->Escape-to-close handler, move focus into the
            dialog on open and restore it on close, and trap Tab while open.
            Effort: M.

P2-g  The Book's edition buttons are a theme-blind Bootstrap palette outside the
      site's button system.
  Where:    The Book page — five stacked CTAs (btn-read/btn-pdf/btn-amazon).
  Evidence: the-book.d.light, the-book.d.dark. main.css:577-583 hardcode
            #198754 green + #ffc107 amber, no var(), no dark override anywhere.
  Impact:   The page's primary calls-to-action belong to a different design
            system (reads like a different site), and in dark mode they are the
            ONLY buttons that don't adapt — Bootstrap-bright green/amber on
            charcoal while everything else recolours. (Also: the two SOLID-yellow
            paid buttons out-weigh the OUTLINE-green free downloads — inverted
            emphasis for a CC0-dedicated work.)
  Fix:      Bring them into the maroon token system (var(--accent-fill) for the
            free/primary actions; carry the free-vs-buy semantic with an
            outline/badge instead of a foreign palette), or at minimum add a
            data-theme="dark" override + give the two paid buttons an outline
            treatment so only "Read online" is a solid fill. Effort: M.

P2-h  Mobile top app bar is overloaded; the forward arrow is a dead control.
  Where:    Community / forum pages.
  Evidence: forum-cat.m.light. The right cluster packs search+bell+gear+forward
            at gap:0.25rem, all 40px (<44px). Back gets a dim state when history
            is empty (appchrome.js:159); Forward (appchrome.js:167) never does,
            so it's always lit but a no-op — and forward is unidiomatic on
            phones.
  Fix:      Drop the mobile forward button (OS back gesture covers it) and bump
            .mc-ab-btn to 44x44px. Effort: S.

P2-i  Mobile post timestamps wrap mid-value.
  Where:    Every post header on the topic view.
  Evidence: forum-topic.m.light — "July 24, 2026 at 6:29" on one line, "AM  quote"
            stranded on the next. .comment-date (main.css:796) has no wrap guard.
  Fix:      white-space:nowrap on .comment-date; group date + "quote" as an
            inline-flex row with a >=44px tap target for "quote". Effort: S.


================================================================================
 P3 — SYSTEM-LEVEL (from the completeness pass)
================================================================================

P3-a  The identity gate has two contradictory personalities. On Community it is a
      calm, non-blocking inline row ("To comment, create an identity …") that
      lets you read first; on Merecat / Profile / Inbox it throws a full-screen
      blocking modal before you can see anything. Same requirement, opposite
      presentation — and it punishes exploration of exactly the features
      (Ask Merecat, Profile) most likely to convert a newcomer. Pick ONE idiom
      (preferably the calm inline one everywhere; open the modal only on an
      explicit Ask/Send/Edit action).

P3-b  The persistent deskbar's centre is polymorphic: a search field on
      Community, a page title on Library/Book/Merecat/Profile, empty on Home. A
      fixed chrome element should be stable; instead it reshuffles every hop. And
      board search only exists WHILE you're on Community — there is no way to
      search the forum from Home, Library, or a reading page. Give the centre one
      stable role (a persistent compact search that routes to ?q= from anywhere,
      or always the title + a search icon in the right cluster).

P3-c  The board is a flat 14-category wall. The six confessional "in-house talk
      for [tradition]" rooms aren't grouped or subheaded, so a newcomer scans 14
      look-alike rows with no map. Meanwhile the useful activity scent (latest
      thread + author + time) is squeezed into an 18rem right column that
      ellipsizes ("…Would he revise his po… · merecat 🐈"), while the loudest
      element is a static maroon name that looks identical busy or dormant.
      Group the rooms (Common rooms / In-house by tradition), give the latest-
      activity line room to breathe, and let active rooms carry a little more
      weight than dormant ones.

P3-d  Dark-mode figure/ground: the floating rail's fill (--glass ≈ rgba(15,17,19)
      ≈ --bg #0f1113) is essentially the page background, and the Home/Library
      cards (--cream-2 #1b1f24 on #0f1113 ≈ 1.2:1) barely lift — so the primary
      desktop nav and the launcher cards read as faint smudges defined by a
      ~1.4:1 hairline alone. Give raised chrome a real fill lift in the dark
      blocks (use --surface or a dedicated raised token, and/or a ~3:1 border).

P3-e  Desktop navigation is triply stacked on Home: the rail, the Home launcher,
      and the deskbar all repeat destinations (Community + Ask Merecat each
      appear twice within inches), and the rail offers "Home" while you're on
      Home. Let the rail be quick-switch and the launcher be browse without both
      showing the same top destinations at once; suppress the rail's active item.


================================================================================
 P4 — LOW: polish (batchable)
================================================================================
- Tab bar mixes crisp stroke SVG icons (Home/Community/Inbox/Profile) with
  full-colour emoji (🐈 Merecat, 📰 Feed). Give Feed a stroke SVG; the 📰 has no
  brand reason. (🐈 as the mascot is defensible — normalise its size/baseline.)
- The raised "hero" FAB is on Community at slot 4 of 6 (~58%, right of centre)
  while the code comment says Merecat is "the standout"; resolve the code/comment
  mismatch (and note a 6-tab bar can't centre a raised FAB).
- Screen title contradicts the tab: the Feed tab titles its screen "Community";
  the "Inbox" tab titles its screen "Messages". Add a feed branch to
  pageTitle(); pick one word for the messaging destination.
- Desktop identity CTAs are two IDENTICAL outline pills — the mobile filled-
  primary was never carried up, so the key conversion action has no emphasis
  over "I have a key". Add a filled :first-of-type in the >=601px block via
  var(--accent-fill)/var(--accent-on) (this also forecloses any maroon-on-maroon
  state — see the verification note).
- Home feature cards give ZERO hover feedback while every other card on the site
  lifts; and they use a bespoke resting shadow instead of --shadow-1. Add the
  standard hover/transition and swap in the token.
- One Home feature card ("The Book") renders a divergent tint (rose in light,
  red in dark) that isn't defined in any CSS rule — a stray state leak that reads
  as a false "selected" state. Trace and remove the errant class/inline style.
- Three card/row idioms do the same "tap to navigate" job (feature card / flat
  row / board row / lib card); Home stacks two of them. "Library" is a card on
  its own page but a plain text row on Home. Collapse toward one shared tap-row
  component.
- Filled maroon accents hardcode #8b1a1a instead of var(--accent-fill)
  (you-bubble 1549, mobile pager pill 1682, tab hero 1292) so they render a
  muddier red in dark; the SAME pager pill is tokenised on desktop (1919) but raw
  on mobile. Route them through the token.
- Button radius drift: 4px / 6px / 8px / 999px in use; none of the primaries use
  the --radius (8px) token, and the pager "pills" are 8px rounded-rects while
  every other pill is a 999px capsule. Pick one button radius token; decide the
  pager's identity.
- Disabled primary buttons fade to washed-out pink via opacity, reading as broken
  when they're the ONLY visible CTA ("Create my identity", "Reply"). Use a
  dedicated disabled style (grey fill + legible >=3:1 label + cursor:not-allowed)
  instead of a blanket fade.
- Onboarding "Paste your key" field is clipped to "Paste your k" because the
  "Log in" button (base .btn min-width:16rem) eats the row. Cap the button
  (min-width:0; flex:none) so the input keeps priority.
- Board rows are fully clickable but give NO at-rest affordance on desktop (the
  chevron is mobile-only). Add a low-contrast persistent chevron on desktop.
- Empty categories show a faint right-aligned "quiet so far" with no invitation.
  Replace with a low-contrast "Be the first to post ->" that reads as an
  opportunity, not a dead-end.
- Contact "Send" is a narrow (~256px) left-hanging block breaking the 34rem
  full-width field column. Give .btn-send width:100% within form.contact.
- Library intro (42rem, left-aligned) sits over a full-width grid, leaving a
  ragged empty upper-right. Add a light right-aligned element (a "N works across
  M shelves" count / jump-list) to close the seam.
- Library title uses weight 800 + letter-spacing -0.02em — the only such values
  on the site. Bring it to weight 700 / no negative tracking to join the
  platform-title family (keep the deliberate serif-reading vs sans-platform
  split).
- Home mixes maroon card-titles and near-black ink row-titles in one list; the
  ink rows also drop the site's universal maroon+underline link affordance, so
  they read as labels, not links. Strengthen the row tap affordance (persistent
  chevron + subtle hover cue).

Accessibility (cross-cutting, low-severity but cheap):
- No :focus-visible anywhere; keyboard focus is a thin 1px :focus ring on a few
  inputs (fires on mouse click too) and UA-default-only on the icon chrome. Add
  one global :focus-visible { outline:2px solid var(--maroon); outline-offset:2px }
  and convert the input :focus rules to :focus-visible.
- No prefers-reduced-motion guard, yet motion is wired into core flows
  (page-swap on nearly every tap, chat bubbles, the live-reply fade, the sheet
  slide-up). Add one global @media(prefers-reduced-motion:reduce) reset.
- Composer toolbar buttons compute to ~24px and app-bar icons to 40px — below
  the 44px platform target. Give .md-btn min-height:44px in a mobile block and
  .mc-ab-btn 44x44px.


================================================================================
 RECOMMENDED FIX PLAN (phased by ROI and risk)
================================================================================
Tier 1 — high value, low risk, CSS-ONLY (no bundle/JS, no ?v= bump):
   P1 prose measure cap; P2-b duplicate-title dedupe; P2-c contrast ramp;
   P2-d scroll-margin-under-bar; the two a11y one-liners (:focus-visible,
   prefers-reduced-motion); + the quick CSS P4s (timestamp nowrap, contact Send
   width, tab touch targets, radius/token tidy, dark figure-ground lift).
   -> ship: edit styles/main.css, `make css`, `make tests`, commit, push
      (style.css is unversioned; propagates on Cloudflare TTL).

Tier 2 — the conversion flow (touches app/appchrome.js -> app.js bundle):
   P2-e onboarding modal polish on desktop/dark; P2-f modal close/Escape/focus;
   P4 identity-CTA emphasis; P3-a unify the gate idiom.
   -> ship: `make bundle`, bump app.js?v=N in nav.js, `make jscheck`,
      `make tests`, commit, push, purge nav.js at the edge.

Tier 3 — composition & IA (larger / more subjective, worth a design pass):
   P2-a desktop rail-void rebalance + Home launcher grid; P2-g Book buttons into
   tokens; P3-b deskbar centre + global search; P3-c board grouping; P3-e nav
   de-duplication.

Tier 4 — remaining P4 polish, batched.

Every change respects the standing gates: `make tests` green before commit;
`make jscheck` after any worker/client-JS edit; `make css`/`make bundle` as
applicable; ?v= bump only for app.js/comments.js (style.css is unversioned).
================================================================================
