import type { ScheduleSlot } from '@deadair/sdk';

import { i18n } from '../../i18n/i18n.setup';

import { addDays, weekdayOf } from './schedule.day';

/**
 * Turning a drag on the grid into a change to the schedule.
 *
 * ## A block has two ends of its own, so the gestures mean what they look like
 *
 * This used to be the awkward part of the file. A slot was a START and ran until the next one began,
 * so dragging a block's lower edge moved a DIFFERENT slot, a block at the top of a column belonged to
 * the night before and could not be dragged at all, and the last block of a day had no boundary to
 * move. Every one of those went away when a slot became a block: moving one moves it, dragging an
 * edge moves that edge, and the only thing left to check is that the result does not collide with
 * something else — which the API does, in one place, for every writer.
 *
 * The one shape still worth care is a block drawn in TWO pieces because it runs past midnight. Its
 * morning half starts at midnight because the column does, not because the block does, so dragging
 * that piece is refused: the block is draggable on the day it begins.
 *
 * ## What a drag deliberately does NOT do
 *
 * A slot has one start for every day it runs on, so moving one block moves them all. That is the
 * model rather than a limitation, and the grid shows it immediately: drag Wednesday's breakfast and
 * all seven columns follow. The one exception is a slot that runs on a SINGLE day, where dragging it
 * into another column can only mean moving it to that day, and does.
 */

/** The slice of a rendered block this needs. */
export interface DraggedBlock {
    slotId: string;
    /** `YYYY-MM-DD HH:mm:ss`, station-local, as the API emitted it. */
    start: string;
    end: string;
}

/** What a gesture came to, either as a change to make or as a reason it cannot be made. */
export type SlotEdit =
    { kind: 'move'; slotId: string; startsAtMinutes: number; endsAtMinutes: number; days?: readonly number[] } | { kind: 'refused'; reason: string };

/** Minutes past midnight in a `YYYY-MM-DD HH:mm:ss` stamp. */
export function minutesOf(stamp: string): number {
    const [hour, minute] = stamp.slice(11).split(':').map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
}

/** The date half of a stamp. */
const dateOf = (stamp: string): string => stamp.slice(0, 10);

/**
 * A resized block's end, with the bottom of the column read as the midnight it stands for.
 *
 * `@mantine/schedule` ends its column at `23:59:59` and caps a resized edge at the column's last
 * minute, so dragging a block's lower edge to the bottom hands back `23:59:00`, and nothing a resize
 * can produce ever says midnight. A resized edge otherwise lands on a whole slot (15 minutes in the
 * day view, an hour in the week), so a `:59` there can only be that cap. An end the gesture did not
 * move is left alone, because a slot can genuinely end at 23:59 and resizing its top edge must not
 * stretch it by a minute.
 */
export function resizedEnd(block: DraggedBlock, newEnd: string): string {
    return newEnd !== block.end && newEnd.slice(11) === '23:59:00' ? `${addDays(dateOf(newEnd), 1)} 00:00:00` : newEnd;
}

/**
 * Whether this block begins where its slot begins, rather than being last night carrying over.
 *
 * The test is the slot's own start rather than "is it at midnight", because a slot that genuinely
 * starts at midnight is not a carry-over and must stay draggable.
 */
const beginsItsSlot = (block: DraggedBlock, slot: ScheduleSlot): boolean => minutesOf(block.start) === slot.startsAtMinutes;

/**
 * A gesture that moved either end of a block, or the whole thing.
 *
 * One function for all three now, where a start-only slot needed three. What each gesture means is
 * simply what it looks like: the block ends up where it was dropped.
 */
export function blockEdit(block: DraggedBlock, newStart: string, newEnd: string, slots: readonly ScheduleSlot[]): SlotEdit {
    const slot = slots.find(candidate => candidate.id === block.slotId);
    if (slot === undefined) return { kind: 'refused', reason: i18n.t('schedule:edits.gone') };
    if (!beginsItsSlot(block, slot)) return { kind: 'refused', reason: i18n.t('schedule:edits.carriedOver') };

    const wasOn = weekdayOf(dateOf(block.start));
    const nowOn = weekdayOf(dateOf(newStart));
    // A special is on its DATES, and a drag into another column would change its weekdays instead,
    // which is never what dragging Halloween to the 1st of November means. Its times still drag.
    if (slot.startsOn !== undefined && dateOf(newStart) !== dateOf(block.start)) {
        return { kind: 'refused', reason: i18n.t('schedule:edits.specialDates') };
    }
    // A block pinned to one day can be moved to another, because there is only one thing that could
    // mean. One running on several stays where it is: dragging Wednesday's block sideways cannot say
    // which of its days was intended.
    const movedDay = (slot.days ?? []).length === 1 && nowOn !== wasOn;

    return {
        kind: 'move',
        slotId: slot.id,
        startsAtMinutes: minutesOf(newStart),
        // A drop landing on the next midnight reads as 0, which is exactly what a block ending at
        // midnight should say — and equal ends mean a full day, which is only reachable by asking
        // for it rather than by dragging.
        endsAtMinutes: minutesOf(newEnd),
        ...(movedDay ? { days: [nowOn] } : {}),
    };
}
