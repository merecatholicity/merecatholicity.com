/* The boot object every feature module is installed with (Wave F,
   2026-09-11): a bag of the root's helpers and the modules' exports, plus the
   few pieces of per-boot state more than one module writes. Deliberately
   loose — the modules were one closure until today, and their bodies moved
   verbatim; the type is a bag so no body had to change. */
export type Boot = Record<string, any>;
