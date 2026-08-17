// The two properties worth holding onto here are the ones that are silent when they break. A
// malformed line must not take the rest of the list with it, because the failure would be a station
// mispronouncing every name in its library over one typo. And the entries must be applied in ONE
// pass, because a per-entry replace lets one entry's output be eaten by the next, which reads as the
// list working right up until two entries happen to overlap.

import { describe, expect, it } from 'vitest';

import {
    applyPronunciations,
    DEFAULT_PRONUNCIATIONS,
    malformedEntries,
    parsePronunciations,
    type Pronunciation,
} from '../../../src/modules/render/pronunciation.lexicon.js';

describe('parsePronunciations', () => {
    it('reads one entry per line', () => {
        expect(parsePronunciations('Sade => Shar-day\nP!nk => Pink')).toEqual([
            { written: 'Sade', spoken: 'Shar-day' },
            { written: 'P!nk', spoken: 'Pink' },
        ]);
    });

    it('restores the station’s own when the box is cleared', () => {
        expect(parsePronunciations('')).toBe(DEFAULT_PRONUNCIATIONS);
        expect(parsePronunciations(undefined)).toBe(DEFAULT_PRONUNCIATIONS);
        // A list of nothing but comments is a cleared box too, not a station that says nothing.
        expect(parsePronunciations('# off for now\n\n')).toBe(DEFAULT_PRONUNCIATIONS);
    });

    it('keeps a commented line out of the list without failing over it', () => {
        expect(parsePronunciations('# Sade => Shar-day\nP!nk => Pink')).toEqual([{ written: 'P!nk', spoken: 'Pink' }]);
    });

    it('skips a line that is not an entry and keeps the ones that are', () => {
        const entries = parsePronunciations('Sade => Shar-day\nthis line forgot the arrow\n=> nothing on the left\nP!nk => Pink');

        expect(entries).toEqual([
            { written: 'Sade', spoken: 'Shar-day' },
            { written: 'P!nk', spoken: 'Pink' },
        ]);
    });

    it('reads an empty right-hand side as “do not say this”', () => {
        expect(parsePronunciations('(Explicit) =>')).toEqual([{ written: '(Explicit)', spoken: '' }]);
    });
});

describe('malformedEntries', () => {
    it('quotes back the lines an operator should look at, and only those', () => {
        expect(malformedEntries('Sade => Shar-day\nthis line forgot the arrow\n# a comment\n\n')).toEqual(['this line forgot the arrow']);
    });
});

describe('applyPronunciations', () => {
    const say = (text: string, entries: readonly Pronunciation[]): string => applyPronunciations(text, entries);

    it('says a name the way the operator wrote it', () => {
        expect(say('Here is Sade.', [{ written: 'Sade', spoken: 'Shar-day' }])).toBe('Here is Shar-day.');
    });

    it('matches whatever case the script used', () => {
        expect(say('CHVRCHES and chvrches', [{ written: 'CHVRCHES', spoken: 'churches' }])).toBe('churches and churches');
    });

    it('matches a name made of punctuation', () => {
        const entries = [
            { written: 'P!nk', spoken: 'Pink' },
            { written: 'AC/DC', spoken: 'A C D C' },
            { written: '3OH!3', spoken: 'three oh three' },
        ];

        expect(say('P!nk, AC/DC and 3OH!3.', entries)).toBe('Pink, A C D C and three oh three.');
    });

    it('does not match inside a longer word', () => {
        expect(say('Sadeness is a different record.', [{ written: 'Sade', spoken: 'Shar-day' }])).toBe('Sadeness is a different record.');
    });

    it('prefers the longest entry that fits', () => {
        const entries = [
            { written: 'You', spoken: 'yoo' },
            { written: 'Godspeed You', spoken: 'godspeed yoo' },
        ];

        expect(say('Godspeed You there.', entries)).toBe('godspeed yoo there.');
    });

    it('takes every match from the original text, so one entry cannot feed another', () => {
        const entries = [
            { written: 'Sade', spoken: 'Shar-day' },
            { written: 'day', spoken: 'DAY' },
        ];

        // "Shar-day" came out of the first entry and is not offered to the second; the bare "day"
        // that was already in the script is.
        expect(say('Sade, every day.', entries)).toBe('Shar-day, every DAY.');
    });

    it('drops what an empty entry says to drop', () => {
        expect(say('Bad Guy (Explicit) next.', [{ written: '(Explicit)', spoken: '' }])).toBe('Bad Guy  next.');
    });

    it('leaves the text alone when there is nothing to say', () => {
        expect(say('Nothing to do here.', [])).toBe('Nothing to do here.');
        expect(say('Nothing to do here.', [{ written: '   ', spoken: 'x' }])).toBe('Nothing to do here.');
    });

    it('survives an entry that is a regular expression by accident', () => {
        expect(say('Say .*+ here', [{ written: '.*+', spoken: 'nothing' }])).toBe('Say nothing here');
    });
});
