import { describe, expect, it } from 'vitest';

import { artistProbe, artistReadings, inPeriod, titleMatches } from '../src/plex.search.js';

describe('artistProbe', () => {
    it('looks an artist up by the first word, past a leading article', () => {
        expect(artistProbe('Portishead Glory Box')).toBe('Portishead');
        expect(artistProbe('The Killers Mr Brightside')).toBe('Killers');
        expect(artistProbe('Tyler, The Creator EARFQUAKE')).toBe('Tyler');
    });

    it('has nothing to probe in one word', () => {
        expect(artistProbe('Portishead')).toBeUndefined();
    });
});

describe('artistReadings', () => {
    it('reads the artist off the front, whole words only, longest name first', () => {
        const artists = [
            { id: '1', name: 'Tyler' },
            { id: '2', name: 'Tyler, The Creator' },
            { id: '3', name: 'Portis' },
        ];
        expect(artistReadings('Tyler, The Creator EARFQUAKE', artists)).toEqual([
            { id: '2', rest: 'earfquake' },
            { id: '1', rest: 'the creator earfquake' },
        ]);
        expect(artistReadings('Portishead Roads', artists)).toEqual([]);
        expect(artistReadings('portis', artists)).toEqual([{ id: '3', rest: '' }]);
    });
});

describe('titleMatches', () => {
    it('compares in normal form, exact titles first', () => {
        const items = [{ title: 'Roads (Live)' }, { title: 'Mr. Brightside' }, { title: 'Roads' }, {}];
        expect(titleMatches(items, 'roads')).toEqual([{ title: 'Roads' }, { title: 'Roads (Live)' }]);
        expect(titleMatches(items, 'mr brightside')).toEqual([{ title: 'Mr. Brightside' }]);
    });
});

describe('inPeriod', () => {
    it('admits everything when no period was asked for', () => {
        expect(inPeriod(undefined, undefined, undefined)).toBe(true);
    });

    it('admits a year inside the period, either end open', () => {
        expect(inPeriod(1994, 1990, 1999)).toBe(true);
        expect(inPeriod(1994, 1995, undefined)).toBe(false);
        expect(inPeriod(1994, undefined, 1994)).toBe(true);
    });

    it('admits no unknown year to a period', () => {
        expect(inPeriod(undefined, 1990, 1999)).toBe(false);
    });
});
