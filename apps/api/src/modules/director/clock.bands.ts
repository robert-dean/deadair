/**
 * The station's format clock: what it SAYS, and when.
 *
 * `rotation.breakEveryMinutes` says how often the station should name itself and is the one knob
 * most stations ever want. This is everything else: a bulletin at half past, an ident at the top of
 * the hour, a second sort of break on its own interval.
 *
 * Two shapes. An {@link AnchoredBand} is a time of day — every hour at half past, or once a day at
 * nine — and a {@link SpacingBand} is a rule for a kind the station's own interval does not cover.
 *
 * ## Rows, and this file is only the vocabulary and the arithmetic
 *
 * A band is a row in `deadair.clock_bands` (see `ClockBandRepository`). It was `rotation.clockBands`,
 * one rule per line, parsed here with a regular expression that dropped whatever it could not read —
 * which was right while a band was three tokens somebody could hold in their head, and stopped being
 * right when a band grew a reference to another table. A mistyped line is silence at a time nobody
 * chose, reported only in a log; a row cannot be malformed.
 *
 * What is left here is the part that was always the hard part and is a pure function of a band and
 * an instant: {@link nextOccurrence}, and the daylight-saving care underneath it.
 *
 * ## No bands is a coherent schedule
 *
 * A station with no rows keeps its ordinary spacing and nothing else, which is exactly what every
 * station did before any of this existed. There is nothing to default and nothing to seed.
 *
 * ## Order is preference
 *
 * Bands are read in `position` order and the planner takes them in that order, which is how
 * `BreakWriterRegistry` and `SetGeneratorChain` already settle precedence. There is no priority
 * field and no ranking between kinds: an operator who wants one rule to win a contested boundary
 * moves it up. See `break.planner.ts` for the one thing that is NOT operator-ordered — anchored
 * rules are taken before spacing ones, because an anchored rule is the one that cannot slide.
 */

/** A break tied to a time of day. */
export interface AnchoredBand {
    at: 'clock';
    /** Minutes past the hour. */
    minute: number;
    /** The hour it happens at, or absent for every hour. */
    hour?: number;
    kind: string;
}

/** A break on its own interval, for a kind the station's own spacing does not cover. */
export interface SpacingBand {
    at: 'interval';
    everyMs: number;
    kind: string;
}

export type ClockBand = AnchoredBand | SpacingBand;

export const isAnchored = (band: ClockBand): band is AnchoredBand => band.at === 'clock';

/**
 * A band as it is STORED, which is the rule plus what an operator needs to manage it.
 *
 * The rule itself is all the planner reads, which is why {@link ClockBand} stays the narrower type
 * and travels on its own: a walk over the running order has no business knowing which row a slot
 * came from or whether the operator has it switched on, because a band that is off was never handed
 * to it.
 */
export type ClockBandRecord = ClockBand & {
    id: string;
    /** Where in the operator's own order this sits. See the note on precedence above. */
    position: number;
    /** What commenting a line out used to do: a rule turned off without being lost. */
    enabled: boolean;
};

/** A band as somebody wrote it, before the database gives it an id. */
export type ClockBandDraft = ClockBand & { position?: number; enabled?: boolean };

/**
 * The next time this band comes round, strictly after an instant.
 *
 * Strictly after, so a band resolved at the exact moment it fires answers with tomorrow's rather
 * than with the one that is already happening. That matters because the planner runs this on every
 * commit pass: an occurrence that stayed "now" forever would be re-targeted at a boundary the
 * station had already gone past.
 *
 * Walked forward from the hour rather than computed, because arithmetic on a wall clock is where
 * daylight saving hides. Stepping an hour (or a day) at a time and asking the formatter what the
 * station's clock says is slower and is correct through a change in either direction.
 */
export function nextOccurrence(band: AnchoredBand, after: number, zone: string): number {
    const step = band.hour === undefined ? 3_600_000 : 86_400_000;

    // Enough steps to clear a day either way. An hourly band needs at most 25 to survive a clock
    // going back, and a daily one at most 2.
    for (let attempt = 0; attempt <= 26; attempt++) {
        const at = alignedTo(band, after + attempt * step, zone);
        if (at !== undefined && at > after) return at;
    }

    // Unreachable for any real zone. Answering the far future rather than throwing keeps a bad
    // clock from taking down the commit pass: the band simply never fires.
    return Number.MAX_SAFE_INTEGER;
}

/**
 * The instant, near `around`, at which the station's clock reads this band's time.
 *
 * `undefined` when the wall-clock time this band names does not exist on that day, which is a real
 * case rather than a defensive one: on a spring-forward morning there is no 01:30, and a daily band
 * set to it should skip that day rather than land an hour out.
 */
function alignedTo(band: AnchoredBand, around: number, zone: string): number | undefined {
    const parts = readClock(around, zone);
    const wanted = { ...parts, minute: band.minute, second: 0, ...(band.hour === undefined ? {} : { hour: band.hour }) };

    // The zone's offset at this moment, which is what turns a wall-clock reading back into an
    // instant. Taken at `around` rather than at the answer, then checked: if the shift crossed a
    // transition the reading back will not match, and the band is treated as not existing there.
    const offset = around - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const at = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, 0) + offset;

    const check = readClock(at, zone);
    if (check.hour !== wanted.hour || check.minute !== wanted.minute) return undefined;
    return at;
}

/** What the station's clock reads at an instant. Sunday is 0, matching `Date.getDay()`. */
export interface StationClock {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * What the station's clock reads at an instant.
 *
 * Exported for `schedule.ts`, which asks the same question of the same zone and should not own a
 * second `formatToParts`: there are two in this tree already (here and `clock.words.ts`) and a third
 * is where they start disagreeing.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which is not the same thing — the latter renders
 * midnight as `24` under `en-GB` and would put every instant in the first hour of the day onto the
 * wrong date.
 */
export function readClock(at: number, zone: string): StationClock {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
    }).formatToParts(new Date(at));

    const value = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0');
    return {
        year: value('year'),
        month: value('month'),
        day: value('day'),
        hour: value('hour'),
        minute: value('minute'),
        second: value('second'),
        weekday: WEEKDAYS[parts.find(part => part.type === 'weekday')?.value ?? ''] ?? 0,
    };
}
