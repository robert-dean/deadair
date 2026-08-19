// A timetable that draws one thing while the station airs another is the failure this projection
// exists to make impossible, so the assertion that matters is the second one below: it AGREES with
// the resolver, checked by asking `slotAt` about every minute in the range, including the ones no
// block claims. That is cheap only because the two share a function, and the test is pinning that
// they still do.
//
// The blocks deliberately do NOT tile any more. A schedule may leave the afternoon unclaimed, and
// what plays there is the station's sustaining source rather than a slot — a different fact, and not
// this module's to state.

import { describe, expect, it } from 'vitest';

import { project, type StationDate } from '../../../src/modules/schedule/schedule.occurrences.js';
import { slotAt, type ScheduleSlot } from '../../../src/modules/director/schedule.js';

const slot = (id: string, startsAtMinutes: number, endsAtMinutes: number, days: readonly number[] = []): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    endsAtMinutes,
    days,
    mode: 'rotation',
    onEnd: 'extend',
});

/** Wednesday 19 August 2026, which is the anchor every case below counts forward from. */
const WEDNESDAY: StationDate = { year: 2026, month: 8, day: 19, weekday: 3 };

const SUNDAY = 0;
const WEDNESDAY_DAY = 3;

const at = (hour: number, minute = 0) => hour * 60 + minute;

/** Minutes since the range began, for a `YYYY-MM-DD HH:mm:ss` stamp. */
function offsetOf(stamp: string, from: StationDate): number {
    const [date, time] = stamp.split(' ');
    const [year, month, day] = date!.split('-').map(Number);
    const [hour, minute] = time!.split(':').map(Number);

    const days = (Date.UTC(year!, month! - 1, day!) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000;
    return days * 24 * 60 + hour! * 60 + minute!;
}

const shapeOf = (blocks: { slotId: string; start: string; end: string }[]) =>
    blocks.map(block => `${block.slotId} ${block.start.slice(11, 16)}-${block.end.slice(11, 16)}`);

describe('project', () => {
    it('answers nothing for a station with no schedule', () => {
        expect(project(WEDNESDAY, 7, [])).toEqual([]);
    });

    it('draws a block once per day it runs on', () => {
        const blocks = project(WEDNESDAY, 3, [slot('breakfast', at(6), at(10))]);

        expect(blocks).toHaveLength(3);
        expect(blocks[0]).toEqual({ slotId: 'breakfast', label: 'breakfast', start: '2026-08-19 06:00:00', end: '2026-08-19 10:00:00' });
        expect(blocks[2]?.start).toBe('2026-08-21 06:00:00');
    });

    it('leaves the hours nothing claims empty', () => {
        // The whole of what changed. There is no block between ten and four, and the answer simply
        // has nothing there rather than stretching breakfast across it.
        const blocks = project(WEDNESDAY, 1, [slot('breakfast', at(6), at(10)), slot('drive', at(16), at(19))]);

        expect(shapeOf(blocks)).toEqual(['breakfast 06:00-10:00', 'drive 16:00-19:00']);
    });

    it('splits a block that runs past midnight across the two days it touches', () => {
        // A timetable draws it that way anyway, and it means no consumer ever has to clip anything.
        const blocks = project(WEDNESDAY, 2, [slot('late', at(22), at(2))]);

        // Four, not three: the FIRST morning has a tail too, from the night before the range began.
        // Each day emits what lands on it, which is what keeps every block inside the range asked
        // for — the alternative spills a tail past the end and leaves the first morning blank.
        expect(shapeOf(blocks)).toEqual(['late 00:00-02:00', 'late 22:00-00:00', 'late 00:00-02:00', 'late 22:00-00:00']);
        expect(blocks[0]?.start).toBe('2026-08-19 00:00:00');
        expect(blocks[1]?.end).toBe('2026-08-20 00:00:00');
    });

    it('lets a day-specific block sit beside an every-day one', () => {
        // No precedence rule is involved, and now no interruption either: the two blocks are simply
        // both there, on the day they share, at the times each says. That they cannot OVERLAP is
        // `ScheduleService`'s business rather than this one's.
        const slots = [slot('always', at(6), at(9)), slot('midweek', at(9), at(12), [WEDNESDAY_DAY])];

        expect(shapeOf(project(WEDNESDAY, 1, slots))).toEqual(['always 06:00-09:00', 'midweek 09:00-12:00']);
        // Thursday: the midweek show is not on, and nothing stretches to cover it.
        expect(shapeOf(project({ year: 2026, month: 8, day: 20, weekday: 4 }, 1, slots))).toEqual(['always 06:00-09:00']);
    });

    it('comes back earliest first however the slots were ordered', () => {
        const blocks = project(WEDNESDAY, 1, [slot('late', at(22), at(23)), slot('breakfast', at(6), at(10))]);

        expect(blocks.map(block => block.slotId)).toEqual(['breakfast', 'late']);
    });

    it('agrees with the resolver at every minute, including the ones nothing claims', () => {
        // The property that matters, and the gaps are half of it: a minute the projection draws
        // nothing for must be a minute the resolver answers nothing for, or the grid and the station
        // disagree about whether anything is on.
        const slots = [
            slot('breakfast', at(6), at(10)),
            slot('drive', at(16, 30), at(19)),
            slot('late', at(22), at(2)),
            slot('sunday-brunch', at(10), at(13), [SUNDAY]),
        ];
        const days = 14;
        const blocks = project(WEDNESDAY, days, slots);

        for (let minute = 0; minute < days * 24 * 60; minute += 10) {
            const covering = blocks.find(block => offsetOf(block.start, WEDNESDAY) <= minute && offsetOf(block.end, WEDNESDAY) > minute);
            const weekday = (WEDNESDAY.weekday + Math.floor(minute / (24 * 60))) % 7;

            expect(covering?.slotId).toBe(slotAt(weekday, minute % (24 * 60), slots)?.id);
        }
    });

    it('walks across a month boundary', () => {
        // Calendar arithmetic rather than adding milliseconds, so the end of a month is not a case.
        const blocks = project({ year: 2026, month: 8, day: 31, weekday: 1 }, 2, [slot('breakfast', at(6), at(10))]);

        expect(blocks.map(block => block.start)).toEqual(['2026-08-31 06:00:00', '2026-09-01 06:00:00']);
    });
});
