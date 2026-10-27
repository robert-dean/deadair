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

    // `after` is `Date.now()` on every commit pass, so it carries milliseconds. The slot must not: the
    // offset between the wall clock and the instant was once taken from `after` itself, so 13:05:07.687
    // answered 13:40:00.687, and a slot recognised by its instant was a different slot on every pass.
    it('answers an instant on the minute whatever milliseconds it was asked with', () => {
        const from = Date.UTC(2026, 8, 15, 13, 5, 7);

        for (const ms of [0, 1, 123, 500, 687, 999]) {
            expect(nextOccurrence(anchored(40, 'podcast'), from + ms, LONDON)).toBe(Date.UTC(2026, 8, 15, 13, 40));
            expect(nextOccurrence(anchored(0, 'news', 9), from + ms, LONDON)).toBe(Date.UTC(2026, 8, 16, 8, 0));
        }
    });

    it('stays on the minute through both clock changes, whatever milliseconds it was asked with', () => {
        for (const ms of [0, 687, 999]) {
            // Spring forward, 29 March 2026, and the day whose 01:30 never happens.
            expect(nextOccurrence(anchored(0, 'news', 9), Date.UTC(2026, 2, 28, 12, 0, 0) + ms, LONDON)).toBe(Date.UTC(2026, 2, 29, 8, 0));
            expect(nextOccurrence(anchored(30, 'news', 1), Date.UTC(2026, 2, 28, 12, 0, 0) + ms, LONDON)).toBe(Date.UTC(2026, 2, 30, 0, 30));
            // Fall back, 25 October 2026.
            expect(nextOccurrence(anchored(0, 'news', 9), Date.UTC(2026, 9, 24, 12, 0, 0) + ms, LONDON)).toBe(Date.UTC(2026, 9, 25, 9, 0));
        }
    });

    it('still never answers the occurrence happening now, inside its first second', () => {
        // Truncating to the second must not turn "strictly after" into "at or after": asked at
        // 09:00:00.687, the 09:00 slot has begun and the answer is 10:00.
        const now = Date.UTC(2026, 7, 13, 9, 0, 0) + 687;

        expect(nextOccurrence(anchored(0, 'talkbreak'), now, 'UTC')).toBe(Date.UTC(2026, 7, 13, 10, 0));
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

// A news show on weekdays. The days are read on the STATION's clock, so a weekday band in London is
// judged by London's Monday whatever UTC says, and a weekend with a clock change in it is still crossed.
describe('nextOccurrence on chosen days', () => {
    const WEEKDAYS = [1, 2, 3, 4, 5];
    const onDays = (minute: number, hour: number | undefined, days: number[]): AnchoredBand => ({ ...anchored(minute, 'podcast', hour), days });

    it('passes over the weekend', () => {
        // Friday 30 October 2026, 19:00 in London (GMT by then): the six o'clock edition has gone.
        const friday = Date.UTC(2026, 9, 30, 19, 0);

        expect(nextOccurrence(onDays(0, 18, WEEKDAYS), friday, LONDON)).toBe(Date.UTC(2026, 10, 2, 18, 0));
    });

    it('crosses a weekend with the clocks going back in it', () => {
        // Friday 23 October is BST and Monday 26 is GMT, so six in the evening moves an hour in UTC.
        const friday = Date.UTC(2026, 9, 23, 18, 0);

        expect(nextOccurrence(onDays(0, 18, WEEKDAYS), friday, LONDON)).toBe(Date.UTC(2026, 9, 26, 18, 0));
    });

    it('reads the day on the station clock, not in UTC', () => {
        // 23:30 UTC on Sunday 1 November is still Sunday in London and already Monday in Auckland.
        const sunday = Date.UTC(2026, 10, 1, 23, 30);

        expect(nextOccurrence(onDays(0, undefined, [1]), sunday, LONDON)).toBe(Date.UTC(2026, 10, 2, 0, 0));
        expect(nextOccurrence(onDays(0, undefined, [1]), sunday, 'Pacific/Auckland')).toBe(Date.UTC(2026, 10, 2, 0, 0));
    });

    it('finds a band a whole week away, hourly or daily', () => {
        // Asked just after Monday's, the next Monday-only band is seven days out.
        const monday = Date.UTC(2026, 10, 2, 18, 1);

        expect(nextOccurrence(onDays(0, 18, [1]), monday, LONDON)).toBe(Date.UTC(2026, 10, 9, 18, 0));
        expect(nextOccurrence(onDays(30, undefined, [1]), Date.UTC(2026, 10, 2, 23, 31), LONDON)).toBe(Date.UTC(2026, 10, 9, 0, 30));
    });

    it('treats no days as every day', () => {
        const saturday = Date.UTC(2026, 9, 31, 12, 0);

        expect(nextOccurrence(onDays(0, 18, []), saturday, LONDON)).toBe(Date.UTC(2026, 9, 31, 18, 0));
    });
});
