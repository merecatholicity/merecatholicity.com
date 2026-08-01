# PURESCRIPT.md — the migration rulebook

This repository is migrating its **application/domain logic to PureScript**, while
keeping **Lit.js / Web Components as the UI rendering layer**. This file is the
authoritative statement of *how* and *why*. `CLAUDE.md` carries the condensed,
operative summary and the current infrastructure facts; this file carries the
full philosophy and the standing rules. When the two disagree on a rule, this
file governs the intent and `CLAUDE.md` governs the mechanics.

The goal is **not** a mechanical JS→PureScript translation, nor a thin PureScript
wrapper around the existing architecture. The goal is to make PureScript the
**primary application language and architectural foundation** — functional,
type-driven, illegal-states-unrepresentable — with Lit kept deliberately thin as
the presentation boundary.

> A future developer should look at this project and think *"this is a PureScript
> application that happens to use Lit for its UI,"* not *"this is a JavaScript
> application with some PureScript wrappers."* That distinction is the whole point.

---

## How this repo is wired (the concrete boundary)

```
purescript/src/Domain/*.purs ──(npm-installed purs, `make psbuild`)──▶ purescript/output/**/index.js  (ESM)
                                                                        │ imported by
                                                                        ▼
                                                                 app/core.js  (the barrel = translation membrane)
                                                                   │                          │
                    imported directly by app/views/*.js  ◀─────────┘                          │ window.mcCore = Core
                                                                                              ▼   (set in app/shell.js)
                                                                            docs/comments.js  (un-bundled classic script)
                                                                            if (window.mcCore) …core… else …classic…
                                    │
                              esbuild --bundle --minify  (command unchanged)
                                    ▼
                              docs/app.js  (the one committed, self-hosted, CSP-clean bundle)
```

- **The compiler is an npm devDependency.** `purs` (`purescript@0.15.16`,
  exact-pinned) and `spago` are restored by `npm ci` like the rest of the
  toolchain. npm-12 blocks the `purescript` package's install-script by default,
  so its approval is committed in `package.json`'s `allowScripts` — `npm ci`
  materializes the pinned binary (`node_modules/.bin/purs`) that `spago` compiles
  with (found on PATH). No vendored binary.
- **The barrel `app/core.js` is the single seam.** `app/shell.js` imports it and
  sets `window.mcCore = Core` (mirroring the existing `window.mcRich` /
  `mcStore` / `mcApi` bridges). The Lit views under `app/views/` import from
  `app/core.js` directly (typed at the boundary, tree-shaken by esbuild). The
  un-bundled `docs/comments.js` reaches the same functions through `window.mcCore`
  using the exact `if (window.mcX) return window.mcX.fn(...) else classic` idiom
  it already uses 13+ times.
- **CSP `script-src 'self'` holds.** `purs` emits plain ES modules with no
  `eval`/`new Function`; everything ends up inside the one self-hosted `docs/app.js`.
  Never introduce a PureScript dependency, bundler, or FFI that emits `eval` or
  loads remote code. Turnstile stays the sole CDN exception.
- **Byte-determinism holds.** Pinned `purs` + pinned package set + `rm -rf
  purescript/output` before each build ⇒ reproducible codegen ⇒ reproducible
  `docs/app.js`. Any bundle byte change **must** bump `app.js?v=N` in
  `docs/nav.js` (the service worker `docs/sw.js` caches `app.js` by exact URL, so
  the `?v=` bump is the only cache-bust).

---

## The barrel is a translation membrane (read this before adding to `app/core.js`)

PureScript sum types do **not** survive the JS boundary: `Maybe`/`Either`/ADTs
compile to tagged constructor objects (`{tag:'Just', value}`), which the untyped
classic path can't pattern-match and will silently treat as truthy. Therefore:

- **Nothing exported on `window.mcCore` (or imported by `docs/comments.js`)
  returns a raw PureScript constructor.** `app/core.js` is the ONE audited place
  where types are erased to plain JS:
  - `Maybe a` → `a | null`
  - `Either e a` → `{ ok:true, value } | { ok:false, error:{ kind, … } }`
  - `data T = …` → a discriminant string, or the already-rendered value
