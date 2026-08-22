// The numeric half of the string-settings problem `setting.flags.ts` documents.
//
// **Every case here hands over a STRING on purpose.** A test that passes a real number proves
// nothing about any of this — it passes identically against the unfixed code, which is exactly how
// the boolean version of this bug survived as long as it did.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { numberFrom, numberOr, requiredNumber } from '../../../src/modules/shared/setting.numbers.js';

/**
 * A config that behaves the way the real layers do: a value that is SET comes back as text, and an
 * unset one falls to whatever default the caller passed.
 */
const configOf = (values: Record<string, string>): AppConfig =>
    ({
        get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    }) as unknown as AppConfig;

describe('requiredNumber', () => {
    it('reads a numeric string as the number it spells', () => {
        expect(requiredNumber(configOf({ LOG_MAX_BYTES: '2097152' }), 'LOG_MAX_BYTES', 99)).toBe(2_097_152);
    });

    it('takes the default when the key is unset', () => {
        expect(requiredNumber(configOf({}), 'LOG_MAX_BYTES', 4096)).toBe(4096);
    });

    // Unset and set-to-nothing are the same intent, and neither is a mistake worth stopping for.
    it('takes the default for an empty value', () => {
        expect(requiredNumber(configOf({ LOG_MAX_FILES: '' }), 'LOG_MAX_FILES', 3)).toBe(3);
    });

    it('tolerates the surrounding whitespace a hand-edited .env collects', () => {
        expect(requiredNumber(configOf({ LOG_MAX_FILES: ' 5 ' }), 'LOG_MAX_FILES', 3)).toBe(5);
    });

    // The one this exists for. `2MB` is what somebody reaches for, and passing it through produced
    // a log store that threw on every append into a wrapper that could not report it.
    it('refuses a value it cannot read, naming the variable and the value', () => {
        expect(() => requiredNumber(configOf({ LOG_MAX_BYTES: '2MB' }), 'LOG_MAX_BYTES', 99)).toThrow(/LOG_MAX_BYTES/);
        expect(() => requiredNumber(configOf({ LOG_MAX_BYTES: '2MB' }), 'LOG_MAX_BYTES', 99)).toThrow(/"2MB"/);
    });

    it('refuses a word', () => {
        expect(() => requiredNumber(configOf({ LOG_MAX_FILES: 'three' }), 'LOG_MAX_FILES', 3)).toThrow(/LOG_MAX_FILES/);
    });

    it('says how to get past it, since the operator is the one who has to act', () => {
        expect(() => requiredNumber(configOf({ LOG_MAX_FILES: 'lots' }), 'LOG_MAX_FILES', 3)).toThrow(/unset it to take the default/);
    });
});

describe('numberOr', () => {
    it('reads a numeric string', () => {
        expect(numberOr(configOf({ 'analysis.concurrency': '4' }), 'analysis.concurrency', 1)).toBe(4);
    });

    // The opposite call to `requiredNumber`, and the reason there are two: an operator-facing
    // setting nobody can parse is a setting nobody set, and the station keeps working.
    it('falls back rather than throwing on nonsense', () => {
        expect(numberOr(configOf({ 'analysis.concurrency': 'lots' }), 'analysis.concurrency', 1)).toBe(1);
    });

    it('falls back for an unset key', () => {
        expect(numberOr(configOf({}), 'analysis.concurrency', 2)).toBe(2);
    });
});

describe('numberFrom', () => {
    it('reads a string, a number, and nothing at all', () => {
        expect(numberFrom('8192', 1)).toBe(8192);
        expect(numberFrom(8192, 1)).toBe(8192);
        expect(numberFrom(undefined, 1)).toBe(1);
        expect(numberFrom('', 1)).toBe(1);
    });

    it('falls back for a value that is not a number', () => {
        expect(numberFrom('8KB', 1)).toBe(1);
        expect(numberFrom(Number.NaN, 1)).toBe(1);
        expect(numberFrom(Number.POSITIVE_INFINITY, 1)).toBe(1);
    });

    // Zero and negatives are numbers. Whether they are SENSIBLE is the caller's question — the log
    // store clamps its own ceiling — and answering it here would silently rewrite a deliberate 0.
    it('passes through zero and negatives rather than treating them as unset', () => {
        expect(numberFrom('0', 5)).toBe(0);
        expect(numberFrom('-1', 5)).toBe(-1);
    });
});
