import { describe, expect, it } from 'vitest';
import { REACTION_REST_BREAKS, reactionsResting } from '../../../src/modules/director/reaction.rest.js';

describe('reactionsResting', () => {
    it('rests while either of the last two breaks carried a reaction, whichever one it was', () => {
        expect(reactionsResting(['That was a lot. [sigh] Next.'])).toBe(true);
        expect(reactionsResting(['Plain.', 'Ha. [laugh] Next.'])).toBe(true);
    });

    it('offers again once two breaks in a row went without', () => {
        expect(REACTION_REST_BREAKS).toBe(2);
        expect(reactionsResting(['Plain.', 'Also plain.', 'An old one. [chuckle]'])).toBe(false);
    });

    it('offers to a presenter with nothing said lately', () => {
        expect(reactionsResting(undefined)).toBe(false);
        expect(reactionsResting([])).toBe(false);
    });

    it('does not count a bracketed run that is not a reaction', () => {
        expect(reactionsResting(['[sfx:airhorn] Next up.'])).toBe(false);
    });
});
