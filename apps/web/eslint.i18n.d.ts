import type { Linter } from 'eslint';

// `eslint.i18n.js` is plain JavaScript because ESLint loads it; this is what lets the test that
// imports it type-check.
export const TRANSLATED: string[];
export const literalStrings: Linter.Config;
