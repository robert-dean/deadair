// The mapping, where the strictness lives. `exactArtist` is the one function in this plugin whose
// looseness would be invisible: a near miss does not error, it programmes an hour from a different
// artist's neighbours and every other part of the station reports success.

import { describe, expect, it } from 'vitest';

import { exactArtist, normalizeName, toArtistTracks, toSimilarArtists } from '../src/deezer.mapping.js';

describe('normalizeName', () => {
    it('folds case, accents and runs of whitespace', () => {
        expect(normalizeName('  Sigur   RÓS ')).toBe('sigur ros');
        expect(normalizeName('Beyoncé')).toBe('beyonce');
    });

    it('leaves punctuation alone, because the rest of the station does', () => {
        expect(normalizeName('AC/DC')).toBe('ac/dc');
        expect(normalizeName('AC/DC')).not.toBe(normalizeName('ACDC'));
    });
});

describe('exactArtist', () => {
    it('finds the act whatever position the search put it in', () => {
        const results = [
            { id: 1, name: 'Jeff Beck' },
            { id: 2, name: 'Beck' },
        ];

        expect(exactArtist(results, 'beck')?.id).toBe(2);
    });

    it('refuses a near miss rather than taking the most popular answer', () => {
        expect(exactArtist([{ id: 1, name: 'Jeff Beck' }], 'Beck')).toBeUndefined();
    });

    it('refuses a result with no id, which nothing could be asked about anyway', () => {
        expect(exactArtist([{ name: 'Beck' }], 'Beck')).toBeUndefined();
    });

    it('refuses an empty name instead of matching the first blank result', () => {
        expect(exactArtist([{ id: 1, name: '   ' }], '   ')).toBeUndefined();
    });
});

describe('toSimilarArtists', () => {
    it('keeps the id as an opaque providerRef and skips a nameless entry', () => {
        expect(toSimilarArtists([{ id: 5, name: 'Kalax' }, { id: 6, name: ' ' }, { name: 'No id' }])).toEqual([
            { name: 'Kalax', providerRef: '5' },
            { name: 'No id' },
        ]);
    });
});

describe('toArtistTracks', () => {
    it('takes the lead artist and leaves the contributors behind', () => {
        const mapped = toArtistTracks([
            { title: 'Get Lucky', artist: { name: 'Daft Punk' }, contributors: [{ name: 'Daft Punk' }, { name: 'Pharrell Williams' }] },
        ]);

        expect(mapped).toEqual([{ title: 'Get Lucky', artist: 'Daft Punk' }]);
    });

    it('drops a record with no title or no artist of its own', () => {
        expect(toArtistTracks([{ title: 'Orphan' }, { artist: { name: 'Nobody' } }, { title: ' ', artist: { name: 'X' } }])).toEqual([]);
    });
});
