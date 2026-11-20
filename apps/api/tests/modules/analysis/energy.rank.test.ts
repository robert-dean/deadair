import { describe, expect, it } from 'vitest';

import {
    ENERGY_CUT_POINTS,
    ENERGY_MIN_LIBRARY,
    ENERGY_MIN_POOL,
    energyOf,
    percentileRank,
    thirdsOf,
    usableCuts,
    type EnergyDistributions,
} from '../../../src/modules/analysis/energy.rank.js';

/** Cut points spread evenly from `from` to `to`, as a library measured evenly across that range would read. */
const even = (from: number, to: number): number[] =>
    Array.from({ length: ENERGY_CUT_POINTS }, (_, index) => from + ((to - from) * index) / (ENERGY_CUT_POINTS - 1));

const LIBRARY: EnergyDistributions = { loudness: even(-20, -5), brightness: even(100, 1600) };

describe('percentileRank', () => {
    it('places a value by where it falls between the cut points', () => {
        expect(percentileRank(-12.5, even(-20, -5))).toBeCloseTo(50, 6);
        expect(percentileRank(-17, even(-20, -5))).toBeCloseTo(20, 6);
    });

    it('ranks two records inside one percentile step apart', () => {
        const cuts = even(0, 100);

        expect(percentileRank(10.2, cuts)).toBeLessThan(percentileRank(10.8, cuts));
    });

    it('clamps a record past either end of the library to that end', () => {
        expect(percentileRank(-40, even(-20, -5))).toBe(0);
        expect(percentileRank(0, even(-20, -5))).toBe(100);
    });

    it('ranks a value at the top of a run of equal cut points, as the records sharing it rank', () => {
        // A third of the library at exactly -9: a record at -9 is at least a third of the way up.
        const cuts = [...even(-20, -9).slice(0, 34), ...Array.from({ length: 33 }, () => -9), ...even(-9, -5).slice(0, 34)];

        expect(cuts).toHaveLength(ENERGY_CUT_POINTS);
        expect(percentileRank(-9, cuts)).toBeGreaterThanOrEqual(65);
    });
});

describe('usableCuts', () => {
    it('refuses a distribution measured on too few records to rank against', () => {
        expect(usableCuts(even(0, 1), ENERGY_MIN_LIBRARY - 1)).toBeUndefined();
        expect(usableCuts(even(0, 1), ENERGY_MIN_LIBRARY)).toHaveLength(ENERGY_CUT_POINTS);
    });

    it('refuses a distribution of the wrong length or with a hole in it', () => {
        expect(usableCuts(even(0, 1).slice(1), 1000)).toBeUndefined();
        expect(usableCuts([Number.NaN, ...even(0, 1).slice(1)], 1000)).toBeUndefined();
        expect(usableCuts(undefined, 1000)).toBeUndefined();
    });
});

describe('energyOf', () => {
    it('averages the loudness and brightness ranks', () => {
        const energy = energyOf({ loudnessLufs: -8, brightnessHz: 400 }, LIBRARY);

        // -8 is 80% up the loudness, 400 Hz 20% up the brightness.
        expect(energy?.percentile).toBeCloseTo(50, 6);
        expect(energy?.from).toBe('loudnessAndBrightness');
    });

    it('rests on loudness alone for a record whose brightness is not measured yet', () => {
        expect(energyOf({ loudnessLufs: -8 }, LIBRARY)).toEqual({ percentile: expect.closeTo(80, 6), from: 'loudness' });
    });

    it('rests on loudness alone while too little of the library has a brightness to rank against', () => {
        const energy = energyOf({ loudnessLufs: -8, brightnessHz: 400 }, { loudness: LIBRARY.loudness });

        expect(energy).toEqual({ percentile: expect.closeTo(80, 6), from: 'loudness' });
    });

    it('has no opinion on a record with no loudness, which is silent or unmeasured', () => {
        expect(energyOf({ brightnessHz: 400 }, LIBRARY)).toBeUndefined();
        expect(energyOf(undefined, LIBRARY)).toBeUndefined();
    });

    it('has no opinion while the library is too thinly measured to rank anything', () => {
        expect(energyOf({ loudnessLufs: -8, brightnessHz: 400 }, {})).toBeUndefined();
    });

    it('turning a record up moves its energy and changing nothing else leaves it', () => {
        const quiet = energyOf({ loudnessLufs: -14, brightnessHz: 900 }, LIBRARY)!;
        const loud = energyOf({ loudnessLufs: -7, brightnessHz: 900 }, LIBRARY)!;

        expect(loud.percentile).toBeGreaterThan(quiet.percentile);
    });
});

describe('thirdsOf', () => {
    it('splits a pool into its own thirds, however high or low the whole pool sits in the library', () => {
        // A pool of dark, mid-loud records (a techno show's): all of it in the library's bottom third.
        const pool = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((key, index) => [key, 5 + index]));

        expect(Object.fromEntries(thirdsOf(pool)!)).toEqual({ a: 'low', b: 'low', c: 'medium', d: 'medium', e: 'high', f: 'high' });
    });

    it('has no opinion on a pool too small to split', () => {
        const pool = new Map(Array.from({ length: ENERGY_MIN_POOL - 1 }, (_, index) => [`r${index}`, index * 10]));

        expect(thirdsOf(pool)).toBeUndefined();
    });

    it('never puts two records with the same energy in different thirds', () => {
        const pool = new Map([
            ['a', 10],
            ['b', 20],
            ['c', 30],
            ['d', 30],
            ['e', 30],
            ['f', 90],
        ]);

        const thirds = thirdsOf(pool)!;

        expect(new Set([thirds.get('c'), thirds.get('d'), thirds.get('e')]).size).toBe(1);
    });

    it('leaves out a record with no figure rather than placing it', () => {
        const pool = new Map([...Array.from({ length: 6 }, (_, index): [string, number] => [`r${index}`, index]), ['broken', Number.NaN]]);

        const thirds = thirdsOf(pool)!;

        expect(thirds.has('broken')).toBe(false);
        expect(thirds.size).toBe(6);
    });
});
