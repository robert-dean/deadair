// A block has both its ends now, so these gestures mean what they look like and most of what used to
// be here has gone with the model that needed it. What is left is the one shape that still lies: the
// morning half of a block that ran past midnight starts at midnight because the COLUMN does, not
// because the block does, and dragging it would silently reinterpret the day boundary as the block's
// own start.

import { describe, expect, it } from 'vitest';
import type { ScheduleSlot } from '@deadair/sdk';

import { blockEdit, resizedEnd, type DraggedBlock } from '../../../src/components/schedule/schedule.edits';

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
    describe('a special', () => {
        const halloween: ScheduleSlot = { ...slot('halloween', at(20), at(23)), startsOn: '2026-10-31', endsOn: '2026-10-31', yearly: true };

        it('refuses a drag to another day, which would change its weekdays rather than its dates', () => {
            const edit = blockEdit(block('halloween', '20:00', '23:00'), '2026-08-20 20:00:00', '2026-08-20 23:00:00', [halloween]);

            expect(edit.kind).toBe('refused');
        });

        it('still lets its times be dragged on the day', () => {
            const edit = blockEdit(block('halloween', '20:00', '23:00'), '2026-08-19 21:00:00', '2026-08-19 23:30:00', [halloween]);

            expect(edit).toMatchObject({ kind: 'move', startsAtMinutes: at(21), endsAtMinutes: at(23, 30) });
        });
    });

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

    it('moves a block ending at midnight by whole minutes', () => {
        // The grid is handed the API's own end, the next day's 00:00, so a drag keeps the block's
        // length exactly: an hour earlier lands on 23:00 rather than a second short of it.
        const dragged = block('late', '22:00', '24:00');

        expect(blockEdit(dragged, '2026-08-19 21:00:00', '2026-08-19 23:00:00', SLOTS)).toMatchObject({
            startsAtMinutes: at(21),
            endsAtMinutes: at(23),
        });
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

describe('resizedEnd', () => {
    it('reads a lower edge dragged to the bottom of the column as the next midnight', () => {
        // The grid caps a resized edge at 23:59, which is the only way it says "the bottom".
        expect(resizedEnd(block('drive', '20:00', '22:00'), '2026-08-19 23:59:00')).toBe('2026-08-20 00:00:00');
    });

    it('saves that resize as a block ending at midnight', () => {
        const dragged = block('late', '22:00', '23:00');

        expect(blockEdit(dragged, dragged.start, resizedEnd(dragged, '2026-08-19 23:59:00'), SLOTS)).toMatchObject({ endsAtMinutes: 0 });
    });

    it('leaves an end the gesture did not move, even at 23:59', () => {
        // A slot can genuinely end at 23:59, and dragging its top edge hands its end back untouched.
        const dragged = block('drive', '20:00', '23:59');

        expect(resizedEnd(dragged, dragged.end)).toBe('2026-08-19 23:59:00');
    });

    it('leaves every other end as the grid sent it', () => {
        const dragged = block('drive', '20:00', '22:00');

        expect(resizedEnd(dragged, '2026-08-19 23:45:00')).toBe('2026-08-19 23:45:00');
        expect(resizedEnd(dragged, '2026-08-20 00:00:00')).toBe('2026-08-20 00:00:00');
    });
});
