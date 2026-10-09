/* Shared helpers for the PureScript Domain tests (tests/purescript/*.test.ts).
   Each test imports its own compiled module from ../../purescript/output/, and
   these helpers erase the PureScript Maybe/Either the same way app/core.js does
   at the JS boundary — so the tests read the way the UI reads these values.
   Run `make psbuild` first if purescript/output/ is missing. */

import * as Maybe from '../../purescript/output/Data.Maybe/index.js';
import * as Either from '../../purescript/output/Data.Either/index.js';

/* Maybe a -> a | null   (app/core.js bookSlug does exactly this) */
export const orNull = (m: unknown) => Maybe.maybe(null)((x: unknown) => x)(m);

/* Maybe a -> a | ''     (app/core.js faithLabel does exactly this) */
export const orEmpty = (m: unknown) => Maybe.maybe('')((x: unknown) => x)(m);

/* Either e a discriminators (the profile validators return these) */
export const isRight = (e: unknown): boolean => e instanceof Either.Right;
export const isLeft = (e: unknown): boolean => e instanceof Either.Left;

export { Maybe, Either };
