/**
 * The station's daypart schedule: which source, which host and which brief, by the wall clock.
 *
 * Pure, and that is the whole design rather than a convenience. The ownership rule
 * (`docs/internals/director.md` § "Who owns the running order") settles it in one line: the schedule
 * is a stored document, a resolver and a timer that posts commands, and it must never become an
 * actor. Nothing here holds "the current show", because a second stateful owner of what airs is the
 * defect that document exists to remove. The live running order already says which slot it belongs
 * to, and the director is its only writer.
 *
 * ## What this is NOT
 *
 * It is not the format clock. `clock.bands.ts` anchors events INSIDE an hour (`:30 news`,
 * `every 90m ident`) and `ProductionScheduler` reads the anchored ones to commission a podcast three
 * hours before its slot. The division: **clock bands schedule what the station MAKES; this decides
 * what it PLAYS BETWEEN.** So a slot needs no sub-hour resolution and stores a start minute rather
 * than painting a grid of hours.
 *
 * ## A slot is a BLOCK, with both ends
 *
 * It used to be only a start, running until the next slot began — which made every instant land
 * somewhere and meant there was no gap to represent. That was tidy and it meant something an
 * operator does not: a single slot at six in the morning was on air around the clock for ever,
 * because nothing came after it to end it. Four separate awkwardnesses came out of that one
 * mismatch, and they are one fix rather than four workarounds.
 *
 * What it costs is a GAP, which is now a real answer rather than an impossible state. Between blocks
 * the station plays its SUSTAINING source; see `ScheduleService`. A gap is never silence, so the
 * schedule cannot stop a running station and `Stop` keeps meaning only what an operator meant by it.
 *
 * ## Blocks may not overlap, and the day mask is how you say "except Wednesdays"
 *
 * Refused rather than resolved by precedence, because the editor already lets an operator choose the
 * days: a show that is different on Wednesdays is the ordinary block running on the other six days
 * and a second block on Wednesday. That is visible on the grid, where a precedence rule would be a
 * fact about the schedule that only the code knew.
 */

import type { ChartOrder } from './chart.picks.js';
import { readClock } from './clock.bands.js';
import type { StationLineupMode, StationLineupOnEnd } from './station.lineup.js';

/** Minutes in a day, which is the space {@link ScheduleSlot.startsAtMinutes} lives in. */
export const MINUTES_IN_DAY = 24 * 60;

/** Days in a week, walked back over when nothing has started today. */
const DAYS_IN_WEEK = 7;

/**
 * Where a slot's records come from, or absent for a slot the station fills itself.
 *
 * A union rather than four optional fields, because the two arms are alternatives all the way down:
 * `PutOnAirInput` takes a playlist pair or a chart id and can make no sense of both, and the
 * difference between them is not cosmetic. A playlist names COPIES the station can already fetch; a
 * chart names RECORDS, so a changeover onto one has the station look each entry up and ingest it,
 * and a station with `rotation.discover` off can air almost none of one.
 */
export type ScheduleSlotSource = { pluginId: string; playlistId: string } | { chartId: string; chartOrder?: ChartOrder };

/** Whether a slot's source is a chart, which is the only thing `chartOrder` means anything for. */
export const isChartSource = (source: ScheduleSlotSource | undefined): source is { chartId: string; chartOrder?: ChartOrder } =>
    source !== undefined && 'chartId' in source;

/**
 * One entry in the schedule: from this time on this day, the station plays this.
 *
 * Deliberately carries a `brief` and a `personaId` and no structured GENRE or MOOD filters. The
 * brief is free text read by a model, which is how every other steering instruction in this tree
 * reaches one; a parallel bag of style constraints would be a second, weaker answer to the same
 * question, and `chart.set.generator.ts` already argues that approximating an instruction is exactly
 * what the deterministic layer is not allowed to do.
 *
 * **{@link ScheduleSlot.era} is the one exception**, and this comment used to name era among the
 * things that had no business being a field. That was wrong in one direction only: a dropdown is
 * weaker than prose for a style and STRONGER for a year, the station had already conceded as much
 * (`set.prompt.ts` tells the model never to write "80s" in a query and to pass `yearFrom`/`yearTo`
 * instead, because the words do not work and the numbers do), and there is nothing to approximate in
 * a range. What being a field buys is the DETERMINISTIC draw honouring a decade too — which prose
 * cannot do at all, since it reaches a model and nothing else.
 */
export interface ScheduleSlot {
    id: string;
    /** What the operator calls it. Becomes the broadcast's `name`. */
    label: string;
    /** Minutes past midnight in the station's zone, `0` to `1439`. */
    startsAtMinutes: number;
    /**
     * When it stops, in the same terms.
     *
     * BEFORE {@link startsAtMinutes} the block runs past midnight, which is ordinary for a late show.
     * EQUAL to it is a full twenty-four hours, and that needs no rule of its own: the wrap arithmetic
     * already covers start-to-midnight and midnight-to-start, which together are the day. A
     * zero-length block is not a thing anybody wants, so there is nothing for it to be confused with
     * — and without this a station running one show around the clock could not say so.
     */
    endsAtMinutes: number;
    /**
     * The weekdays this slot runs on, Sunday `0`. **Empty means every day**, which is the ordinary
     * case and is why it is an empty list rather than all seven: an operator who has never thought
     * about weekdays should not have to fill in a set to say so.
     */
    days: readonly number[];
    source?: ScheduleSlotSource;
    personaId?: string;
    brief?: string;
    /**
     * The period this stretch of the day plays, inclusive, as four-digit years.
     *
     * Copied onto the running order at a changeover exactly as {@link brief} is, and the same shape
     * `StationLineup` holds it in. Either end may stand alone, and a record whose year the catalog
     * does not know is eligible for any period.
     */
    era?: { from?: number; to?: number };
    /**
     * Whether somebody phones in during this stretch of the day.
     *
     * Three-way on purpose, exactly as `PutOnAirInput.callins` is: absent leaves the station's own
     * `rotation.callins` standing, which is what an operator who never thought about the phone
     * means, where `false` is this slot overruling a station that takes calls every hour. A
     * `setlist` or a `feature` takes none whatever this says, because `NO_RULES` is what those
     * modes resolve from.
     */
    callins?: boolean;
    mode: StationLineupMode;
    onEnd: StationLineupOnEnd;
}

