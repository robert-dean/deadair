// The holder a smart-shuffle refill fills and the search tool reads. It is a container rather than
// an opinion, so what is pinned is the arithmetic it does on the way in: whole days, today as zero,
// and the most recent airing winning when a scope plans twice.

import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { AiredRecords } from '../../../src/modules/shared/aired.records.js';

describe('AiredRecords', () => {
    const now = DateTime.fromISO('2026-09-12T12:00:00Z');

    it('answers whole days ago, with today as zero', () => {
        const aired = new AiredRecords();
        aired.remember(
            new Map([
                ['a', now.minus({ hours: 3 })],
                ['b', now.minus({ days: 2, hours: 23 })],
            ]),
            now,
        );

        expect(aired.daysAgo('a')).toBe(0);
        expect(aired.daysAgo('b')).toBe(2);
        expect(aired.daysAgo('never')).toBeUndefined();
        expect(aired.size).toBe(2);
    });

    it('keeps the most recent airing when a scope reads the history twice', () => {
        const aired = new AiredRecords();
        aired.remember(new Map([['a', now.minus({ days: 5 })]]), now);
        aired.remember(new Map([['a', now.minus({ days: 1 })]]), now);
        aired.remember(new Map([['a', now.minus({ days: 9 })]]), now);

        expect(aired.daysAgo('a')).toBe(1);
    });

    it('reads an airing the clock has in the future as today', () => {
        const aired = new AiredRecords();
        aired.remember(new Map([['a', now.plus({ minutes: 5 })]]), now);

        expect(aired.daysAgo('a')).toBe(0);
    });
});
