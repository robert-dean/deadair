// Every one of these gestures lands on a BOUNDARY rather than on a block, which is the thing that
// is easy to get subtly wrong and impossible to notice: dragging the bottom of one block edits a
// different slot, and two shapes have to be refused outright because the boundary they look like
// they are moving is a day boundary rather than a slot's.

import { describe, expect, it } from 'vitest';
import type { ScheduleSlot } from '@deadair/sdk';

import { moveEdit, resizeEdit, splitAt, type DraggedBlock } from '../../../src/components/schedule/schedule.edits';

const slot = (id: string, startsAtMinutes: number, days: number[] = []): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    days,
    mode: 'rotation',
    onEnd: 'extend',
});

/** Wednesday 19 August 2026, which is what every block below is on. */
const block = (slotId: string, from: string, to: string): DraggedBlock => ({
    slotId,
    start: `2026-08-19 ${from}:00`,
    end: to === '24:00' ? '2026-08-20 00:00:00' : `2026-08-19 ${to}:00`,
});

const at = (hour: number, minute = 0) => hour * 60 + minute;

const SLOTS = [slot('breakfast', at(6)), slot('drive', at(16, 30)), slot('late', at(22))];

describe('moveEdit', () => {
    it('moves the slot the block belongs to', () => {
        expect(moveEdit(block('breakfast', '06:00', '16:30'), '2026-08-19 07:00:00', SLOTS)).toEqual({
            kind: 'move',
            slotId: 'breakfast',
            startsAtMinutes: at(7),
        });
    });

    it('refuses a block that is last night carrying over', () => {
        // Its top is midnight because the column starts there, not because `late` does. Moving it
        // would silently reinterpret the day boundary as the slot's own start.
        const carriedOver = block('late', '00:00', '06:00');

        expect(moveEdit(carriedOver, '2026-08-19 02:00:00', SLOTS)).toMatchObject({ kind: 'refused' });
    });

    it('leaves the days alone for a slot that runs on more than one', () => {
        // Dragging Wednesday's block sideways cannot say which of its days was meant, so it says
        // nothing about days at all and only moves the time.
        const edit = moveEdit(block('breakfast', '06:00', '16:30'), '2026-08-20 07:00:00', SLOTS);

        expect(edit).toEqual({ kind: 'move', slotId: 'breakfast', startsAtMinutes: at(7) });
    });

    it('moves a single-day slot to the column it was dropped in', () => {
        // Here there is only one thing it could mean.
        const slots = [slot('midweek', at(9), [3])];
        const edit = moveEdit(block('midweek', '09:00', '24:00'), '2026-08-20 09:00:00', slots);

        expect(edit).toEqual({ kind: 'move', slotId: 'midweek', startsAtMinutes: at(9), days: [4] });
    });

    it('refuses a slot that has gone from the schedule', () => {
        expect(moveEdit(block('deleted', '06:00', '16:30'), '2026-08-19 07:00:00', SLOTS)).toMatchObject({ kind: 'refused' });
    });
});

describe('resizeEdit', () => {
    it('treats a changed start as moving the slot itself', () => {
        const dragged = block('breakfast', '06:00', '16:30');

        expect(resizeEdit(dragged, '2026-08-19 07:00:00', dragged.end, SLOTS)).toEqual({
            kind: 'move',
            slotId: 'breakfast',
            startsAtMinutes: at(7),
        });
    });

    it('treats a changed end as moving the slot that FOLLOWS', () => {
        // The whole point. Dragging the bottom of breakfast is saying drive starts later, so the
        // edit lands on a row nobody grabbed.
        const dragged = block('breakfast', '06:00', '16:30');

        expect(resizeEdit(dragged, dragged.start, '2026-08-19 17:00:00', SLOTS)).toEqual({
            kind: 'move',
            slotId: 'drive',
            startsAtMinutes: at(17),
        });
    });

    it('finds the follower among the slots that run that day', () => {
        // A Sunday-only slot must not be picked as Wednesday's follower just because its start
        // matches the boundary.
        const slots = [slot('breakfast', at(6)), slot('sunday-only', at(16, 30), [0]), slot('drive', at(16, 30), [1, 2, 3, 4, 5])];
        const dragged = block('breakfast', '06:00', '16:30');

        expect(resizeEdit(dragged, dragged.start, '2026-08-19 17:00:00', slots)).toMatchObject({ slotId: 'drive' });
    });

    it('refuses the bottom of the last block of a day', () => {
        // It ends at midnight, which is where the column stops rather than where a slot starts. The
        // slot that follows begins in the next column and has to be moved there.
        const dragged = block('late', '22:00', '24:00');

        expect(resizeEdit(dragged, dragged.start, '2026-08-19 23:00:00', SLOTS)).toMatchObject({ kind: 'refused' });
    });

    it('refuses when nothing starts where the block ends', () => {
        const dragged = block('breakfast', '06:00', '16:30');

        expect(resizeEdit(dragged, dragged.start, '2026-08-19 17:00:00', [slot('breakfast', at(6))])).toMatchObject({ kind: 'refused' });
    });
});

describe('splitAt', () => {
    it('lands on the quarter hour nearest where the block was clicked', () => {
        // 06:00 to 16:30 is 630 minutes; a third of the way down is 06:00 + 210 = 09:30.
        expect(splitAt(block('breakfast', '06:00', '16:30'), 1 / 3)).toBe(at(9, 30));
    });

    it('never lands on either edge of the block it splits', () => {
        // A new slot at the same minute as the one it splits collides with it, and one at the far
        // end is simply the follower's own start.
        const dragged = block('breakfast', '06:00', '16:30');

        expect(splitAt(dragged, 0)).toBe(at(6, 15));
        expect(splitAt(dragged, 1)).toBe(at(16, 15));
    });

    it('reads a block that runs to midnight as ending at 24:00 rather than at 0', () => {
        // Otherwise every split inside the last block of a day lands before it starts.
        expect(splitAt(block('late', '22:00', '24:00'), 0.5)).toBe(at(23));
    });
});
