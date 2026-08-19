import type { ScheduleSlot } from '@deadair/sdk';

import { weekdayOf } from './schedule.day';

/**
 * Turning a drag on the grid into a change to the schedule.
 *
 * ## A partition is a set of boundaries, which is what makes this work at all
 *
 * The scheduler thinks it is moving an EVENT with two independent ends. The schedule has no such
 * thing: a slot is a start, and where it ends is where the next one begins. Every gesture therefore
 * lands on a boundary rather than on a block, and the three of them mean three different things:
 *
 * | Gesture | What it changes |
 * | --- | --- |
 * | move a block | that slot's start |
 * | drag its TOP edge | the same thing |
 * | drag its BOTTOM edge | the start of the slot that FOLLOWS it |
 *
 * The third is the one worth staring at. Dragging the bottom of Breakfast is saying "Drive starts
 * later", so it edits a row nobody grabbed. That is not a quirk of the mapping, it is what the
 * bottom of a block IS.
 *
 * ## Two shapes have to be refused, and both are the partition showing through
 *
 * A block at the top of a column is usually LAST NIGHT carrying over, so its top edge is the start of
 * the day rather than the start of anything. And the last block of a column ends at midnight, which
 * is the end of the day rather than a boundary between two slots — the slot that actually follows it
 * begins in the next column.
 *
 * Both are refused with a sentence rather than silently ignored, because the block springs back
 * either way and an operator watching that happen deserves to know it was a rule rather than a bug.
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
export type SlotEdit = { kind: 'move'; slotId: string; startsAtMinutes: number; days?: readonly number[] } | { kind: 'refused'; reason: string };

/** Minutes past midnight in a `YYYY-MM-DD HH:mm:ss` stamp. */
export function minutesOf(stamp: string): number {
    const [hour, minute] = stamp.slice(11).split(':').map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
}

/** The date half of a stamp. */
const dateOf = (stamp: string): string => stamp.slice(0, 10);

/**
 * Whether this block begins where its slot begins, rather than being last night carrying over.
 *
 * The test is the slot's own start rather than "is it at midnight", because a slot that genuinely
 * starts at midnight is not a carry-over and must stay draggable.
 */
const beginsItsSlot = (block: DraggedBlock, slot: ScheduleSlot): boolean => minutesOf(block.start) === slot.startsAtMinutes;

/** Whether this block runs to the end of its column, where the next boundary is in the next one. */
const endsTheDay = (block: DraggedBlock): boolean => dateOf(block.end) !== dateOf(block.start);

const CARRIED_OVER =
    'That block is the night before carrying over, so its top is the start of the day rather than the start of a slot. Drag it on the day it begins.';

/** Moving a whole block, or dragging its top edge: both say the slot starts somewhere else. */
export function moveEdit(block: DraggedBlock, newStart: string, slots: readonly ScheduleSlot[]): SlotEdit {
    const slot = slots.find(candidate => candidate.id === block.slotId);
    if (slot === undefined) return { kind: 'refused', reason: 'That slot is no longer in the schedule.' };
    if (!beginsItsSlot(block, slot)) return { kind: 'refused', reason: CARRIED_OVER };

    const wasOn = weekdayOf(dateOf(block.start));
    const nowOn = weekdayOf(dateOf(newStart));
    // A slot pinned to one day can be moved to another, because there is only one thing that could
    // mean. One running on several stays where it is: dragging Wednesday's block sideways cannot say
    // which of its days was intended.
    const movedDay = (slot.days ?? []).length === 1 && nowOn !== wasOn;

    return {
        kind: 'move',
        slotId: slot.id,
        startsAtMinutes: minutesOf(newStart),
        ...(movedDay ? { days: [nowOn] } : {}),
    };
}

/**
 * Dragging the bottom edge, which moves the slot that FOLLOWS.
 *
 * The follower is found by its start rather than by position in a list: it is whichever slot runs on
 * this day and begins exactly where this block ends, which is what "the next boundary" means.
 */
export function resizeTailEdit(block: DraggedBlock, newEnd: string, slots: readonly ScheduleSlot[]): SlotEdit {
    if (endsTheDay(block)) {
        return {
            kind: 'refused',
            reason: 'That is the end of the day rather than a boundary between two slots. The slot that follows begins in the next column, so move it there.',
        };
    }

    const weekday = weekdayOf(dateOf(block.start));
    const boundary = minutesOf(block.end);
    const follower = slots.find(slot => slot.startsAtMinutes === boundary && runsOn(slot, weekday));
    if (follower === undefined) return { kind: 'refused', reason: 'Nothing starts at the end of that block, so there is no boundary to move.' };

    return { kind: 'move', slotId: follower.id, startsAtMinutes: minutesOf(newEnd) };
}

/** Whether a slot runs on a weekday. Empty `days` is every day, as everywhere else. */
const runsOn = (slot: ScheduleSlot, weekday: number): boolean => (slot.days ?? []).length === 0 || (slot.days ?? []).includes(weekday);

/**
 * Which gesture a resize was, from what actually changed.
 *
 * The scheduler reports both ends whichever edge was dragged, so the edge is inferred rather than
 * given. A move reports both as changed and never reaches here.
 */
export function resizeEdit(block: DraggedBlock, newStart: string, newEnd: string, slots: readonly ScheduleSlot[]): SlotEdit {
    return newStart === block.start ? resizeTailEdit(block, newEnd, slots) : moveEdit(block, newStart, slots);
}

/**
 * Where a split lands, given where in a block somebody clicked.
 *
 * A fraction down the block rather than a time, because that is what a click on a rendered element
 * actually knows. Snapped to the quarter hour: a schedule set to 09:07 because of where a cursor
 * happened to be is not a schedule anybody chose.
 */
export function splitAt(block: DraggedBlock, fraction: number, snapMinutes = 15): number {
    const from = minutesOf(block.start);
    // A block running to midnight ends at 1440 rather than at 0, or every split in it lands backwards.
    const to = endsTheDay(block) ? 24 * 60 : minutesOf(block.end);

    const raw = from + (to - from) * Math.min(Math.max(fraction, 0), 1);
    const snapped = Math.round(raw / snapMinutes) * snapMinutes;

    // Never onto either edge: a new slot at the same minute as the one it splits collides with it,
    // and one at the far end is the follower's own start.
    return Math.min(Math.max(snapped, from + snapMinutes), to - snapMinutes);
}
