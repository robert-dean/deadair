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
 *
 * ## A special is the one precedence there is, and it is visible too
 *
 * A slot with {@link ScheduleSlot.dates} runs on those dates rather than every week, and on them it
 * WINS over the weekly schedule for its hours: Halloween night cuts into whatever usually airs then,
 * and the weekly show resumes when the special ends. That is a precedence rule, and the argument
 * above does not forbid it, because it is not a fact only the code knows: the timetable is projected
 * per date, so the special and the weekly blocks trimmed around it are both on the grid. Two specials
 * still may not overlap each other, for the original reason.
 */

import type { LyricMood } from '#modules/lyrics/lyric.moods.js';
import type { ChartOrder } from './chart.picks.js';
import { readClock } from './clock.bands.js';
import type { StationLineupMode, StationLineupOnEnd } from './station.lineup.js';

/** Minutes in a day, which is the space {@link ScheduleSlot.startsAtMinutes} lives in. */
export const MINUTES_IN_DAY = 24 * 60;

/** Days in a week, walked back over when nothing has started today. */
const DAYS_IN_WEEK = 7;

/**
 * A date on the station's own calendar, with the weekday it falls on. Sunday is `0`.
 *
 * Wall-clock throughout: a date here is a reading of the station's clock rather than an instant, which
 * is what keeps everything that walks over dates free of daylight-saving arithmetic.
 */
export interface StationDate {
    year: number;
    /** 1-12, matching {@link StationClock}. */
    month: number;
    day: number;
    weekday: number;
}

/**
 * The dates a special runs on, inclusive at both ends, as `YYYY-MM-DD`.
 *
 * `yearly` reads only the month and day of each end and repeats every year. Such a range may run past
 * New Year, which is why it is still two real dates in order (`2026-12-31` to `2027-01-01`) rather
 * than two month-days that would have to be compared the other way round.
 */
export interface SpecialDates {
    from: string;
    to: string;
    yearly: boolean;
}

/**
 * When somebody besides a slot's host is on it: on fixed weekdays, at random, or (for a co-host)
 * always. See `0077_slot_hosts.sql` for the three shapes and `slot.visits.ts` for the random one.
 */
export interface SlotPerson {
    personaId: string;
    /** The weekdays it applies on, Sunday `0`. Absent with no {@link everyN} is every night. */
    days?: readonly number[];
    /** About one occurrence in this many, at random. Exclusive with {@link days}. */
    everyN?: number;
    /** The fewest calendar days between two random appearances. Absent is half of {@link everyN}. */
    cooldownDays?: number;
}

/**
 * The most co-hosts on air beside the host on any one night: four people on a show, which is where a
 * phone-in's `MAX_CALLERS` puts the same line for the same reason. Past it the listener is meeting
 * somebody new every break and none of them is a character.
 */
export const MAX_CO_HOSTS = 3;

/** One stretch of one day, in minutes. `to` is exclusive and never past midnight. */
export interface DayPiece {
    from: number;
    to: number;
}

/**
 * Where a slot's records come from, or absent for a slot the station fills itself.
 *
 * A union rather than optional fields, because the arms are alternatives all the way down:
 * `PutOnAirInput` takes one of them and can make no sense of two, and the difference between them is
 * not cosmetic. A provider's playlist names COPIES the station can already fetch, read from the
 * provider when the block starts; a chart names RECORDS, so a changeover onto one has the station
 * look each entry up and ingest it, and a station with `rotation.discover` off can air almost none of
 * one. A playlist the station OWNS names records too, but ones its library already holds, and it is
 * read from the station's own tables: the one source whose changeover never waits on a provider.
 */
export type ScheduleSlotSource =
    { pluginId: string; playlistId: string } | { chartId: string; chartOrder?: ChartOrder } | { stationPlaylistId: string };

/** Whether a slot's source is a chart, which is the only thing `chartOrder` means anything for. */
export const isChartSource = (source: ScheduleSlotSource | undefined): source is { chartId: string; chartOrder?: ChartOrder } =>
    source !== undefined && 'chartId' in source;

