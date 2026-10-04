// The direction a genre rule matches in, held to the table in never-play-rules (Ideas #22). Each
// wrong answer here is a rule that blocks something nobody asked it to, or lets through something
// it was written to stop, and neither shows up anywhere until a listener notices.

import { describe, expect, it } from 'vitest';

import { refinesGenre, sameTag } from '../../../src/modules/director/genre.match.js';

describe('refinesGenre', () => {
    it.each([
        ['Punk Rock', 'Punk', true],
        ['Contemporary R&B', 'R&B', true],
        ['Pop', 'Pop Punk', false],
        ['Trap', 'Rap', false],
        ['punk', 'PUNK', true],
        ['Música Electrónica', 'musica electronica', true],
        ['Drum & Bass', 'drum and bass', true],
        ['Alternative Hip-Hop', 'hip hop', true],
        ['Southern Rap Rock', 'rap rock', true],
        ['Rap', 'Rap Rock', false],
        ['Rock and Roll', 'Rock', true],
    ])('%s against a rule for %s: %s', (tag, target, expected) => {
        expect(refinesGenre(tag, target)).toBe(expected);
    });

    it('matches nothing for a target with no words in it', () => {
        expect(refinesGenre('Punk', '  ')).toBe(false);
        expect(refinesGenre('Punk', '!!!')).toBe(false);
    });
});

describe('sameTag', () => {
    it('is exact once folded, since containment in a free-text namespace catches too much', () => {
        expect(sameTag('Seen Live', 'seen live')).toBe(true);
        expect(sameTag('seen live twice', 'seen live')).toBe(false);
        expect(sameTag('anything', '')).toBe(false);
    });
});
