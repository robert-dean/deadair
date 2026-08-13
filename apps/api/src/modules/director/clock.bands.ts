/**
 * The station's format clock, as something an operator writes.
 *
 * `rotation.breakEveryMinutes` says how often the station should name itself and is the one knob
 * most stations ever want. This is everything else: a bulletin at half past, an ident at the top of
 * the hour, a second sort of break on its own interval. One rule per line, in the shape a radio
 * clock is actually drawn in.
 *
 *     # when, then what kind of break
 *     :00 talkbreak
 *     :30 news
 *     every 60m news
 *
 * Three shapes, one parser. `:MM` is every hour, `HH:MM` is once a day, and `every Nm` is a spacing
 * rule for a kind the station's own interval does not cover.
 *
 * ## Empty means no extra rules, and that is the opposite of the templates box
 *
 * {@link parseTemplates} answers with the station's own five when the box is empty, because an
 * empty set of phrasings would be a DJ with nothing to say and the way to stop the station talking
 * is `rotation.breaks`. Here an empty schedule is a coherent schedule: it means the station keeps
 * its ordinary spacing and nothing else, which is exactly what every station did before this
 * existed. So the default is empty and installing this changes nothing about what anybody hears
 * until somebody writes a line.
 *
 * ## Order is preference
 *
 * The list is read top to bottom and the planner takes it in that order, which is how
 * `BreakWriterRegistry` and `SetGeneratorChain` already settle precedence. There is no priority
 * field and no ranking between kinds: an operator who wants one rule to win a contested boundary
 * moves its line up. See `break.planner.ts` for the one thing that is NOT operator-ordered —
 * anchored rules are taken before spacing ones, because an anchored rule is the one that cannot
 * slide.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';

/** The `deadair.settings` key. In `rotation`, beside how often the station talks. */
export const CLOCK_BAND_KEYS = {
    bands: 'rotation.clockBands',
} as const;

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

/** `:30 news`, `09:00 news`, `every 60m news`. Case-insensitive on the keyword only. */
const ANCHOR = /^(?:(\d{1,2}):)?:?(\d{2})\s+(\S+)$/;
const INTERVAL = /^every\s+(\d+)\s*m(?:in(?:utes?)?)?\s+(\S+)$/i;

/** A line that is a comment, which is how a rule is turned off without being lost. */
const isComment = (line: string): boolean => line.trimStart().startsWith('#');

/**
 * The rules an operator has written, in the order they wrote them.
 *
 * A line that does not parse is DROPPED rather than guessed at, and the caller logs it once,
 * quoted — the same treatment a template with an unknown placeholder gets. Guessing would be worse
 * than useless here: a mistyped `9:0 news` read as anything at all puts a bulletin on air at a time
 * nobody chose, and the operator has no way to tell that from the rule they meant.
 */
export function parseBands(raw: string | undefined): { bands: ClockBand[]; rejected: string[] } {
    const bands: ClockBand[] = [];
    const rejected: string[] = [];

    for (const line of (raw ?? '').split('\n').map(text => text.trim())) {
        if (line.length === 0 || isComment(line)) continue;

        const band = parseLine(line);
        if (band === undefined) rejected.push(line);
        else bands.push(band);
    }

    return { bands, rejected };
}

/** Everything the operator's schedule holds, or nothing when they have not written one. */
export function stationBands(config: AppConfig): { bands: ClockBand[]; rejected: string[] } {
    return parseBands(config.get(CLOCK_BAND_KEYS.bands, ''));
}

function parseLine(line: string): ClockBand | undefined {
    const interval = INTERVAL.exec(line);
    if (interval) {
        const minutes = Number(interval[1]);
        // Zero is not a rule, it is a rule that fires at every boundary forever. Rejected rather
        // than clamped, so it is reported back to whoever wrote it.
        if (minutes <= 0) return undefined;
        return { at: 'interval', everyMs: minutes * 60_000, kind: interval[2]! };
    }

    const anchor = ANCHOR.exec(line);
    if (!anchor) return undefined;

    const minute = Number(anchor[2]);
    if (minute > 59) return undefined;

    if (anchor[1] === undefined) return { at: 'clock', minute, kind: anchor[3]! };

    const hour = Number(anchor[1]);
    if (hour > 23) return undefined;
    return { at: 'clock', minute, hour, kind: anchor[3]! };
}

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

/** What the station's clock reads at an instant. */
function readClock(at: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(new Date(at));

    const value = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0');
    return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}