/** Whether this slot runs on a given weekday. Empty `days` is every day. */
const runsOn = (slot: ScheduleSlot, weekday: number): boolean => slot.days.length === 0 || slot.days.includes(weekday);

/**
 * The slot in force at an instant, or `undefined` when nothing is scheduled then.
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
 * ## Daylight saving needs no special case
 *
 * A slot is a wall-clock time in the station's zone, so a spring-forward morning simply has no 01:30
 * and a slot set to it does not start that day, while an autumn morning has two and the slot resolves
 * to the same id through both. The caller compares ids, so the repeat is absorbed rather than firing
 * a second changeover.
 */
export function resolveSlot(at: Date | number, zone: string, slots: readonly ScheduleSlot[]): ScheduleSlot | undefined {
    const clock = readClock(typeof at === 'number' ? at : at.getTime(), zone);

    return slotAt(clock.weekday, clock.hour * 60 + clock.minute, slots);
}

/**
 * The slot in force at a point on the station's WEEKLY clock, rather than at an instant.
 *
 * The whole of {@link resolveSlot}'s decision, with the reading of the clock lifted out. It is split
 * because two things ask this question of different inputs and they must not be two implementations:
 * the tick asks it of an instant, and the timetable projection
 * (`modules/schedule/schedule.occurrences.ts`) asks it of every day it is drawing, where there is no
 * instant to read. A schedule that fired at one time and drew at another would be the exact failure
 * `station-intelligence.md` §6 describes for era — a filter and a badge disagreeing about the same
 * thing — and sharing the function is what makes that structurally impossible rather than merely
 * tested for.
 *
 * @param weekday - Sunday `0`, matching `Date.getDay()` and `StationClock`.
 * @param minutesOfDay - `0` to `1439`, on the station's own clock.
 */
export function slotAt(weekday: number, minutesOfDay: number, slots: readonly ScheduleSlot[]): ScheduleSlot | undefined {
    // Today's blocks, and YESTERDAY's, because a block that runs past midnight is still on. Nothing
    // further back can reach: a block is at most a day long, so two days is the whole of it.
    return (
        slots.find(slot => runsOn(slot, weekday) && covers(slot, minutesOfDay)) ??
        slots.find(slot => runsOn(slot, (weekday - 1 + DAYS_IN_WEEK) % DAYS_IN_WEEK) && wraps(slot) && minutesOfDay < slot.endsAtMinutes)
    );
}

/**
 * Whether a block is on at a minute of the day it STARTED on.
 *
 * A block that wraps past midnight is on from its start to the end of the day; the hours it claims
 * on the following morning belong to the following day and are found by the second pass above.
 */
const covers = (slot: ScheduleSlot, minutesOfDay: number): boolean =>
    wraps(slot) ? minutesOfDay >= slot.startsAtMinutes : minutesOfDay >= slot.startsAtMinutes && minutesOfDay < slot.endsAtMinutes;

/** Whether a block runs past midnight. An end EQUAL to the start is the whole day, which this covers too. */
export const wraps = (slot: ScheduleSlot): boolean => slot.endsAtMinutes <= slot.startsAtMinutes;

/** One stretch of one weekday that a block occupies. `to` is exclusive and never wraps. */
interface Occupied {
    weekday: number;
    from: number;
    to: number;
}

/**
 * Which stretches of which weekdays a block actually occupies.
 *
 * Expanded rather than compared as-is, because two of the things that make a block hard to compare
 * are independent: an empty `days` means all seven, and a block running past midnight spends its
 * tail on the FOLLOWING weekday. A late Monday show and an early Tuesday one can therefore collide
 * without sharing a day in the sense either row states, which is precisely the overlap somebody
 * writing a schedule by hand would never spot.
 */
function occupies(slot: ScheduleSlot): Occupied[] {
    const days = slot.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : slot.days;

    return days.flatMap(weekday =>
        wraps(slot)
            ? [
                  { weekday, from: slot.startsAtMinutes, to: MINUTES_IN_DAY },
                  ...(slot.endsAtMinutes > 0 ? [{ weekday: (weekday + 1) % DAYS_IN_WEEK, from: 0, to: slot.endsAtMinutes }] : []),
              ]
            : [{ weekday, from: slot.startsAtMinutes, to: slot.endsAtMinutes }],
    );
}

/**
 * Whether two blocks are ever on at the same time.
 *
 * The schedule refuses these rather than resolving them by precedence, and the reason is the editor:
 * an operator saying "the usual show, except Wednesdays" writes the usual one on the other six days
 * and a second block on Wednesday. That is visible on the grid, where a precedence rule would be a
 * fact about the schedule that only the code knew.
 */
export function overlap(left: ScheduleSlot, right: ScheduleSlot): boolean {
    const theirs = occupies(right);

    return occupies(left).some(ours => theirs.some(other => ours.weekday === other.weekday && ours.from < other.to && other.from < ours.to));
}
