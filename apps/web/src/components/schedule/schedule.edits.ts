import type { ScheduleSlot } from '@deadair/sdk';

import { i18n } from '../../i18n/i18n.setup';

import { addDays, DAYS, minutesBetween, weekdayOf } from './schedule.day';

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
 * ## Where two blocks touch, the edge belongs to both
 *
 * A schedule with no gaps has no edge a block can move alone: pushing it out collides with the
 * neighbour, and pulling it in opens a hole nobody drew. So dragging an edge a neighbour shares moves
 * that neighbour's edge too, and the boundary between two shows goes where it was dropped. Only a
 * neighbour on exactly the same days counts, because a slot has one set of times for all of them and
 * following the drag on Wednesday would move it on a day where it touches something else. Past that,
 * the API's overlap check answers as it does for anybody.
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

/** The times one slot should have after a gesture. */
export interface SlotTimes {
    slotId: string;
    startsAtMinutes: number;
    endsAtMinutes: number;
    days?: readonly number[];
}

/** What a gesture came to, either as a change to make or as a reason it cannot be made. */
export type SlotEdit = ({ kind: 'move'; neighbour?: SlotTimes & { first: boolean } } & SlotTimes) | { kind: 'refused'; reason: string };

const MINUTES_IN_DAY = 24 * 60;

/** A count of minutes as a time of day, wherever arithmetic left it. */
const wrapped = (minutes: number): number => ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;

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
        endsAtMinutes: endAfter(block, slot, newStart, newEnd),
        ...(movedDay ? { days: [nowOn] } : {}),
    };
}

/**
 * Where a slot ends once a gesture has moved its block.
 *
 * Only a dragged lower edge says where the end IS. Anything else moves it by however far the block's
 * drawn end went, because the drawn end need not be the slot's: a block running past midnight is drawn
 * to the bottom of the column, and reading that as its end would cut it off at midnight when its top
 * edge was dragged.
 *
 * A drop landing on the next midnight reads as 0, which is exactly what a block ending at midnight
 * should say — and equal ends mean a full day, which is only reachable by asking for it rather than
 * by dragging.
 */
function endAfter(block: DraggedBlock, slot: ScheduleSlot, newStart: string, newEnd: string): number {
    if (newStart === block.start && newEnd !== block.end) return minutesOf(newEnd);
    return wrapped(slot.endsAtMinutes + minutesBetween(block.end, newEnd));
}

/** A slot's weekdays, with an empty list read as the every day it means. */
const weekdaysOf = (slot: ScheduleSlot): readonly number[] => ((slot.days ?? []).length > 0 ? (slot.days ?? []) : DAYS);

/** A slot's length in minutes, equal ends being a full day. */
const lengthOf = (slot: ScheduleSlot): number => wrapped(slot.endsAtMinutes - slot.startsAtMinutes) || MINUTES_IN_DAY;

/**
 * Whether `later` opens on the days `earlier` closes, and on no others.
 *
 * A slot's days are the days it STARTS, so one running past midnight closes on the day after each.
 */
function sharesEveryDay(earlier: ScheduleSlot, later: ScheduleSlot): boolean {
    const shift = earlier.endsAtMinutes <= earlier.startsAtMinutes ? 1 : 0;
    const closes = new Set(weekdaysOf(earlier).map(day => (day + shift) % 7));
    const opens = new Set(weekdaysOf(later));

    return closes.size === opens.size && [...opens].every(day => closes.has(day));
}

/** The weekly slot sharing this edge of `slot`, if there is one. */
function neighbourAt(edge: 'top' | 'bottom', slot: ScheduleSlot, slots: readonly ScheduleSlot[]): ScheduleSlot | undefined {
    if (slot.startsOn !== undefined) return undefined;

    return slots.find(other => {
        if (other.id === slot.id || other.startsOn !== undefined) return false;
        return edge === 'top'
            ? other.endsAtMinutes === slot.startsAtMinutes && sharesEveryDay(other, slot)
            : other.startsAtMinutes === slot.endsAtMinutes && sharesEveryDay(slot, other);
    });
}

/**
 * A dragged edge, taking a neighbour sharing that edge along with it.
 *
 * `first` says which write goes first: whichever block is giving time up, so the two never overlap
 * on the way and a second write that fails leaves a gap rather than a refusal.
 */
export function resizeEdit(block: DraggedBlock, newStart: string, newEnd: string, slots: readonly ScheduleSlot[]): SlotEdit {
    const end = resizedEnd(block, newEnd);
    const edit = blockEdit(block, newStart, end, slots);
    if (edit.kind === 'refused') return edit;

    const slot = slots.find(candidate => candidate.id === block.slotId);
    if (slot === undefined) return edit;

    const edge = newStart !== block.start ? 'top' : 'bottom';
    // The lower edge of a block running past midnight is the column's, not the slot's.
    if (edge === 'bottom' && (end === block.end || minutesOf(block.end) !== slot.endsAtMinutes)) return edit;

    const neighbour = neighbourAt(edge, slot, slots);
    if (neighbour === undefined) return edit;

    // How far the edge moved INTO the neighbour, which is negative when it moved away.
    const taken = edge === 'top' ? minutesBetween(newStart, block.start) : minutesBetween(block.end, end);
    if (taken >= lengthOf(neighbour)) return { kind: 'refused', reason: i18n.t('schedule:edits.swallowed', { name: neighbour.label }) };

    return {
        ...edit,
        neighbour: {
            slotId: neighbour.id,
            startsAtMinutes: edge === 'top' ? neighbour.startsAtMinutes : edit.endsAtMinutes,
            endsAtMinutes: edge === 'top' ? edit.startsAtMinutes : neighbour.endsAtMinutes,
            first: taken > 0,
        },
    };
}

/** The slots a move changes, in the order they have to be written. */
export function writesOf({ neighbour, slotId, startsAtMinutes, endsAtMinutes, days }: Extract<SlotEdit, { kind: 'move' }>): SlotTimes[] {
    const dragged = { slotId, startsAtMinutes, endsAtMinutes, ...(days ? { days } : {}) };
    if (neighbour === undefined) return [dragged];

    const { first, ...other } = neighbour;
    return first ? [other, dragged] : [dragged, other];
}