/** Whether a slot's source is a playlist the station owns rather than a provider's. */
export const isStationPlaylistSource = (source: ScheduleSlotSource | undefined): source is { stationPlaylistId: string } =>
    source !== undefined && 'stationPlaylistId' in source;

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
     * The mood this stretch of the day leans into, copied onto the running order at a changeover
     * beside {@link era}. A lean and never a filter: see `director/mood.lean.ts`.
     */
    mood?: LyricMood;
    /**
     * Whether the host talks between the records during this stretch of the day.
     *
     * Absent is the mode's own answer, a rotation talking and a setlist not, as on
     * `PutOnAirInput.breaks`. `true` on a setlist is a chart countdown with a host: the talk spacing
     * comes from the station's settings and the records stay exactly as the setlist has them (see
     * `resolveRules`). A feature stays silent whatever this says.
     */
    breaks?: boolean;
    /**
     * Whether this stretch of the day is a request show, copied onto the running order's rules at a
     * changeover. Absent is no: see `StationLineupRules.requestShow`.
     */
    requestShow?: boolean;
    /** How many records follow each request on a request show. Absent is the default in `request.show.ts`. */
    requestFollowOn?: number;
    /**
     * Whether somebody phones in during this stretch of the day.
     *
     * Absent is no calls, exactly as it is on `PutOnAirInput.callins`: there is no station-wide
     * setting behind it any more (`ResolvedRules.callins` says why), and migration 0054 gave every
     * slot that leaned on one the station's answer. A `setlist` or a `feature` takes none whatever
     * this says, because `NO_RULES` is what those modes resolve from.
     */
    callins?: boolean;
    /**
     * Whether records that sound like this slot's playlist are mixed in among them.
     *
     * The same three-way as {@link callins}, and for its reason: absent leaves the station's own
     * `rotation.mixInSimilar` standing. A slot with no playlist, or a `setlist` or a `feature`,
     * never mixes whatever this says.
     */
    mixInSimilar?: boolean;
    /**
     * Whether the host says where the chart placed each record it named.
     *
     * Absent is yes, as it is on `PutOnAirInput.chartPositions`; see
     * `StationLineupRules.chartPositions` for why there is no station setting behind it. Only a
     * slot whose source is a chart, or a rotation that takes a chart's share, has anything to say.
     */
    chartPositions?: boolean;
    /**
     * The dates this slot runs on, which makes it a SPECIAL. Absent is an ordinary weekly slot.
     *
     * {@link days} still applies inside the range, so "the Fridays in December" is a range and a mask.
     * On its dates a special wins over the weekly schedule for its hours; see the module note.
     */
    dates?: SpecialDates;
    /**
     * Hosts who sit in for {@link personaId} on some nights, in precedence order: on fixed weekdays,
     * or at random. Absent or empty is the ordinary slot, presented by its own host every time.
     */
    guestHosts?: readonly SlotPerson[];
    /**
     * Who presents BESIDE the host, in order: every night, on fixed nights, or as a visitor who turns
     * up at random. At most {@link MAX_CO_HOSTS} are on any one night. Absent or empty is a slot
     * presented by one voice.
     */
    coHosts?: readonly SlotPerson[];
    mode: StationLineupMode;
    onEnd: StationLineupOnEnd;
}

/** Whether this slot runs on a given weekday. Empty `days` is every day. */
const runsOn = (slot: ScheduleSlot, weekday: number): boolean => slot.days.length === 0 || slot.days.includes(weekday);

