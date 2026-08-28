// The arithmetic behind the one line on the desk that says how long the running order has left.
// Every case here is a way of getting the figure wrong that would still LOOK right on screen: a
// plausible clock time is the most convincing kind of lie a console can tell, because nothing about
// it invites a second look.

import { describe, expect, it } from 'vitest';
import type { StationOrderItem } from '@deadair/sdk';

import { msUntilDry, runsDryAt, whatHappensThen } from '../../../src/components/onair/order.runs.dry';

const item = (overrides: Partial<StationOrderItem> = {}): StationOrderItem => ({
    id: 'item-1',
    kind: 'track',
    state: 'planned',
    title: 'Windowlicker',
    artists: ['Aphex Twin'],
    durationMs: 60_000,
    ...overrides,
});

describe('msUntilDry', () => {
    it('counts what is still to be heard, and the remainder of what is on air', () => {
        // `handed` counts: the player is holding it and it has NOT aired yet, which is the whole
        // distinction the running order is built around.
        const left = msUntilDry(
            [
                item({ id: 'a', state: 'played' }),
                item({ id: 'b', state: 'airing' }),
                item({ id: 'c', state: 'handed' }),
                item({ id: 'd', state: 'planned' }),
            ],
            30_000,
        );

        expect(left).toBe(30_000 + 60_000 + 60_000);
    });

    it('counts nothing for a talk-over, which is heard over the record after it', () => {
        // The bug this prevents is silent and cumulative: a station that talks over every boundary
        // would have its running-out time pushed out by the length of every break in the hour.
        const overIt = msUntilDry([item({ id: 'a', kind: 'segment', durationMs: 20_000, overAtMs: 5_000 }), item({ id: 'b' })], 0);

        expect(overIt).toBe(60_000);
    });

    it('counts a break that plays in the gap, because that one really is time on air', () => {
        const between = msUntilDry([item({ id: 'a', kind: 'segment', durationMs: 20_000 }), item({ id: 'b' })], 0);

        expect(between).toBe(80_000);
    });

    it('leaves out everything the station is done with', () => {
        // Six states, four of them terminal. A count that took the whole array would have a played
        // hour still ahead of the station.
        const left = msUntilDry(
            [
                item({ id: 'a', state: 'played' }),
                item({ id: 'b', state: 'skipped' }),
                item({ id: 'c', state: 'unavailable' }),
                item({ id: 'd', state: 'removed' }),
                item({ id: 'e', state: 'planned' }),
            ],
            0,
        );

        expect(left).toBe(60_000);
    });

    it('tolerates a decoder that cannot say how much is left, and a record with no length', () => {
        // Both are documented-absent rather than exceptional: `remainingMs` is absent when the
        // decoder cannot say, and `durationMs` is optional on an item throughout.
        expect(msUntilDry([item({ id: 'a' }), item({ id: 'b', durationMs: undefined })], undefined)).toBe(60_000);
    });

    it('has no answer when there is nothing ahead', () => {
        // Not zero. "Runs dry at 01:12" on an order that is already dry is a sentence about the
        // past, and the empty state is what answers this instead.
        expect(msUntilDry([item({ id: 'a', state: 'played' })], 30_000)).toBeUndefined();
        expect(msUntilDry([], 30_000)).toBeUndefined();
    });
});

describe('runsDryAt', () => {
    // `now` is built in LOCAL terms rather than from an ISO instant, because the function renders in
    // the browser's own zone on purpose: it is read against the studio clock in the corner of the
    // same screen. A UTC fixture would only pass on a machine set to UTC.
    it('reads as a 24-hour clock, like the one in the corner of the same screen', () => {
        const at = runsDryAt([item({ durationMs: 45 * 60_000 })], 15 * 60_000, new Date(2026, 7, 28, 1, 12));

        expect(at).toBe('02:12');
    });

    it('says nothing rather than a time when there is nothing ahead', () => {
        expect(runsDryAt([], 0, new Date(2026, 7, 28, 1, 12))).toBeUndefined();
    });
});

describe('whatHappensThen', () => {
    // Read off `onEnd` rather than assumed. A station set to stop goes OFF AIR at that time, and a
    // console that told its operator it would refill would be reassuring about the one fact worth
    // waking up for.
    it('does not promise a refill the station was not asked for', () => {
        expect(whatHappensThen('extend')).toMatch(/tops itself up/);
        expect(whatHappensThen('repeat')).toMatch(/starts again/);
        expect(whatHappensThen('stop')).toMatch(/off air/);
    });
});
