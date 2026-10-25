// Reading an answer to the shortlist prompt. A number is a line of the list, an object is a record
// the model searched for, and everything else (a year, a number in prose before the array, a line the
// list does not have, a record chosen twice) is skipped rather than guessed at.

import { describe, expect, it } from 'vitest';

import { readChoices, shortlistPrompt } from '../../../src/modules/director/shortlist.prompt.js';
import type { ShortlistEntry } from '../../../src/modules/director/shortlist.js';

const LIST: ShortlistEntry[] = [
    { title: 'South of Heaven', artist: 'Slayer', trackId: 'track-1' },
    { title: 'Freezing Moon', artist: 'Mayhem', year: 1994, like: 'Behemoth' },
    { title: 'A Fine Day to Die', artist: 'Bathory', trackId: 'track-3', airedDaysAgo: 0 },
];

describe('readChoices', () => {
    it('reads the numbers of a JSON array as lines of the list, in the order given', () => {
        expect(readChoices('[3, 1]', LIST, 10)).toEqual([
            { title: 'A Fine Day to Die', artist: 'Bathory', trackId: 'track-3' },
            { title: 'South of Heaven', artist: 'Slayer', trackId: 'track-1' },
        ]);
    });

    it('keeps a searched record where it stands among the numbers', () => {
        expect(readChoices('[2, {"title": "Thriller", "artist": "Michael Jackson"}, 1]', LIST, 10).map(pick => pick.title)).toEqual([
            'Freezing Moon',
            'Thriller',
            'South of Heaven',
        ]);
    });

    it('skips a number the list does not have, a record chosen twice, and anything past the most asked for', () => {
        expect(readChoices('[9, 1, 1, 0, 2, 3]', LIST, 2).map(pick => pick.title)).toEqual(['South of Heaven', 'Freezing Moon']);
    });

    it('ignores thinking, and prose before the array', () => {
        expect(readChoices('<think>maybe 2</think>I picked 3 records: [1, 3]', LIST, 10).map(pick => pick.title)).toEqual([
            'South of Heaven',
            'A Fine Day to Die',
        ]);
    });

    it('reads a plain list when there is no array, and never a year as a choice', () => {
        expect(readChoices('2\n1 (1986)', LIST, 10).map(pick => pick.title)).toEqual(['Freezing Moon', 'South of Heaven']);
    });

    it('answers nothing for an answer with nothing it can read', () => {
        expect(readChoices('I need to search more.', LIST, 10)).toEqual([]);
        expect(readChoices('[{"title": "No artist"}]', LIST, 10)).toEqual([]);
    });
});

describe('shortlistPrompt', () => {
    it('numbers the list with only what helps choose', () => {
        const [, user] = shortlistPrompt({ count: 2, brief: 'Black metal', list: LIST }, { station: 'deadair', maxPerArtist: 2 });

        expect(user?.content).toContain('Choose 2 records');
        expect(user?.content).toContain('1. Slayer - "South of Heaven" (not played lately)');
        expect(user?.content).toContain('2. Mayhem - "Freezing Moon" (1994, like Behemoth, not played lately)');
        expect(user?.content).toContain('3. Bathory - "A Fine Day to Die" (played today)');
    });

    it('states the cap only when there is one', () => {
        const [withCap] = shortlistPrompt({ count: 1, list: LIST }, { maxPerArtist: 2 });
        const [without] = shortlistPrompt({ count: 1, list: LIST }, { maxPerArtist: 0 });

        expect(withCap?.content).toContain('At most 2 records by any one artist');
        expect(without?.content).not.toContain('At most');
    });
});
