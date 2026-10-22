import { describe, expect, it } from 'vitest';

import { clampLimit, limitArgument } from '../../../src/modules/shared/limit.clamp.js';

describe('clampLimit', () => {
    it('holds a count between one and the ceiling, whole', () => {
        expect(clampLimit(12.7, 50)).toBe(12);
        expect(clampLimit(500, 50)).toBe(50);
        expect(clampLimit(0, 50)).toBe(1);
        expect(clampLimit(-3, 50)).toBe(1);
    });

    it('takes the ceiling for a value that is not a number', () => {
        expect(clampLimit(Number.NaN, 50)).toBe(50);
        expect(clampLimit(Number.POSITIVE_INFINITY, 50)).toBe(50);
    });
});

describe('limitArgument', () => {
    it('honours a count up to the ceiling', () => {
        expect(limitArgument(3, 10)).toBe(3);
        expect(limitArgument(3.9, 10)).toBe(3);
        expect(limitArgument(1000, 10)).toBe(10);
    });

    // The disagreement with clampLimit, and the reason there are two: a model sending 0 chose nothing.
    it('takes the ceiling for anything below one, as for a limit left out', () => {
        expect(limitArgument(0, 10)).toBe(10);
        expect(limitArgument(-1, 10)).toBe(10);
        expect(limitArgument(undefined, 10)).toBe(10);
    });

    it('does not read a number out of a string, since the schema asked for a number', () => {
        expect(limitArgument('5', 10)).toBe(10);
    });
});
