// A quiet spell is said in records and enforced in the planner's walk, so the one thing worth pinning
// in isolation is the conversion: which boundary "the next N records" ends at, counted from what the
// player has not started and over records that can still be heard.

import { describe, expect, it } from 'vitest';

import { quietThrough } from '../../../src/modules/director/quiet.spell.js';
import type { StationLineupItem } from '../../../src/modules/director/station.lineup.js';

const record = (id: string, state: StationLineupItem['state'] = 'planned'): StationLineupItem =>
    ({ id, kind: 'track', state, track: { title: id, artist: 'A', artists: ['A'] } }) as unknown as StationLineupItem;
const segment = (id: string, state: StationLineupItem['state'] = 'planned'): StationLineupItem =>
    ({ id, kind: 'segment', state, segmentId: id }) as unknown as StationLineupItem;

describe('quietThrough', () => {
    it('is not quiet at zero', () => {
        expect(quietThrough([record('a')], 0)).toBeUndefined();
    });

    it('ends at the Nth record still to start, not counting the one on air', () => {
        const items = [record('a', 'played'), record('b', 'airing'), record('c', 'handed'), record('d'), record('e')];

        // c and d are the next two to start, so the first gap a break may take is after d.
        expect(quietThrough(items, 2)).toBe(3);
    });

    it('counts records only, so a break in the way does not use up the quiet', () => {
        const items = [record('a', 'airing'), segment('s1'), record('b'), segment('s2'), record('c')];

        expect(quietThrough(items, 2)).toBe(4);
    });

    it('passes over a record that will not air', () => {
        const items = [record('a', 'airing'), record('b', 'removed'), record('c', 'unavailable'), record('d')];

        expect(quietThrough(items, 1)).toBe(3);
    });

    it('covers the whole order while it holds fewer records than the quiet', () => {
        const items = [record('a', 'airing'), record('b')];

        expect(quietThrough(items, 5)).toBe(items.length);
    });

    it('counts from the top of an order nothing has started', () => {
        expect(quietThrough([record('a'), record('b'), record('c')], 2)).toBe(1);
    });
});
