// `nextOccurrence` is arithmetic on a wall clock, which is where daylight saving hides: the tests
// below pin both directions of a clock change, because getting either wrong shows up twice a year
// and nowhere else. A band itself is a row now, so there is nothing here to parse — what the table
// refuses and what order it answers in is `scripts/clock.smoke.ts`.

import { describe, expect, it } from 'vitest';

import { nextOccurrence, type AnchoredBand } from '../../../src/modules/director/clock.bands.js';

const anchored = (minute: number, kind: string, hour?: number): AnchoredBand => ({
    at: 'clock',
    minute,
    kind,
    ...(hour === undefined ? {} : { hour }),
});

const LONDON = 'Europe/London';

describe('nextOccurrence', () => {
    it('finds the next top of the hour', () => {
        const from = Date.UTC(2026, 7, 13, 8, 42);

        expect(nextOccurrence(anchored(0, 'talkbreak'), from, 'UTC')).toBe(Date.UTC(2026, 7, 13, 9, 0));
    });

    it('finds the next half past, within the same hour', () => {
        const from = Date.UTC(2026, 7, 13, 8, 12);

        expect(nextOccurrence(anchored(30, 'news'), from, 'UTC')).toBe(Date.UTC(2026, 7, 13, 8, 30));
    });

    it('never answers the occurrence that is happening right now', () => {
        // Strictly after, or a band resolved on its own boundary would keep re-targeting a slot the
        // station has already gone past — and the planner asks this on every commit pass.
        const now = Date.UTC(2026, 7, 13, 9, 0);

        expect(nextOccurrence(anchored(0, 'talkbreak'), now, 'UTC')).toBe(Date.UTC(2026, 7, 13, 10, 0));
    });

    it('waits a whole day for a band pinned to an hour', () => {
        const from = Date.UTC(2026, 7, 13, 9, 30);

        expect(nextOccurrence(anchored(0, 'news', 9), from, 'UTC')).toBe(Date.UTC(2026, 7, 14, 9, 0));
    });

    it('reads the clock where the station is', () => {
        // 08:42 UTC is 09:42 in London in August, so the next top of the hour is 10:00 London,
        // which is 09:00 UTC. Read against UTC it would be an hour out.
        const from = Date.UTC(2026, 7, 13, 8, 42);

        expect(nextOccurrence(anchored(0, 'talkbreak'), from, LONDON)).toBe(Date.UTC(2026, 7, 13, 9, 0));
        expect(nextOccurrence(anchored(0, 'news', 9), from, LONDON)).toBe(Date.UTC(2026, 7, 14, 8, 0));
    });

    it('lands on the right instant through a spring-forward', () => {
        // London goes 01:00 -> 02:00 on 29 March 2026. A daily 09:00 band that morning is still a
        // real 09:00, and it is an hour earlier in UTC than the day before.
        const from = Date.UTC(2026, 2, 28, 12, 0);
        const at = nextOccurrence(anchored(0, 'news', 9), from, LONDON);

        expect(at).toBe(Date.UTC(2026, 2, 29, 8, 0));
    });

    it('lands on the right instant through an autumn fall-back', () => {
        // London goes 02:00 -> 01:00 on 25 October 2026.
        const from = Date.UTC(2026, 9, 24, 12, 0);
        const at = nextOccurrence(anchored(0, 'news', 9), from, LONDON);

        expect(at).toBe(Date.UTC(2026, 9, 25, 9, 0));
    });

    it('skips a day whose wall clock never reaches the time asked for', () => {
        // 01:30 does not exist in London on 29 March 2026: the clock jumps straight past it. The
        // band skips that day rather than landing an hour out, which is the failure that would
        // have a bulletin air at half past midnight.
        const from = Date.UTC(2026, 2, 28, 12, 0);
        const at = nextOccurrence(anchored(30, 'news', 1), from, LONDON);

        expect(at).toBe(Date.UTC(2026, 2, 30, 0, 30));
    });

    it('always answers something later than it was asked about', () => {
        // The property the planner leans on. Every hour of a fortnight, both band shapes.
        for (let hour = 0; hour < 24 * 14; hour++) {
            const from = Date.UTC(2026, 2, 20, hour, 17);

            expect(nextOccurrence(anchored(0, 'talkbreak'), from, LONDON)).toBeGreaterThan(from);
            expect(nextOccurrence(anchored(30, 'news', 9), from, LONDON)).toBeGreaterThan(from);
        }
    });
});