- Keep the barrel **tiny** so this erasure stays reviewable. Type safety lives
  *inside* PureScript; the barrel is the membrane, not a place for logic.
- A `webtest` asserts the *shape* of `window.mcCore` (keys present, arities,
  return `typeof`) so a rename inside PureScript fails headlessly, not at a user.

---

## The 27 rules

### 1. PureScript first
For all new application logic: write it in PureScript. Do not introduce new
JavaScript application logic unless it is genuinely required for browser/platform
interoperation. When modifying existing JS functionality, prefer migrating it
into PureScript over extending the JS. PureScript should become the source of
truth for application state, domain behavior, validation, permissions, API
interaction, and business rules. JavaScript increasingly becomes an **interop
mechanism**, not an application language.

### 2. Do not write "JavaScript in PureScript"
Do not mechanically translate imperative JS (mutate, call, inspect, mutate more)
into PureScript. Redesign using PureScript's strengths: algebraic data types,
pattern matching, immutable data, pure functions, typeclasses where appropriate,
`Maybe`/`Either`, explicit effects, explicit state transitions, composable
functions, typed domain models, smart constructors, narrow module interfaces. The
objective is **architectural** conversion, not syntactic.

### 3. Use strong types aggressively
Encode domain invariants in the type system rather than in conventions, comments,
or runtime checks. Do not represent meaningful domain concepts as bare primitives:
prefer `newtype UserId = UserId String`, `newtype PostId = PostId String`, etc.
Distinguish meaningful states with ADTs (e.g. `AuthenticationState = Anonymous |
Authenticating | Authenticated User | AuthenticationFailed AuthError`) rather than
a bag of nullable fields (`user = null; loading = true; error = null`).

### 4. Algebraic data types are preferred
When a domain concept has a finite set of alternatives, model it as an ADT with
exhaustive pattern matching (`PostVisibility = Public | MembersOnly | Private`,
`LoadState a = NotLoaded | Loading | Loaded a | Failed Error`). Do not use
arbitrary strings for enumerations without a compelling interop reason, and do
not use boolean combinations (`isLoading && hasError && !hasData`) where a sum
type expresses the domain directly.

### 5. Make illegal states unrepresentable
Before asking *"can we add a runtime check?"* ask *"can the compiler prevent
this?"*. Use types to represent authentication, authorization, permissions, post
status, moderation state, API responses, loading states, validation results,
pagination, notifications, relationships, membership, events, errors, commands,
identifiers. Validate at external boundaries, then preserve invariants once data
is inside the typed domain. In this repo the flagship examples are `SafeMatch` (an
FTS query string that cannot carry an operator injection) and `VerseRef` (a
scripture reference with a real book, positive chapter/verse, and an ordered
range).

### 6. Keep pure logic pure
Business rules should look like `input → output`, not `input → mutate global →
I/O → inspect → mutate more`. Permission calculations, validation, formatting,
sorting, filtering, feed construction, moderation rules, state transitions,
pagination, notification decisions, and domain transformations should be pure.
Push side effects toward the edges.

### 7. Make effects explicit
Do not hide I/O inside functions that look pure. Separate pure computation from
effectful operations, browser interaction, network requests, storage, auth,
timers, DOM. Compose pure logic, then interpret/perform effects at the boundary.
Do not create a global grab-bag of functions that secretly perform effects.

### 8. Use `Maybe`/`Either`, not null/undefined/throw
Do not reproduce JS's `null`/`undefined`/`throw`/`try-catch` throughout the
PureScript application. Use `Maybe` for legitimate absence and `Either`/a domain
error type for failure. Errors carry structure: `AuthError = InvalidCredentials |
SessionExpired | AccountDisabled | NetworkFailure`, not opaque strings.

