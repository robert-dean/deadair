import { describe, expect, it } from 'vitest';

import { isVariousArtists, maySpanArtists, namesACollection } from '../../../src/modules/director/collection.album.js';

describe('namesACollection', () => {
    it.each([
        'Greatest Hits',
        'Greatest Hits, Vol. 2',
        'Abba Gold: Greatest Hits',
        'The Best of Nina Simone',
        'Best Of The Doors',
        'The Very Best of Fleetwood Mac',
        'The Very Best',
        'The Essential Bob Dylan',
        '80s Essentials',
        'Anthology',
        'Anthology 1',
        'The Collection',
        'Collection',
        'The Ultimate Collection',
        'The Platinum Collection',
        "Now That's What I Call Music! 50",
        'Now That’s What I Call Music 12',
    ])('reads %s as a collection', album => {
        expect(namesACollection(album)).toBe(true);
    });

    // The misses are the side to err on, and each of these is a real album holding one of the words.
    it.each([
        'Rumours',
        'The Best of Both Worlds',
        'It Was the Best of Times',
        'The Best of Me',
        'Essential Tremors',
        'Private Collection',
        'Hits and Misses',
        'Now and Then',
        'Greatest',
    ])('leaves %s alone', album => {
        expect(namesACollection(album)).toBe(false);
    });
});

describe('isVariousArtists', () => {
    it.each(['Various Artists', 'various artists', 'Various', 'VA', 'V.A.', 'V/A', ' Various Artists '])('reads %s as a compiler', artist => {
        expect(isVariousArtists(artist)).toBe(true);
    });

    it.each(['Various Cruelties', 'Vampire Weekend', 'Vaya Con Dios'])('leaves %s alone', artist => {
        expect(isVariousArtists(artist)).toBe(false);
    });
});

describe('maySpanArtists', () => {
    it('asks about a title of several words', () => {
        expect(maySpanArtists('Pure Moods')).toBe(true);
    });

    it('does not ask about one word, where a shared name is coincidence', () => {
        expect(maySpanArtists('Blue')).toBe(false);
    });

    it.each(['MTV Unplugged', 'Live in Paris', 'Live at Budokan'])('does not ask about %s, where a shared name is the format', album => {
        expect(maySpanArtists(album)).toBe(false);
    });
});
