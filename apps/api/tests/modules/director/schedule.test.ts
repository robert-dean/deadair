// A schedule resolver that is wrong is a station airing the wrong show at three in the morning with
// nobody watching, so the cases below are the ones where "which block is on" is not the obvious
// answer: a block that runs past midnight, an hour nothing claims at all, and the two mornings a year
// when a wall-clock time either does not exist or happens twice.
//
// Every instant is written as a UTC one with the London reading beside it, because a test that says
// `new Date('2026-08-19T09:00')` is asserting against whatever zone the machine happens to be in.

import { describe, expect, it } from 'vitest';

import { overlap, resolveSlot, type ScheduleSlot } from '../../../src/modules/director/schedule.js';

const LONDON = 'Europe/London';

const at = (hour: number, minute = 0) => hour * 60 + minute;

const slot = (id: string, startsAtMinutes: number, endsAtMinutes: number, days: readonly number[] = []): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    endsAtMinutes,
    days,
    mode: 'rotation',
    onEnd: 'extend',
});

/** Wednesday 19 August 2026, in London. */
const WED_0200 = new Date('2026-08-19T01:00:00Z');
const WED_0800 = new Date('2026-08-19T07:00:00Z');
const WED_0900 = new Date('2026-08-19T08:00:00Z');
const WED_1200 = new Date('2026-08-19T11:00:00Z');
/** Monday 17 August 2026, the stroke of midnight in London. */
const MON_0000 = new Date('2026-08-16T23:00:00Z');

const SUNDAY = 0;
const MONDAY = 1;
const WEDNESDAY = 3;

describe('resolveSlot', () => {
    it('answers nothing when the station has no schedule', () => {
        expect(resolveSlot(WED_0900, LONDON, [])).toBeUndefined();
    });

    it('answers the block that is on', () => {
        const slots = [slot('breakfast', at(6), at(10)), slot('drive', at(16), at(19))];

        expect(resolveSlot(WED_0800, LONDON, slots)?.id).toBe('breakfast');
    });

    it('answers NOTHING in an hour no block claims', () => {
        // The whole of what changed when a slot became a block. Under the old shape breakfast ran
        // until the next slot began and there was no such thing as an unclaimed hour; now the gap is
        // a real answer, and the station plays its sustaining source there.
        const slots = [slot('breakfast', at(6), at(10)), slot('drive', at(16), at(19))];

        // Midday, between the two. Under the old shape breakfast ran until drive began and there was
        // no such thing as an unclaimed hour.
        expect(resolveSlot(WED_1200, LONDON, slots)?.id).toBeUndefined();
    });

    it('owns the minute it starts on and not the one it ends on', () => {
        // The two instants that decide whether the boundary is half-open. A block owns its start, so
        // a changeover fires ON ten rather than a minute past, and hands over AT its end rather than
        // holding the minute after it.
        const slots = [slot('morning', at(9), at(10))];

        expect(resolveSlot(new Date(WED_0900.getTime() - 60_000), LONDON, slots)?.id).toBeUndefined();
        expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBe('morning');
        expect(resolveSlot(new Date(WED_0900.getTime() + 60 * 60_000), LONDON, slots)?.id).toBeUndefined();
    });

    describe('a block that runs past midnight', () => {
        it('is still on in the small hours of the next day', () => {
            // 22:00 to 06:00, asked at two in the morning: it belongs to YESTERDAY's block, which is
            // the one case the resolver has to look back a day for.
            const slots = [slot('late', at(22), at(6))];

            expect(resolveSlot(WED_0200, LONDON, slots)?.id).toBe('late');
        });

        it('carries onto the next day only when it ran the day before', () => {
            // A Monday-night show is on in Tuesday's small hours and NOT in Wednesday's, which is the
            // thing a naive "did anything wrap" check gets wrong.
            const slots = [slot('monday-late', at(22), at(6), [MONDAY])];

            expect(resolveSlot(WED_0200, LONDON, slots)?.id).toBeUndefined();
        });

        it('is off in the hours between its end and its next start', () => {
            const slots = [slot('late', at(22), at(6))];

            expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBeUndefined();
        });
    });

    describe('a block that runs on some days only', () => {
        it('is off on a day it does not run', () => {
            const slots = [slot('weekend-brunch', at(8), at(12), [SUNDAY])];

            expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBeUndefined();
        });

        it('is on when its day comes round', () => {
            const slots = [slot('midweek', at(8), at(12), [WEDNESDAY])];

            expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBe('midweek');
        });

        it('reads the weekday in the station zone rather than the process one', () => {
            // Sunday 23:00 UTC is already Monday 00:00 in London. A resolver reading the host's clock
            // would answer with the Sunday block here on any machine running UTC.
            const slots = [slot('monday', 0, at(4), [MONDAY]), slot('sunday', 0, at(4), [SUNDAY])];

            expect(resolveSlot(MON_0000, LONDON, slots)?.id).toBe('monday');
        });
    });

    describe('daylight saving', () => {
        it('resolves the repeated hour to the same block both times round', () => {
            // 25 October 2026, the morning the clocks go back: 01:30 London happens twice, once at
            // 00:30 UTC and once at 01:30 UTC. Both must answer with the same block, or the tick
            // fires a second changeover into a show that is already on.
            const slots = [slot('overnight', at(1), at(6))];

            expect(resolveSlot(new Date('2026-10-25T00:30:00Z'), LONDON, slots)?.id).toBe('overnight');
            expect(resolveSlot(new Date('2026-10-25T01:30:00Z'), LONDON, slots)?.id).toBe('overnight');
        });

        it('lets a block starting at a time that does not exist begin at the next one that does', () => {
            // 29 March 2026, the morning the clocks go forward: London has no 01:30, so 00:30 is
            // followed by 02:00. Nothing special-cases it, because a block is compared against the
            // clock rather than scheduled as an event.
            const slots = [slot('gone', at(1, 30), at(4))];

            expect(resolveSlot(new Date('2026-03-29T00:30:00Z'), LONDON, slots)?.id).toBeUndefined();
            expect(resolveSlot(new Date('2026-03-29T02:00:00Z'), LONDON, slots)?.id).toBe('gone');
        });
    });
});