### 9. Model the app as State + Events + Transitions
The frontend should increasingly resemble a typed functional state machine:
`State + Event → Transition → (New State, Effects)`. Centralize the transition
logic; give events meaning (`Event = LoginRequested Credentials | LoginSucceeded
User | LoginFailed AuthError | PostCreated Post | PostDeleted PostId | …`). UI
components dispatch typed events/commands; they do not directly mutate state.

### 10. Lit.js is the presentation boundary
Lit stays. It is kept deliberately thin. Lit components should (1) receive
application state, (2) render it, (3) capture interaction, (4) dispatch typed
events, (5) invoke the small interop boundary when necessary. Lit components must
**not** carry permission rules, authentication logic, API workflows, feed
algorithms, moderation rules, domain validation, or complex state machines. If a
component carries substantial application logic, that logic belongs in PureScript.
*(Practically: "keep Lit unchanged" means the library, the ``html`` templates,
and the rendered output stay; the view **files** get thinner as logic moves to
PureScript.)*

### 11. Keep the PureScript/Lit boundary thin
The JS/PureScript boundary is as small as reasonably possible. Do not expose the
whole application as a pile of arbitrary JS functions. Move computation into
PureScript rather than repeatedly crossing the FFI boundary for tiny operations.
The long-term direction is *large PureScript application, small JS/Lit shell* —
not *large JS application, small PureScript helper library*.

### 12. Treat JavaScript FFI as an escape hatch
FFI is permitted and expected for what genuinely belongs to the browser
ecosystem: Lit APIs, DOM APIs, browser APIs lacking suitable bindings, Web
Components, third-party JS libraries, platform features. But do **not** use FFI
merely because a PureScript implementation is inconvenient, and do not move
ordinary business logic into JS to avoid PureScript. Each FFI function: keep it
small, give it a narrow interface, isolate it in a dedicated module
(`purescript/src/Ffi/*`), expose a typed PureScript abstraction above it, and
don't leak JS details through the app. In this repo the known FFI surfaces are:
WebSocket lifecycle (`app/live.js`), `fetch`/retry/pace (`app/api.js`), WebCrypto
AES-GCM + tweetnacl X25519 for DM E2E, `localStorage`, DOM-safe rendering (no
`innerHTML`), Turnstile, history/popstate soft-nav, and the persistent Audio dock.

### 13. Prefer functional abstractions over OOP
Do not reproduce a JS class hierarchy in PureScript. Avoid classes-as-containers,
mutable objects, inheritance, service/manager/controller/singleton objects.
Prefer modules, ADTs, records, functions, typeclasses (where they give genuine
abstraction), immutable values, explicit dependencies, and composition. Do not
create abstraction for its own sake.

### 14. Use typeclasses where they express real capabilities
Use typeclasses when a concept genuinely has multiple implementations or a
capability is meaningfully abstract. Do not turn every interface into a typeclass;
prefer simple functions and concrete types when abstraction is unnecessary. The
objective is *useful* abstraction, not maximal abstraction.

### 15. Separate domain types from transport types
Do not let API JSON structures become the domain model by default. External data
is untrusted: `JSON/HTTP → decode + validate → typed transport representation →
domain conversion → domain model`. Once data is in the domain layer it obeys
domain invariants. Do not scatter JSON field access through application logic.

### 16. Validate at boundaries
External boundaries are API responses, user input, local storage, URL parameters,
browser APIs, WebSocket messages, auth/session data, third-party JS. Parse/validate
data as it enters. Do not re-check the same assumptions throughout. **Validate
once at the boundary, then trust the stronger type internally.**

### 17. Make dependencies explicit
Avoid hidden global state. Do not make modules secretly depend on `window`,
`document`, `localStorage`, globals, or singleton app state unless they are
explicitly part of the browser/interop boundary. Pass dependencies explicitly or
model capabilities/effects. The application should be testable without a real
browser wherever practical.

### 18. Favor small, composable modules
Organize modules around domain concepts, not framework components:
`Domain.User`, `Domain.Post`, `Domain.Comment`, `Domain.Community`,
`Domain.Permission`, `Domain.Notification`; `Application.Auth`, `Application.Feed`,
`Application.Moderation`; `Infrastructure.Api`, `Infrastructure.Storage`,
`Infrastructure.Browser`; `UI.*` for the Lit adapters. Do not create excessively
tiny modules just to satisfy a rule.

