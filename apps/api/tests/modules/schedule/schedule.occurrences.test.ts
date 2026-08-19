// A timetable that draws one thing while the station airs another is the failure this projection
// exists to make impossible, so the assertions are about two properties rather than about shapes.
//
// It TILES: contiguous, no gaps, no overlaps, midnight to midnight. That is a property of the
// partition, and it is the whole reason the schedule stores starts rather than events.
//
// And it AGREES with the resolver, which is checked here by asking `slotAt` about every minute the
// projection claims to cover. That is cheap only because the two share a function; the test is
// pinning that they still do.

import { describe, expect, it } from 'vitest';

import { project, type StationDate } from '../../../src/modules/schedule/schedule.occurrences.js';
import { slotAt, type ScheduleSlot } from '../../../src/modules/director/schedule.js';

const slot = (id: string, startsAtMinutes: number, days: readonly number[] = []): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    days,
    mode: 'rotation',
    onEnd: 'extend',
});

/** Wednesday 19 August 2026, which is the anchor every case below counts forward from. */
const WEDNESDAY: StationDate = { year: 2026, month: 8, day: 19, weekday: 3 };

const SUNDAY = 0;
const WEDNESDAY_DAY = 3;

const at = (hour: number, minute = 0) => hour * 60 + minute;

/** Minutes since the range began, for a `YYYY-MM-DD HH:mm:ss` stamp. Dates are contiguous by construction. */
function offsetOf(stamp: string, from: StationDate): number {
    const [date, time] = stamp.split(' ');
    const [year, month, day] = date!.split('-').map(Number);
    const [hour, minute] = time!.split(':').map(Number);

    const days = (Date.UTC(year!, month! - 1, day!) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000;
    return days * 24 * 60 + hour! * 60 + minute!;
}

describe('project', () => {
    it('answers nothing for a station with no schedule', () => {
        expect(project(WEDNESDAY, 7, [])).toEqual([]);
    });

    it('gives one block a day to a single all-day slot', () => {
        const blocks = project(WEDNESDAY, 3, [slot('all-day', 0)]);

        expect(blocks).toHaveLength(3);
        expect(blocks[0]).toEqual({ slotId: 'all-day', label: 'all-day', start: '2026-08-19 00:00:00', end: '2026-08-20 00:00:00' });
        expect(blocks[2]?.end).toBe('2026-08-22 00:00:00');
    });

    it('carries the previous day into the small hours rather than leaving them blank', () => {
        // The reason the day columns are not independent. Nothing starts before six, so midnight to
        // six belongs to whatever was on last night — which on a wrapping schedule is the late slot.
        const blocks = project(WEDNESDAY, 1, [slot('breakfast', at(6)), slot('late', at(22))]);

        expect(blocks).toEqual([
            { slotId: 'late', label: 'late', start: '2026-08-19 00:00:00', end: '2026-08-19 06:00:00' },
            { slotId: 'breakfast', label: 'breakfast', start: '2026-08-19 06:00:00', end: '2026-08-19 22:00:00' },
            { slotId: 'late', label: 'late', start: '2026-08-19 22:00:00', end: '2026-08-20 00:00:00' },
        ]);
    });

    it('lets a weekday-only slot interrupt an every-day one, on its day alone', () => {
        // No precedence rule is involved and that is the point: both run on Wednesday, they sort by
        // start, and the later one simply covers until the next boundary. This is the case the
        // retired `spanOf` got wrong, because it reported one span for a slot whose span differs by
        // day.
        const slots = [slot('always', at(6)), slot('midweek', at(9), [WEDNESDAY_DAY])];
        const shape = (blocks: { slotId: string; start: string; end: string }[]) =>
            blocks.map(block => `${block.slotId} ${block.start.slice(11, 16)}-${block.end.slice(11, 16)}`);

        // Wednesday. `always` covers midnight to nine as ONE block rather than two: it was in force
        // overnight from Tuesday and it starts again at six, and since it is the same slot the
        // station never changes over there. Then the midweek show takes the rest of the day.
        expect(shape(project(WEDNESDAY, 1, slots))).toEqual(['always 00:00-09:00', 'midweek 09:00-00:00']);

        // Thursday, where the midweek show is not on: it carries overnight until `always` starts,
        // and then runs the rest of the day. The same two slots, a different shape, which is the
        // whole reason a span cannot live on the row.
        expect(shape(project({ year: 2026, month: 8, day: 20, weekday: 4 }, 1, slots))).toEqual(['midweek 00:00-06:00', 'always 06:00-00:00']);
    });

    it('never merges across midnight, however long one slot holds', () => {
        // A single slot is on continuously for a fortnight, and still comes back as one block per
        // day. Merging those would produce something a day column has to clip, and clipping is what
        // splitting per day exists to avoid.
        const blocks = project(WEDNESDAY, 14, [slot('always', at(6))]);

        expect(blocks).toHaveLength(14);
        expect(new Set(blocks.map(block => block.slotId))).toEqual(new Set(['always']));
    });

    it('treats a slot starting at midnight as the first boundary rather than adding a second', () => {
        const blocks = project(WEDNESDAY, 1, [slot('overnight', 0), slot('breakfast', at(6))]);

        expect(blocks.map(block => block.start)).toEqual(['2026-08-19 00:00:00', '2026-08-19 06:00:00']);
    });

    it('tiles the whole range with no gap and no overlap', () => {
        const slots = [slot('breakfast', at(6)), slot('drive', at(16, 30)), slot('late', at(22)), slot('sunday-brunch', at(10), [SUNDAY])];
        const days = 14;
        const blocks = project(WEDNESDAY, days, slots);

        // Starts where the range starts, ends where it ends, and every block begins exactly where
        // the one before it stopped.
        expect(offsetOf(blocks[0]!.start, WEDNESDAY)).toBe(0);
        expect(offsetOf(blocks.at(-1)!.end, WEDNESDAY)).toBe(days * 24 * 60);
        for (let index = 1; index < blocks.length; index++) {
            expect(offsetOf(blocks[index]!.start, WEDNESDAY)).toBe(offsetOf(blocks[index - 1]!.end, WEDNESDAY));
        }
    });

    it('agrees with the resolver at every minute it claims to cover', () => {
        // The property that matters. Ten-minute steps rather than every minute keeps it quick while
        // still landing either side of every boundary these slots have.
        const slots = [slot('breakfast', at(6)), slot('drive', at(16, 30)), slot('late', at(22)), slot('sunday-brunch', at(10), [SUNDAY])];
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
        const blocks = project({ year: 2026, month: 8, day: 31, weekday: 1 }, 2, [slot('all-day', 0)]);

        expect(blocks.map(block => block.start)).toEqual(['2026-08-31 00:00:00', '2026-09-01 00:00:00']);
    });
});
