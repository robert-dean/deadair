/**
 * The station's daypart schedule: which source, which host and which brief, by the wall clock.
 *
 * Pure, and that is the whole design rather than a convenience. `docs/decisions/on-air-ownership.md`
 * settles it in one line: the schedule is a stored document, a resolver and a timer that posts
 * commands, and it must never become an actor. Nothing here holds "the current show", because a
 * second stateful owner of what airs is the defect that document exists to remove. The live running
 * order already says which slot it belongs to, and the director is its only writer.
 *
 * ## What this is NOT
 *
 * It is not the format clock. `clock.bands.ts` anchors events INSIDE an hour (`:30 news`,
 * `every 90m ident`) and `ProductionScheduler` reads the anchored ones to commission a podcast three
 * hours before its slot. The division: **clock bands schedule what the station MAKES; this decides
 * what it PLAYS BETWEEN.** So a slot needs no sub-hour resolution and stores a start minute rather
 * than painting a grid of hours.
 *
 * ## Only a start is stored
 *
 * A slot runs until the next one begins, and the last one of the week wraps round to the first. So
 * every instant lands somewhere, there is no gap to represent and no overlap to resolve, and an
 * operator who wants the evening to end simply starts the next slot. `station-moment.md` wants its
 * mood bands in this same shape, which is why it is worth being deliberate about: that feature
 * should be a column here rather than a second table.
 */

import { readClock } from './clock.bands.js';
import type { StationLineupMode, StationLineupOnEnd } from './station.lineup.js';

/** Minutes in a day, which is the space {@link ScheduleSlot.startsAtMinutes} lives in. */
export const MINUTES_IN_DAY = 24 * 60;

/** Days in a week, walked back over when nothing has started today. */
const DAYS_IN_WEEK = 7;

/** Where a slot's records come from, or absent for a slot the station fills itself. */
export interface ScheduleSlotSource {
    pluginId: string;
    playlistId: string;
}

/**
 * One entry in the schedule: from this time on this day, the station plays this.
 *
 * Deliberately carries a `brief` and a `personaId` and no structured music filters. The brief is
 * free text read by a model, which is how every other steering instruction in this tree reaches one;
 * a parallel bag of genre and era constraints would be a second, weaker answer to the same question,
 * and `chart.set.generator.ts` already argues that approximating an instruction is exactly what the
 * deterministic layer is not allowed to do.
 */
export interface ScheduleSlot {
    id: string;
    /** What the operator calls it. Becomes the broadcast's `name`. */
    label: string;
    /** Minutes past midnight in the station's zone, `0` to `1439`. */
    startsAtMinutes: number;
    /**
     * The weekdays this slot runs on, Sunday `0`. **Empty means every day**, which is the ordinary
     * case and is why it is an empty list rather than all seven: an operator who has never thought
     * about weekdays should not have to fill in a set to say so.
     */
    days: readonly number[];
    source?: ScheduleSlotSource;
    personaId?: string;
    brief?: string;
    mode: StationLineupMode;
    onEnd: StationLineupOnEnd;
}

/** Whether this slot runs on a given weekday. Empty `days` is every day. */
const runsOn = (slot: ScheduleSlot, weekday: number): boolean => slot.days.length === 0 || slot.days.includes(weekday);

/**
 * The slot in force at an instant, or `undefined` when the station has no schedule.
 *
 * ## It takes an INSTANT rather than reading the clock itself
 *
 * Which is what keeps it pure and testable, and it is also the shape a look-ahead caller would want:
 * "which slot will be on when this record airs" is the same question asked of a different moment.
 *
 * **Nothing should ask it that way, and the reason is worth keeping.** A refill picking records for a
 * later airtime would straddle a boundary and disagree with a live-clock caller about which show is
 * on, and whoever wrote second would win — a boundary already crossed, seen from the wrong side. The
 * tick resolves for NOW and nothing else writes the slot onto the running order, so the disagreement
 * has nowhere to happen. Material a refill generated for the outgoing show is discarded by
 * `Rundown.retract()` at the changeover anyway, which is self-correcting and needs no look-ahead.
 *
 * ## How it walks
 *
 * The latest slot that has already started on a day it runs, looking back a day at a time. `back` is
 * inclusive of `7` on purpose: at that point it is the same weekday a week earlier, so every slot on
 * that day qualifies rather than only those before the current time. Without it, a station whose only
 * slot is Wednesday at nine would resolve to nothing from Wednesday midnight until nine, when the
 * truthful answer is that last Wednesday's slot has been in force all week.
 *
 * ## Daylight saving needs no special case
 *
 * A slot is a wall-clock time in the station's zone, so a spring-forward morning simply has no 01:30
 * and a slot set to it does not start that day, while an autumn morning has two and the slot resolves
 * to the same id through both. The caller compares ids, so the repeat is absorbed rather than firing
 * a second changeover.
 */
export function resolveSlot(at: Date | number, zone: string, slots: readonly ScheduleSlot[]): ScheduleSlot | undefined {
    if (slots.length === 0) return undefined;

    const clock = readClock(typeof at === 'number' ? at : at.getTime(), zone);
    const nowMinutes = clock.hour * 60 + clock.minute;

    for (let back = 0; back <= DAYS_IN_WEEK; back++) {
        const weekday = (clock.weekday - back + DAYS_IN_WEEK * 2) % DAYS_IN_WEEK;

        let best: ScheduleSlot | undefined;
        for (const slot of slots) {
            if (!runsOn(slot, weekday)) continue;
            // Only today's slots are bounded by the current time. A slot on an earlier day has, by
            // definition, already started.
            if (back === 0 && slot.startsAtMinutes > nowMinutes) continue;
            // Ties keep the earlier entry, so the answer is stable rather than depending on the
            // order rows came back in. Two slots at one minute on one day is an operator mistake the
            // unique index refuses anyway.
            if (best === undefined || slot.startsAtMinutes > best.startsAtMinutes) best = slot;
        }

        if (best !== undefined) return best;
    }

    return undefined;
}