### 19. Testing
Pure functions must be easy to test. Prioritize testing domain rules, state
transitions, parsers, validators, permission logic, moderation rules, feed
algorithms, error handling. Prefer deterministic pure-logic tests over
browser-driven tests. The more behavior lives in pure PureScript, the less of the
app requires expensive integration testing. (This repo's Layer 1 is a Node-native
runner over the ESM output; Layer 2 is the standing headless Chromium gate.)

### 20. Avoid `unsafe` patterns
Do not reach for unsafe escape hatches casually or weaken the type system to make
code compile. If a value cannot be proven safe statically, isolate the unsafe
operation at the narrowest boundary and convert it to a safe typed representation
immediately. Do not spread unsafe values through the app.

### 21. Do not optimize for minimal code
Do not choose an implementation because it has the fewest lines. Prefer
explicitness, correctness, strong invariants, composability, maintainability,
type safety, and understandable abstractions. A slightly more verbose but strongly
typed solution beats a clever JS-style shortcut.

### 22. Do not fight the language
When PureScript makes the existing JS design awkward, first ask whether the JS
architecture *itself* is the problem. Redesign the architecture to fit functional
programming when needed. The migration is an opportunity to improve the
architecture, not to preserve every existing detail.

### 23. Migration strategy — vertical slices
Do not attempt a superficial one-to-one translation of the whole codebase.
Instead, per domain: (1) identify it, (2) define strong PureScript domain types,
(3) define its state, (4) define its events/commands, (5) define pure state
transitions, (6) define effectful operations separately, (7) define the API
boundary, (8) build the PureScript implementation, (9) connect it to the existing
Lit components through a thin adapter, (10) **remove the old JavaScript
implementation**, (11) move to the next domain. Prefer vertical migration of
complete features over a large half-migrated abstraction layer. **Do not maintain
two competing implementations indefinitely** — the retained classic fallback in
`docs/comments.js` is deleted as the *closing step* of each slice's vertical,
made safe by the parity gate, and tracked in the ledger below so it can't quietly
become permanent.

### 24. New code must follow these rules
All newly written application code follows the PureScript architecture. Do not
introduce new JS business logic just because the migration is incomplete. If a new
feature touches an existing JS subsystem, consider migrating that subsystem as
part of the feature. The migration continuously moves the center of gravity toward
PureScript.

### 25. When making architectural decisions
Between two implementations, prefer the one that: (1) gives the compiler more
information, (2) makes invalid states harder to represent, (3) reduces mutable
state, (4) reduces implicit effects, (5) keeps business logic pure, (6) makes
dependencies explicit, (7) isolates I/O, (8) reduces FFI surface area, (9) uses
domain-specific types, (10) is easier to test. Do not choose an approach merely
because it resembles the existing JS.

### 26. Haskell-inspired philosophy
Adopt the useful parts of the Haskell tradition where they improve the app:
purity, immutability, referential transparency, ADTs, pattern matching,
type-driven design, explicit effects, composition, strong domain modeling,
abstraction through types, total functions where practical, separation of pure
computation from effects, illegal-states-unrepresentable. But do **not** introduce
advanced type-level programming, complex typeclasses, or transformer stacks merely
to demonstrate sophistication — only when they provide concrete architectural
benefit. The goal is **Haskell-style discipline expressed idiomatically in
PureScript**, not Haskell recreated for its own sake.

### 27. The desired end state
```
┌──────────────────────────────┐
│            Lit.js            │  Web Components · templates · DOM · CSS · browser-specific
└───────────────┬──────────────┘
            thin adapter (app/core.js barrel + app/views)
┌───────────────▼──────────────┐
│          PureScript          │  Domain types · application state · events/commands ·
│                              │  transitions · business rules · validation · permissions ·
│  mostly pure, strongly typed │  authentication · feed logic · notifications · API client ·
│                              │  error handling · persistence abstractions
└───────────────┬──────────────┘
             typed API boundary
┌───────────────▼──────────────┐
│           Backend            │  Cloudflare Workers + D1/R2/Vectorize (Phase 6: shares the kernel)
└──────────────────────────────┘
```

