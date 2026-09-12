# tests/ — the unit suite

Fast, hermetic unit tests. No browser, no network. `make tests` runs the whole
thing; it is the Layer-1 suite in the project's testing story (see the **Testing
policy** section in `CLAUDE.md`).

## Why these tests exist

Tests here are meant to **clarify what the code does** for someone reading the
repo, and to **guard the rules that would break silently**. They read like a
rulebook for the app's logic. This is deliberately **not** a coverage-chasing
suite — there is no 99% target, and there is no test for a trivial getter. If a
piece of logic is worth a human understanding, and getting it wrong would break
something, it belongs here. If not, it doesn't.

The center of gravity is the **PureScript `Domain` layer**: those modules already
distil the app's rules (rank ladder, permission matrix, FTS injection safety,
route priority, scripture parsing, validation caps), so a test over each one
reads as that rule's spec.

## The three test layers (where a new test goes)

| Layer | Location | What it is | Speed |
|---|---|---|---|
| **1 — unit** | `tests/` (this dir) | pure functions, hermetic, `make tests` | ms |
| **2 — integration / render** | `webtest/` | headless Chromium, real DOM/soft-nav parity, mostly vs prod | slow |

A pure function (validation, permissions, parsing, math, a state transition, a
formatting rule) → Layer 1, here. Something that only shows up when client JS
runs in a real browser (anchor jumps, board/DM rendering, scroll-to-comment) →
Layer 2, `webtest/`.

## Layout (one file per concern)

```
tests/
  _support/ps.mjs      shared Maybe/Either erasure readers for the compiled PS output
  _support/client.mjs  the browser client's sources for the source-rule tests (the root and the
                       seven feature modules of client/, as one text or one at a time)
  purescript/          one file per Domain module — the rulebook
  js/                  the app/ layer: core (the membrane), store (cache), api (the SDK),
                       the build ↔ kernel parity of the commentable pages, the DM press-and-hold
                       surface's laws (the overlay's three layers, the reply envelope round trip),
                       the classic client's module wiring (client_modules: every binding
                       filled and provided, no var initializer before bind, shared state on B only),
                       the conversation's chat-app basics (dm_chat_basics: the jump button, the
                       unread line, seen only when reached, typing in the header, foot and inbox),
                       the bottom bar's own laws (tabbar: six equal slots that may shrink, no
                       raised hero, the Inbox badge spoken in the tab's label), and the shared
                       press-and-hold surface (surface: one overlay root, both post renderers arm
                       the hold with the reaction, the acts go home on close, the nearest armed
                       node, the kernel before the wire, the phone selection rule)
  worker/              the security-critical worker helpers (IP/ban keys, back-room privacy,
                       the usage monitor's maths, the librarian's config chain and its AI budget guard,
                       the comments switches and the journal sweep's SQL on real migrations,
                       the DM reaction ledger — 0012's backfill and the handler's kernel gate —
                       and the last-seen stamp — 0013, the hub as its one writer; the unread
                       count and the thread's pre-open unread query RUN on the ledger, the hub's
                       typing gate, and the tab badge's summed count over the ledger (dm_unread);
                       the reactions ledger — 0014's backfill, the bell's SQL run on the ledger,
                       the handlers' visibility rules and the list's joins (reactions);
                       plus the db builder, calls, media, webpush, the
                       social switch, the Discord bridge)
  py/                  the Python build tooling: nav, the content pages' frontmatter, the converters,
                       slug parity, the docs/ source-vs-generated split and its orphans, the version
                       stamp, the boot splash, the baked partials, the librarian's sources and ingest
                       ledger, the writings detector behind the comments switches
  css/                 the Tailwind build invariants (asserted on the committed docs/style.css)
```

## Frameworks (stdlib only — matches the repo's no-new-deps discipline)

- **JS + PureScript**: Node's built-in runner, `node --test` + `node:assert/strict`.
  The PureScript tests import the compiled ESM from `purescript/output/`, so
  `make psbuild` must have run first (`make tests` / `make pstest` do it for you).
- **Python + CSS**: stdlib `unittest` (pytest is not installed). Each file is
  standalone-runnable and puts the source dir it targets on `sys.path`.

## Running

**`make tests` must be green before any commit or push** (and before
`make worker-deploy`). It's a standing gate: if a change turns a test red, fix
the code — or update the test in the same commit to document the new rule. Never
delete a test to make a red build green.

```sh
make tests          # everything (runs psbuild first)
make pstest         # just the PureScript slice (fast)

# one file at a time:
node --test tests/purescript/fts.test.mjs
node --test tests/js/store.test.mjs
python3 tests/py/test_nav.py
python3 tests/css/test_style_css.py
```

## Adding tests

When you add or change a rule (a validation, a permission, a state transition, a
parser, a piece of math), add or adjust its test **in the same change** — the
test is that rule's documentation. Prefer to put new domain logic in a PureScript
`Domain` module and test it under `tests/purescript/`. Don't add tests for
trivial or DOM/network-coupled code (that's Layer 2's job). Keep each test named
for the behavior it locks.
