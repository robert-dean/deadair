import { describe, expect, it } from 'vitest';

import { artistProbe, artistReadings, longestWord, titleMatches, yearsFilter } from '../src/emby.search.js';

describe('artistProbe', () => {
    it('looks an artist up by the first word, which is where the station puts them', () => {
        expect(artistProbe('Portishead Glory Box')).toBe('Portishead');
    });

    it('skips a leading article, which would match every band called The Anything', () => {
        expect(artistProbe('The Beatles Help')).toBe('Beatles');
    });

    it('keeps an article that is all there is before the title', () => {
        expect(artistProbe('The Help')).toBe('The');
    });

    it('drops punctuation stuck to the word', () => {
        expect(artistProbe('Tyler, The Creator EARFQUAKE')).toBe('Tyler');
    });

    it('has nothing to probe in one word, which cannot be an artist and a title both', () => {
        expect(artistProbe('Portishead')).toBeUndefined();
        expect(artistProbe('   ')).toBeUndefined();
    });
});

describe('artistReadings', () => {
    const artists = [
        { id: 'tyler', name: 'Tyler' },
        { id: 'creator', name: 'Tyler, The Creator' },
        { id: 'portis', name: 'Portis' },
    ];

    it('reads the artist off the front and leaves the title, longest name first', () => {
        expect(artistReadings('Tyler, The Creator EARFQUAKE', artists)).toEqual([
            { id: 'creator', rest: 'earfquake' },
            { id: 'tyler', rest: 'the creator earfquake' },
        ]);
    });

    it('matches whole words only', () => {
        expect(artistReadings('Portishead Roads', artists)).toEqual([]);
    });

    it('reads a query that is only the artist as all of their tracks', () => {
        expect(artistReadings('portis', artists)).toEqual([{ id: 'portis', rest: '' }]);
    });

    it('compares in the shared normal form, so accents and punctuation do not decide it', () => {
        expect(artistReadings('Beyonce Halo', [{ id: 'b', name: 'Beyoncé' }])).toEqual([{ id: 'b', rest: 'halo' }]);
    });
});

describe('yearsFilter', () => {
    const now = new Date('2026-10-11T00:00:00Z');

    it('is absent when no period was asked for', () => {
        expect(yearsFilter(undefined, undefined, now)).toBeUndefined();
    });

    it('lists every year of a closed period', () => {
        expect(yearsFilter(1994, 1996, now)).toBe('1994,1995,1996');
    });

    it('closes an open end at next year', () => {
        expect(yearsFilter(2025, undefined, now)).toBe('2025,2026,2027');
    });

    it('closes an open start at 1900', () => {
        expect(yearsFilter(undefined, 1901, now)).toBe('1900,1901');
    });

    it('is empty for ends that cross, which the caller answers with nothing', () => {
        expect(yearsFilter(2000, 1990, now)).toBe('');
    });
});

describe('titleMatches', () => {
    it('compares in normal form and puts an exact title before one that only contains it', () => {
        const items = [{ Name: 'Roads (Live)' }, { Name: 'Mr. Brightside' }, { Name: 'Roads' }, { Name: null }];
        expect(titleMatches(items, 'roads')).toEqual([{ Name: 'Roads' }, { Name: 'Roads (Live)' }]);
        expect(titleMatches(items, 'mr brightside')).toEqual([{ Name: 'Mr. Brightside' }]);
    });
});

describe('longestWord', () => {
    it('picks the longest word, the first of equals', () => {
        expect(longestWord('dark star')).toBe('dark');
        expect(longestWord('mr brightside')).toBe('brightside');
        expect(longestWord('')).toBeUndefined();
    });
});