---

## Important instruction for AI coding agents

Do **not** optimize for preserving the existing JavaScript architecture. This is an
intentional architectural migration; existing JS patterns are not authoritative
and should not be mechanically reproduced in PureScript. When translating a
feature, first understand what it does, then redesign its implementation according
to PureScript's type-driven model. **Do not create a thin PureScript wrapper around
JavaScript and call the feature migrated.** A feature is migrated only when its
meaningful application logic has moved into PureScript and the remaining JavaScript
exists primarily because of Lit.js, the DOM, browser APIs, or unavoidable interop.
When uncertain, prefer stronger types, purer functions, explicit effects, explicit
state transitions, and a smaller FFI boundary.

---

## A slice is done only when all four gates pass

1. **Byte-deterministic rebuild** — `make bundle` twice ⇒ `git diff --exit-code
   docs/app.js` clean on the second run (after `rm -rf purescript/output`).
2. **Parity with the JS it replaces** — Layer-1 pure-unit tests (`make pstest`)
   plus Layer-2 headless delegate-vs-classic equality. This is what licenses
   deleting the classic fallback.
3. **eslint green** — `npm run lint` passes with `app/core.js` + the FFI `.js` in
   scope, and `purescript/output/**` never linted.
4. **Headless render parity** — the slice's `webtest/*.py` exits 0 against a
   locally served bundle, console clean.

Plus: bump `app.js?v=N` in `docs/nav.js` iff `docs/app.js` bytes changed.

---

## Migration ledger (phases and their classic-fallback status)

