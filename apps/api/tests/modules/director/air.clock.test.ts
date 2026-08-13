// The property that matters is the direction of the error, not the accuracy. Everything unmeasured
// counts as zero, so a projected boundary must never be LATER than the truth — a break placed on a
// boundary the projection put too late would air before the time it names, and "just after nine"
// said at four minutes to is the one failure the vague phrasing cannot absorb. So the tests below
// are mostly about which way this is allowed to be wrong.

import { describe, expect, it } from 'vitest';

import { nextBoundaryAtOrAfter, projectAirTimes } from '../../../src/modules/director/air.clock.js';
import type { StationLineupItem } from '../../../src/modules/director/station.lineup.js';

let next = 0;
const id = (): string => `item-${++next}`;

const track = (durationMs?: number, cues?: { cueInMs?: number; cueOutMs?: number }): StationLineupItem => ({
    id: id(),
    kind: 'track',
    state: 'planned',
    track: {
        pluginId: 'test',
        externalId: id(),
        title: 'A record',
        artists: ['Somebody'],
        ...(durationMs === undefined ? {} : { durationMs }),
        ...cues,
    },
});

const segment = (): StationLineupItem => ({ id: id(), kind: 'segment', state: 'planned', segmentId: id() });

const MINUTE = 60_000;
const START = Date.UTC(2026, 7, 13, 8, 45);

describe('projectAirTimes', () => {
    it('starts at the anchor and adds each length in turn', () => {
        const items = [track(3 * MINUTE), track(4 * MINUTE), track(5 * MINUTE)];

        expect(projectAirTimes(items, START, 0)).toEqual([START, START + 3 * MINUTE, START + 7 * MINUTE]);
    });

    it('says nothing about items behind the anchor', () => {
        const items = [track(3 * MINUTE), track(4 * MINUTE), track(5 * MINUTE)];
        const projected = projectAirTimes(items, START, 2);

        expect(projected[0]).toBeUndefined();
        expect(projected[1]).toBeUndefined();
        expect(projected[2]).toBe(START);
    });

    it('measures a trimmed record by what actually plays', () => {
        // Five minutes of file, thirty seconds of which is dead air the player is told to skip.
        const items = [track(5 * MINUTE, { cueInMs: 10_000, cueOutMs: 4 * MINUTE + 40_000 }), track(MINUTE)];

        expect(projectAirTimes(items, START, 0)[1]).toBe(START + 4 * MINUTE + 30_000);
    });

    it('counts an unmeasured record as no time at all', () => {
        const items = [track(undefined), track(4 * MINUTE)];

        expect(projectAirTimes(items, START, 0)).toEqual([START, START]);
    });

    it('counts a segment as no time at all, because nothing has ever measured one', () => {
        const items = [segment(), track(4 * MINUTE)];

        expect(projectAirTimes(items, START, 0)).toEqual([START, START]);
    });

    it('never projects a boundary later than the truth', () => {
        // The invariant, stated as a comparison rather than a number: whatever is unknown, the
        // projection of an order can only be at or before the projection of the same order with
        // every length known. Late is a lie; early is the phrasing being generous.
        const known = [track(4 * MINUTE), track(4 * MINUTE), track(4 * MINUTE)];
        const partly = [track(4 * MINUTE), track(undefined), track(4 * MINUTE)];

        const optimistic = projectAirTimes(partly, START, 0);
        const truth = projectAirTimes(known, START, 0);

        for (let index = 0; index < known.length; index++) {
            expect(optimistic[index]!).toBeLessThanOrEqual(truth[index]!);
        }
    });
});

describe('nextBoundaryAtOrAfter', () => {
    const items = [track(10 * MINUTE), track(10 * MINUTE), track(10 * MINUTE)];
    const projected = projectAirTimes(items, START, 0); // 08:45, 08:55, 09:05

    it('answers the first boundary at or after the target', () => {
        expect(nextBoundaryAtOrAfter(projected, Date.UTC(2026, 7, 13, 9, 0), 0)).toBe(2);
    });

    it('takes a boundary that lands exactly on the target', () => {
        expect(nextBoundaryAtOrAfter(projected, Date.UTC(2026, 7, 13, 8, 55), 0)).toBe(1);
    });

    it('never answers a boundary before the target, even when one is much closer', () => {
        // 08:55 is five minutes from nine and 09:05 is five past it. The near one is the wrong
        // answer at any distance: airing "just after nine" at 08:55 is a lie.
        const index = nextBoundaryAtOrAfter(projected, Date.UTC(2026, 7, 13, 9, 0), 0)!;
        expect(projected[index]!).toBeGreaterThanOrEqual(Date.UTC(2026, 7, 13, 9, 0));
    });

    it('will not reach back before where it was told to start', () => {
        expect(nextBoundaryAtOrAfter(projected, START, 1)).toBe(1);
    });

    it('answers nothing when the order does not reach the target', () => {
        // Not a failure: the order holds twenty minutes and the target is hours out, so nothing is
        // planted and a later pass asks again against an order that has been topped up since.
        expect(nextBoundaryAtOrAfter(projected, Date.UTC(2026, 7, 13, 23, 0), 0)).toBeUndefined();
    });

    it('skips the entries the projection said nothing about', () => {
        const behind = projectAirTimes(items, START, 1);
        expect(nextBoundaryAtOrAfter(behind, 0, 0)).toBe(1);
    });
});
