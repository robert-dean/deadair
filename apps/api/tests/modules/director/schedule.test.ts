// A schedule resolver that is wrong is a station airing the wrong show at three in the morning with
// nobody watching, so the cases below are the ones where "which slot is on" is not the obvious
// answer: nothing has started yet today, only one day of the week has a slot at all, and the two
// mornings a year when a wall-clock time either does not exist or happens twice.
//
// Every instant is written as a UTC one with the London reading beside it, because a test that says
// `new Date('2026-08-19T09:00')` is asserting against whatever zone the machine happens to be in.

import { describe, expect, it } from 'vitest';

import { resolveSlot, type ScheduleSlot } from '../../../src/modules/director/schedule.js';

const LONDON = 'Europe/London';

const slot = (id: string, startsAtMinutes: number, days: readonly number[] = []): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    days,
    mode: 'rotation',
    onEnd: 'extend',
});

const at = (hour: number, minute = 0) => hour * 60 + minute;

/** Wednesday 19 August 2026, in London. */
const WED_0200 = new Date('2026-08-19T01:00:00Z');
const WED_0800 = new Date('2026-08-19T07:00:00Z');
const WED_0900 = new Date('2026-08-19T08:00:00Z');
/** Monday 17 August 2026, the stroke of midnight in London. */
const MON_0000 = new Date('2026-08-16T23:00:00Z');

const SUNDAY = 0;
const MONDAY = 1;
const WEDNESDAY = 3;
const FRIDAY = 5;

describe('resolveSlot', () => {
    it('answers nothing when the station has no schedule', () => {
        expect(resolveSlot(WED_0900, LONDON, [])).toBeUndefined();
    });

    it('gives one slot the whole day', () => {
        const slots = [slot('all-day', at(0))];

        expect(resolveSlot(WED_0200, LONDON, slots)?.id).toBe('all-day');
        expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBe('all-day');
    });

    it('takes the latest slot that has already started', () => {
        const slots = [slot('breakfast', at(6)), slot('morning', at(9)), slot('afternoon', at(13))];

        expect(resolveSlot(WED_0800, LONDON, slots)?.id).toBe('breakfast');
        expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBe('morning');
    });

    it('starts a slot at its own minute rather than after it', () => {
        const slots = [slot('overnight', at(0)), slot('morning', at(9))];

        // 08:59 and 09:00 are the two instants that decide whether the boundary is inclusive. The
        // slot owns the minute it names, so a changeover fires ON nine rather than a minute past.
        expect(resolveSlot(new Date(WED_0900.getTime() - 60_000), LONDON, slots)?.id).toBe('overnight');
        expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBe('morning');
    });

    it('wraps past midnight, so the small hours belong to last night', () => {
        const slots = [slot('breakfast', at(6)), slot('late', at(22))];

        // Two in the morning. Nothing has started TODAY, so the answer is yesterday's last slot,
        // which is the whole reason the walk looks backwards rather than defaulting to the first.
        expect(resolveSlot(WED_0200, LONDON, slots)?.id).toBe('late');
    });

    it('does not depend on the order the slots arrive in', () => {
        const forwards = [slot('breakfast', at(6)), slot('morning', at(9))];
        const backwards = [slot('morning', at(9)), slot('breakfast', at(6))];

        expect(resolveSlot(WED_0900, LONDON, forwards)?.id).toBe(resolveSlot(WED_0900, LONDON, backwards)?.id);
    });

    describe('a slot that runs on some days only', () => {
        it('is skipped on a day it does not run', () => {
            const slots = [slot('everyday', at(6)), slot('weekend-brunch', at(10), [SUNDAY])];

            // Wednesday at nine: the Sunday slot has no claim, even though it starts later in the day.
            expect(resolveSlot(WED_0900, LONDON, slots)?.id).toBe('everyday');
        });

        it('still covers the night after it', () => {
            const slots = [slot('monday-nights', at(20), [MONDAY]), slot('wednesday-drive', at(17), [WEDNESDAY])];

            // Wednesday at two in the morning. Nothing has started today, Tuesday has nothing, and
            // Monday evening's slot has been running ever since.
            expect(resolveSlot(WED_0200, LONDON, slots)?.id).toBe('monday-nights');
        });

        it('holds all week when it is the only one there is', () => {
            const slots = [slot('wednesday-only', at(9), [WEDNESDAY])];

            // Wednesday at eight, an hour BEFORE it starts. The truthful answer is last Wednesday's,
            // which is only reachable because the walk goes a full seven days back and then takes the
            // same weekday unbounded by the clock.
            expect(resolveSlot(WED_0800, LONDON, slots)?.id).toBe('wednesday-only');
        });

        it('reads the weekday in the station zone rather than the process one', () => {
            const slots = [slot('monday', at(0), [MONDAY]), slot('sunday', at(0), [SUNDAY])];

            // Sunday 23:00 UTC is already Monday 00:00 in London. A resolver reading the host's clock
            // would answer with the Sunday slot here on any machine running UTC.
            expect(resolveSlot(MON_0000, LONDON, slots)?.id).toBe('monday');
        });

        it('answers nothing when no day of the week carries a slot the walk can reach', () => {
            // Reachable only by there being no slots at all, since any slot is reached within seven
            // days. Pinned so a future `days` value that parses to nothing cannot silently mean
            // "every day" instead of "never".
            expect(resolveSlot(WED_0900, LONDON, [slot('nobody', at(9), [])])?.id).toBe('nobody');
        });
    });

    describe('daylight saving', () => {
        it('resolves the repeated hour to the same slot both times round', () => {
            // 26 October 2026, the morning the clocks go back: 01:30 London happens twice, once at
            // 00:30 UTC and once at 01:30 UTC. Both must answer with the slot that owns 01:00, or the
            // tick fires a second changeover into a show that is already on.
            const slots = [slot('overnight', at(1)), slot('breakfast', at(6))];
            const firstTime = new Date('2026-10-25T00:30:00Z');
            const secondTime = new Date('2026-10-25T01:30:00Z');

            expect(resolveSlot(firstTime, LONDON, slots)?.id).toBe('overnight');
            expect(resolveSlot(secondTime, LONDON, slots)?.id).toBe('overnight');
        });

        it('lets a slot at a time that does not exist simply not start that day', () => {
            // 29 March 2026, the morning the clocks go forward: London has no 01:30, so 00:30 is
            // followed by 02:00. A slot at 01:30 is not skipped for the day — it is claimed by the
            // first instant at or after it, which is 02:00 — and nothing has to special-case it,
            // because the slot is compared against the clock rather than scheduled as an event.
            const slots = [slot('overnight', at(0)), slot('gone', at(1, 30))];

            expect(resolveSlot(new Date('2026-03-29T00:30:00Z'), LONDON, slots)?.id).toBe('overnight');
            expect(resolveSlot(new Date('2026-03-29T02:00:00Z'), LONDON, slots)?.id).toBe('gone');
        });
    });
});
