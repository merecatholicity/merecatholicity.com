/* Shared helpers for the PureScript Domain tests (tests/purescript/*.test.mjs).
   Each test imports its own compiled module from ../../purescript/output/, and
   these helpers erase the PureScript Maybe/Either the same way app/core.js does
   at the JS boundary — so the tests read the way the UI reads these values.
   Run `make psbuild` first if purescript/output/ is missing. */

import * as Maybe from '../../purescript/output/Data.Maybe/index.js';
import * as Either from '../../purescript/output/Data.Either/index.js';

/* Maybe a -> a | null   (app/core.js bookSlug does exactly this) */
export const orNull = (m) => Maybe.maybe(null)((x) => x)(m);

/* Maybe a -> a | ''     (app/core.js faithLabel does exactly this) */
export const orEmpty = (m) => Maybe.maybe('')((x) => x)(m);

/* Either e a discriminators (the profile validators return these) */
export const isRight = (e) => e instanceof Either.Right;
export const isLeft = (e) => e instanceof Either.Left;

export { Maybe, Either };