// Refused rather than resolved by precedence, so this is what decides whether an operator can save a
// schedule at all. The expensive mistakes are both about a shape that does not state the day it
// actually collides on.
describe('overlap', () => {
    it('sees two blocks sharing hours on a day they both run', () => {
        expect(overlap(slot('a', at(6), at(10)), slot('b', at(9), at(12)))).toBe(true);
    });

    it('lets blocks touch without overlapping', () => {
        // One ends exactly where the next begins, which is the ordinary way a day is filled.
        expect(overlap(slot('a', at(6), at(10)), slot('b', at(10), at(12)))).toBe(false);
    });

    it('lets the same hours run on days that do not meet', () => {
        // The whole reason overlaps can be refused rather than resolved: "the usual show, except
        // Wednesdays" is written as six days plus one, and must be saveable.
        const usual = slot('usual', at(9), at(12), [0, 1, 2, 4, 5, 6]);
        const wednesday = slot('special', at(9), at(12), [WEDNESDAY]);

        expect(overlap(usual, wednesday)).toBe(false);
    });

    it('expands an empty day list to every day', () => {
        // Otherwise an every-day block and a Wednesday one would look like they never meet.
        expect(overlap(slot('always', at(9), at(12)), slot('midweek', at(10), at(11), [WEDNESDAY]))).toBe(true);
    });

    it('catches a late block colliding with an early one on the FOLLOWING day', () => {
        // Neither row mentions a day the other runs on: Monday 22:00–02:00 spends its tail on
        // Tuesday, where a Tuesday 01:00 block is waiting. This is the collision nobody writing a
        // schedule by hand would spot, which is the reason the check expands before comparing.
        const mondayLate = slot('monday-late', at(22), at(2), [MONDAY]);
        const tuesdayEarly = slot('tuesday-early', at(1), at(3), [2]);

        expect(overlap(mondayLate, tuesdayEarly)).toBe(true);
    });

    it('lets a late block end exactly where the next morning begins', () => {
        const mondayLate = slot('monday-late', at(22), at(2), [MONDAY]);
        const tuesdayEarly = slot('tuesday-early', at(2), at(6), [2]);

        expect(overlap(mondayLate, tuesdayEarly)).toBe(false);
    });
});