/** Whether a slot is a special, running on dates rather than every week. */
export const isSpecial = (slot: ScheduleSlot): slot is ScheduleSlot & { dates: SpecialDates } => slot.dates !== undefined;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** A station date as `YYYY-MM-DD`, the shape {@link SpecialDates} holds and compares as strings. */
export const dateKey = (date: Pick<StationDate, 'year' | 'month' | 'day'>): string => `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;

/**
 * A `YYYY-MM-DD` string as a station date, or `undefined` when it is not one.
 *
 * Through UTC, which is safe because this is civil arithmetic on a date rather than a claim about a
 * moment: UTC has no daylight saving, so it is the calendar with no opinions. The weekday is DERIVED
 * here rather than taken from anybody, since it is the one field a caller could get wrong in a way
 * that silently resolves the wrong show.
 */
export function stationDateOf(key: string): StationDate | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) return undefined;

    const asUtc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (dateKey({ year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate() }) !== key) return undefined;

    return { year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate(), weekday: asUtc.getUTCDay() };
}

/** The day `offset` days from `date` on the station's calendar. Plain civil arithmetic; see {@link stationDateOf}. */
export function addDays(date: StationDate, offset: number): StationDate {
    const asUtc = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));

    return {
        year: asUtc.getUTCFullYear(),
        month: asUtc.getUTCMonth() + 1,
        day: asUtc.getUTCDate(),
        weekday: (((date.weekday + offset) % DAYS_IN_WEEK) + DAYS_IN_WEEK) % DAYS_IN_WEEK,
    };
}

/**
 * Whether a date falls inside a special's range.
 *
 * A yearly range compares month and day only, and one whose end comes before its start in the year
 * runs past New Year: from the start to the end of December, then from January to the end.
 */
function inRange(dates: SpecialDates, date: StationDate): boolean {
    if (!dates.yearly) {
        const key = dateKey(date);
        return key >= dates.from && key <= dates.to;
    }

    const monthDay = dateKey(date).slice(5);
    const [from, to] = [dates.from.slice(5), dates.to.slice(5)];

    return from <= to ? monthDay >= from && monthDay <= to : monthDay >= from || monthDay <= to;
}

/**
 * Whether a slot STARTS an occurrence on this date: on one of its weekdays and, for a special, inside
 * its range. A block that runs past midnight is still "on" the following morning without starting
 * there, which is what {@link piecesOn} adds.
 */
export function startsOn(slot: ScheduleSlot, date: StationDate): boolean {
    return runsOn(slot, date.weekday) && (slot.dates === undefined || inRange(slot.dates, date));
}

/**
 * The stretches of one date a slot occupies, ignoring every other slot.
 *
 * At most two: the tail of last night's block that ran past midnight, and today's own, cut off at
 * midnight when it runs past it. The resolver, the timetable and the overlap check all ask this one
 * function, so they cannot disagree about where a block is.
 */
export function piecesOn(slot: ScheduleSlot, date: StationDate): DayPiece[] {
    const pieces: DayPiece[] = [];

    if (wraps(slot) && slot.endsAtMinutes > 0 && startsOn(slot, addDays(date, -1))) pieces.push({ from: 0, to: slot.endsAtMinutes });
    if (startsOn(slot, date)) pieces.push({ from: slot.startsAtMinutes, to: wraps(slot) ? MINUTES_IN_DAY : slot.endsAtMinutes });

    return pieces;
}

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

    return slotOn(clock, clock.hour * 60 + clock.minute, slots);
}

/**
 * The date the occurrence of `slot` in force at `at` began on: today, or yesterday for the tail of
 * a block that ran past midnight. `slot` must be the one in force, as for {@link minutesIntoSlot}.
 *
 * It is what tells one night of a slot from the next, which the slot id alone cannot: a block that
 * runs straight through midnight into its next run is the same id on both nights, and a guest host
 * on the second has to take over at its start.
 */
export function occurrenceOf(slot: ScheduleSlot, at: Date | number, zone: string): StationDate {
    const clock = readClock(typeof at === 'number' ? at : at.getTime(), zone);
    const today: StationDate = { year: clock.year, month: clock.month, day: clock.day, weekday: clock.weekday };
    const minute = clock.hour * 60 + clock.minute;

    const startedToday = startsOn(slot, today) && minute >= slot.startsAtMinutes && (wraps(slot) || minute < slot.endsAtMinutes);

    return startedToday ? today : addDays(today, -1);
}

/**
 * The slot in force at a minute of a date on the station's clock.
 *
 * A special covering that minute first, then the weekly schedule through {@link slotAt}: on its dates
 * a special wins for its hours, and the weekly show it interrupted is answered again the minute it
 * ends. The timetable asks the same question per date through `project`, which shares
 * {@link piecesOn} with this, so a special cannot be on the grid at one time and on air at another.
 */
export function slotOn(date: StationDate, minutesOfDay: number, slots: readonly ScheduleSlot[]): ScheduleSlot | undefined {
    const special = slots.find(slot => isSpecial(slot) && piecesOn(slot, date).some(piece => piece.from <= minutesOfDay && minutesOfDay < piece.to));

    return special ?? slotAt(date.weekday, minutesOfDay, slots);
}

/**
 * How many whole minutes ago a slot that is in force at `at` began, on the station's clock.
 *
 * Asked only of the slot {@link resolveSlot} answered for the same instant, so "in force" is a
 * precondition rather than something checked here: a block that started yesterday evening and runs
 * past midnight is still counted from yesterday's start, which is what the wrap below does.
 *
 * Whole minutes because a slot is only ever stated in minutes, and the tick asking this runs once a
 * minute. A spring-forward morning makes the answer an hour too large for a block spanning the jump
 * and an autumn one an hour too small, and neither matters to its only caller, which compares it
 * against a few minutes and takes the smaller of this and a second, wall-clock-free measurement.
 */
export function minutesIntoSlot(slot: ScheduleSlot, at: Date | number, zone: string): number {
    const clock = readClock(typeof at === 'number' ? at : at.getTime(), zone);

    return (clock.hour * 60 + clock.minute - slot.startsAtMinutes + MINUTES_IN_DAY) % MINUTES_IN_DAY;
}

/**
 * How many whole minutes of `slot` are left at `at`, on the station's clock.
 *
 * Its length less {@link minutesIntoSlot}, with that function's precondition (the slot is in force at
 * `at`) and its daylight-saving caveat: the answer is an hour out across a clock change, which its
 * caller, cutting a chart to fit, absorbs as a countdown that ends early or a little late.
 */
export function minutesLeftInSlot(slot: ScheduleSlot, at: Date | number, zone: string): number {
    const length = wraps(slot) ? slot.endsAtMinutes + MINUTES_IN_DAY - slot.startsAtMinutes : slot.endsAtMinutes - slot.startsAtMinutes;

    return Math.max(0, length - minutesIntoSlot(slot, at, zone));
}

/**
 * The slot in force at a point on the station's WEEKLY clock, rather than at an instant.
 *
 * The whole of {@link resolveSlot}'s decision, with the reading of the clock lifted out. It is split
 * because two things ask this question of different inputs and they must not be two implementations:
 * the tick asks it of an instant, and the timetable projection
 * (`modules/schedule/schedule.occurrences.ts`) asks it of every day it is drawing, where there is no
 * instant to read. A schedule that fired at one time and drew at another would be the exact failure
 * [station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §6 describes for era — a filter and a badge disagreeing about the same
 * thing — and sharing the function is what makes that structurally impossible rather than merely
 * tested for.
 *
 * **Weekly slots only.** A special has dates, which a point on the weekly clock does not, so it is
 * skipped here and answered by {@link slotOn} instead.
 *
 * @param weekday - Sunday `0`, matching `Date.getDay()` and `StationClock`.
 * @param minutesOfDay - `0` to `1439`, on the station's own clock.
 */
export function slotAt(weekday: number, minutesOfDay: number, slots: readonly ScheduleSlot[]): ScheduleSlot | undefined {
    const weekly = slots.filter(slot => !isSpecial(slot));

    // Today's blocks, and YESTERDAY's, because a block that runs past midnight is still on. Nothing
    // further back can reach: a block is at most a day long, so two days is the whole of it.
    return (
        weekly.find(slot => runsOn(slot, weekday) && covers(slot, minutesOfDay)) ??
        weekly.find(slot => runsOn(slot, (weekday - 1 + DAYS_IN_WEEK) % DAYS_IN_WEEK) && wraps(slot) && minutesOfDay < slot.endsAtMinutes)
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
 * Whether two blocks are ever on at the same time, in a way the schedule refuses.
 *
 * The schedule refuses these rather than resolving them by precedence, and the reason is the editor:
 * an operator saying "the usual show, except Wednesdays" writes the usual one on the other six days
 * and a second block on Wednesday. That is visible on the grid, where a precedence rule would be a
 * fact about the schedule that only the code knew.
 *
 * A special against a weekly block is never a clash: cutting into the weekly schedule is what a
 * special is FOR, and the module note says why that precedence is allowed. Two specials are compared
 * date by date, since two ranges that share no date cannot collide whatever their hours.
 */
export function overlap(left: ScheduleSlot, right: ScheduleSlot): boolean {
    if (isSpecial(left) !== isSpecial(right)) return false;
    if (isSpecial(left) && isSpecial(right)) return specialsClash(left, right);

    const theirs = occupies(right);

    return occupies(left).some(ours => theirs.some(other => ours.weekday === other.weekday && ours.from < other.to && other.from < ours.to));
}

/** A yearly range compared against another yearly one is compared across a leap year and both New Years around it. */
const YEARLY_WINDOW = { from: '2027-12-31', to: '2029-01-01' };

/**
 * Whether two specials are ever on at the same time.
 *
 * Walked date by date over the only dates they could share, asking {@link piecesOn} of each: the
 * same function the resolver and the timetable use, so the check cannot disagree with either about
 * where a block is. A fixed range bounds the walk (plus the day after, for a tail past its last
 * midnight); two yearly ones are walked over {@link YEARLY_WINDOW}, which holds every month-day once
 * including the 29th of February.
 */
function specialsClash(left: ScheduleSlot & { dates: SpecialDates }, right: ScheduleSlot & { dates: SpecialDates }): boolean {
    const fixed = [left.dates, right.dates].filter(dates => !dates.yearly);
    const from = fixed.length === 0 ? YEARLY_WINDOW.from : fixed.map(dates => dates.from).reduce((a, b) => (a > b ? a : b));
    const last = fixed.length === 0 ? YEARLY_WINDOW.to : fixed.map(dates => dates.to).reduce((a, b) => (a < b ? a : b));

    const start = stationDateOf(from);
    const end = stationDateOf(last);
    if (start === undefined || end === undefined) return false;

    const until = dateKey(addDays(end, 1));
    for (let date = start; dateKey(date) <= until; date = addDays(date, 1)) {
        const theirs = piecesOn(right, date);
        if (piecesOn(left, date).some(ours => theirs.some(other => ours.from < other.to && other.from < ours.to))) return true;
    }

    return false;
}