| Phase | Domain | Status | Classic fallback |
|------|--------|--------|------------------|
| 0 | `Domain.Rank` (toolchain + seam proof) | **shipped** (df2a065) | retained — it is the genuine no-bundle path (app disabled / storage blocked ⇒ no `window.mcCore`); deletes at Wave F when `comments.js` itself dissolves into the bundle, not before |
| 1a | `Domain.Scripture` — table + autolink regex (client) | **shipped** (8d3ebe4) | app/richtext.js retired onto Core.bibleSrc/bookSlug; the comments.js copy + worker copies remain (1b / Phase 6) |
| 1b | `Domain.Scripture` — VerseRef parse + anchor (client) | **shipped** | richtext.js builds the `kjv.html#` href via `Core.verseParts` (a validated ref — real book, chapter/verse ≥ 1, ordered range); malformed refs like "Rom 0:0" now stay plain. The comments.js copy stays (no-bundle fallback, retires at Wave F, not here) |
| 2 | `Domain.Profile` + `Domain.Faith` + `Domain.Pseudonym` + `Domain.Dm` (TTLs) + `Domain.Pager` (windowing) + `Domain.Board` (categories) + `Domain.Emoji` (packs + aliases) **shipped**; dmScore deferred (already kit-shared, no dup) | mostly done | profile caps (admin bio 1000→500 fixed), faith enum, displayName pseudonym (ADJ/NOUN, 20+ sites), DM lifetimes single-sourced; **`Domain.Pager.pagerItems` retires the flagged duplicate** — `util.js pagerPages` and the inline `member.js` reimplementation both now call it (byte-parity 16k cases; the classic `comments.js pageBar` is a deliberately DIFFERENT first-three window, left as-is). **`Domain.Board` closes the board-category dup BOTH sides**: the worker's `CAT_META`/`BOARD_CATS`/`ADMIN_CAT` and the client `comments.js CATS` (whose comment read "Keys must match BOARD_CATS in the worker") now read one PS table — proven byte-identical to both copies; worker deployed + live-verified (public cat resolves, back room refused indistinguishably from a bogus cat). **`Domain.Emoji` closes the emoji-data dup BOTH sides** (the LAST shared-constant dup): the worker's `EMOJI_PACKS` + `NAMED_EMOJI` token string and the client's inline copies now read one PS source (generated from the data, proven byte-identical to both; the ~250 standard emoji stay client-only, never on the wire). Deployed + verified (/config `custom` 60, `named` 182; headless `:cry:`→img / `:fire:`→🔥 / bogus literal). comments.js keeps its inline copies as the no-bundle fallback. **Every shared constant/table the worker and client both hold is now single-sourced.** |
| 3 | `Domain.Access` (permissions) + `Domain.Live` (topicCompare/replyPage) + `Domain.Route` (URL router) **shipped**; search/sort filters, library model planned | in progress | post permission gates + the pure live-forum decisions (topic sort comparator, reply-page math) single-sourced; **`Domain.Route.parseRoute` owns the URL→view priority ladder** — the 19-way decision `comments.js route()` ran is now one typed exhaustive function (parity proven over 245 query strings incl. every priority pair and `topic` `Number()` edge case; the `topic` coercion stays at the JS boundary, the view dispatch stays in JS as a `switch` over the erased `{tag,s,n}`). classicRoute kept as the no-bundle fallback. DOM effects stay in the views; no-bundle fallbacks stay (Wave F) |
| 4 | Application state = State + Events + Transitions (auth ADT, notifications, mute). **In progress** — a 4-concern analysis (auth/identity, post/composer, DM/crypto, notifications/mute) mapped 48 pure decisions vs 44 effects into a slice-ordered plan. **Auth slice 1 shipped:** `Domain.Auth` — the `AuthState` ADT (Anonymous / Authenticating / Pending / Member / Admin, illegal combos unrepresentable) + `isAdmin`/`isMember`/`gate` classification, single-sourcing the `isAdmin()` and `adminGate()` logic (parity 32/32 signal combos, headless-verified). | in progress | `isAdmin()`/`adminGate()` delegate to `window.mcCore.authIsAdmin`/`authGate`; classic logic kept as no-bundle fallback. Remaining auth slices: validKey guard, blockedOut classification, loadMyProfile fold, and the capstone (`state.auth :: AuthState` via pure transitions). Signup/login/logout are NOT Turnstile-gated, so the auth machine is headless-testable; the composer/DM SEND paths need manual-live. |
| 5 | comments.js effect cores (validation/what-to-send in PS; Turnstile/nacl/WS/fetch as FFI); typed API client | planned | — |
| 6 | Worker single-source — **COMPLETE.** rank + faith + profile caps + pseudonym + DM TTLs + the BIBLE book table + the FTS `SafeMatch` + the `MERECAT_BIBLE` 66-book core all retired onto the shared kernel (worker imports `Domain.Rank`/`Faith`/`Profile`/`Pseudonym`/`Dm`/`Scripture`/`Fts`; wrangler bundles `../../purescript/output`, `make worker-deploy` runs psbuild first; every step deployed + live-verified). | **done** | Every duplicated constant/table/validator the worker shared with the client now reads the PureScript modules — the same source the client bundles; **the "two files must stay identical" hazard class is closed at the root.** `Domain.Fts` is the flagship illegal-states slice: a `SafeMatch` has no public constructor, so `buildMatch`/`merecatMatch` (its only producers, worker-only) make FTS5 injection unrepresentable in the type — tokenization runs the exact JS regexes via a thin FFI (byte-identical `\S`/`\s`/word-class), the sanitizer is pure PS, and parity + injection-safety are proven over **304,750 adversarial inputs** (5-lens fuzz, 0 mismatches / 0 escapes; the corpus is standing in `run.mjs`). `MERECAT_BIBLE`'s 66-book KJV core is now derived from `Scripture.bibleSpec` (byte-identical map + regex, proven); only its Vulgate/deuterocanon rows are genuinely worker-only additions layered on top. None of these touched the client bundle (the barrel never imports `Fts`; the Scripture change is data the barrel already carried), so no `app.js`/`?v` churn. |
| 7 | Completion — dissolve remaining fallbacks | planned | — |

Keep this table current: when a slice's classic fallback is deleted, mark it here.
