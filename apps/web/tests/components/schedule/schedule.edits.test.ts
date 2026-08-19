// A block has both its ends now, so these gestures mean what they look like and most of what used to
// be here has gone with the model that needed it. What is left is the one shape that still lies: the
// morning half of a block that ran past midnight starts at midnight because the COLUMN does, not
// because the block does, and dragging it would silently reinterpret the day boundary as the block's
// own start.

import { describe, expect, it } from 'vitest';
import type { ScheduleSlot } from '@deadair/sdk';

import { blockEdit, type DraggedBlock } from '../../../src/components/schedule/schedule.edits';

const slot = (id: string, startsAtMinutes: number, endsAtMinutes: number, days: number[] = []): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    endsAtMinutes,
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

const SLOTS = [slot('breakfast', at(6), at(10)), slot('drive', at(16, 30), at(19)), slot('late', at(22), at(2))];

describe('blockEdit', () => {
    it('moves the block to where it was dropped', () => {
        const dragged = block('breakfast', '06:00', '10:00');

        expect(blockEdit(dragged, '2026-08-19 07:00:00', '2026-08-19 11:00:00', SLOTS)).toEqual({
            kind: 'move',
            slotId: 'breakfast',
            startsAtMinutes: at(7),
            endsAtMinutes: at(11),
        });
    });

    it('changes one end when only one edge moved', () => {
        // Which is the whole of what a resize now means. It used to move a DIFFERENT slot, because a
        // block's lower edge was the next slot's start.
        const dragged = block('breakfast', '06:00', '10:00');

        expect(blockEdit(dragged, dragged.start, '2026-08-19 11:00:00', SLOTS)).toMatchObject({
            slotId: 'breakfast',
            startsAtMinutes: at(6),
            endsAtMinutes: at(11),
        });
    });

    it('reads a drop on the next midnight as an end of zero', () => {
        // Which is what a block ending at midnight should say, and is how the wrap arithmetic reads
        // it everywhere else.
        const dragged = block('late', '22:00', '23:00');

        expect(blockEdit(dragged, dragged.start, '2026-08-20 00:00:00', SLOTS)).toMatchObject({ endsAtMinutes: 0 });
    });

    it('refuses the tail of a block that started the night before', () => {
        // Its top is midnight because the column starts there, not because `late` does. Moving it
        // would silently reinterpret the day boundary as the block's own start.
        const tail = block('late', '00:00', '02:00');

        expect(blockEdit(tail, '2026-08-19 01:00:00', '2026-08-19 03:00:00', SLOTS)).toMatchObject({ kind: 'refused' });
    });

    it('leaves the days alone for a block that runs on more than one', () => {
        // Dragging Wednesday's block sideways cannot say which of its days was meant, so it says
        // nothing about days at all and only moves the time.
        const edit = blockEdit(block('breakfast', '06:00', '10:00'), '2026-08-20 07:00:00', '2026-08-20 11:00:00', SLOTS);

        expect(edit).toEqual({ kind: 'move', slotId: 'breakfast', startsAtMinutes: at(7), endsAtMinutes: at(11) });
    });

    it('moves a single-day block to the column it was dropped in', () => {
        // Here there is only one thing it could mean.
        const slots = [slot('midweek', at(9), at(12), [3])];
        const edit = blockEdit(block('midweek', '09:00', '12:00'), '2026-08-20 09:00:00', '2026-08-20 12:00:00', slots);

        expect(edit).toMatchObject({ slotId: 'midweek', days: [4] });
    });

    it('refuses a block that has gone from the schedule', () => {
        expect(blockEdit(block('deleted', '06:00', '10:00'), '2026-08-19 07:00:00', '2026-08-19 11:00:00', SLOTS)).toMatchObject({
            kind: 'refused',
        });
    });
});
