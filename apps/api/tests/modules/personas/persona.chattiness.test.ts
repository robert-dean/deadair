// How often a character talks is the third thing a sheet says about a break, and the only one of the
// three that can take the station off the air if it is got wrong. So what is tested here is mostly
// the bound rather than the arithmetic: the quietest rung has to still talk, because turning the
// station's breaks off is a station setting and a persona that could do it too would be a second
// switch able to disagree with the first, with nothing in a log saying which one held.

import { describe, expect, it } from 'vitest';

import {
    CHATTINESS_SPACING,
    DEFAULT_CHATTINESS,
    PERSONA_CHATTINESS,
    chattinessOf,
    isPersonaChattiness,
} from '../../../src/modules/personas/persona.sheet.js';

describe('the chattiness rungs', () => {
    it('never reaches silence, at any rung', () => {
        // The one bound that had to be decided before this was built rather than after.
        for (const rung of PERSONA_CHATTINESS) {
            expect(CHATTINESS_SPACING[rung]).toBeGreaterThan(0);
            expect(Number.isFinite(CHATTINESS_SPACING[rung])).toBe(true);
        }
    });

    it("leaves the station's own interval alone at the default", () => {
        expect(CHATTINESS_SPACING[DEFAULT_CHATTINESS]).toBe(1);
    });

    it('gets quieter going down and busier going up, in order', () => {
        // A multiplier on the GAP, so a bigger number is a quieter station. Asserted as a monotonic
        // walk rather than five equalities, because what a rung is worth may be retuned and the
        // order it sits in may not.
        const spacing = PERSONA_CHATTINESS.map(rung => CHATTINESS_SPACING[rung]);

        expect(spacing).toEqual([...spacing].sort((left, right) => right - left));
    });

    it('is bolder about the loud end than the quiet one', () => {
        // Halving an interval doubles the talking and doubling it only halves it, so the two sides
        // are deliberately not symmetric. The hazard on a station is a character that will not shut
        // up, and this is the assertion that says the asymmetry is meant.
        expect(CHATTINESS_SPACING.relentless).toBeLessThan(1);
        expect(CHATTINESS_SPACING.reserved).toBeGreaterThan(1);
    });
});

describe('isPersonaChattiness', () => {
    it('accepts every rung and nothing else', () => {
        // The column is plain text, so a row edited by hand must not be able to decide how often the
        // station talks.
        for (const rung of PERSONA_CHATTINESS) expect(isPersonaChattiness(rung)).toBe(true);
        expect(isPersonaChattiness('silent')).toBe(false);
        expect(isPersonaChattiness('')).toBe(false);
        expect(isPersonaChattiness(undefined)).toBe(false);
        expect(isPersonaChattiness(2)).toBe(false);
    });
});

describe('chattinessOf', () => {
    it('reads the rung a sheet names', () => {
        expect(chattinessOf({ chattiness: 'relentless' })).toBe('relentless');
    });

    it('takes the default for a sheet that says nothing', () => {
        expect(chattinessOf({})).toBe(DEFAULT_CHATTINESS);
        expect(chattinessOf(undefined)).toBe(DEFAULT_CHATTINESS);
    });

    it('takes the default for a rung nobody has heard of', () => {
        // `silent` in particular: the rung this design deliberately does not have. A hand-edited row
        // naming it gets the ordinary interval rather than a station that stops talking.
        expect(chattinessOf({ chattiness: 'silent' } as never)).toBe(DEFAULT_CHATTINESS);
    });
});
