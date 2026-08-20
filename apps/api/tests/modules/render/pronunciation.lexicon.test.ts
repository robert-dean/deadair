// The property worth holding onto here is the one that is silent when it breaks: the entries must be
// applied in ONE pass, because a per-entry replace lets one entry's output be eaten by the next,
// which reads as the list working right up until two entries happen to overlap.
//
// The parsing half of this file went with the setting it parsed. An entry is a row now, so there is
// no such thing as a malformed one.

import { describe, expect, it } from 'vitest';

import { applyPronunciations, type Pronunciation } from '../../../src/modules/render/pronunciation.lexicon.js';

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
