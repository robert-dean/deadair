/**
 * Cutting a chart to the time it has, so a countdown reaches number one before its slot ends.
 *
 * A chart is up to a hundred records and a slot is however long an operator made it. Airing the whole
 * document into a four-hour block played ranks 100 down to about 45 and was then cut off by the next
 * changeover: the one part of a countdown everybody waits for is the part that never aired. So a chart
 * airing inside a slot keeps only the TOP of the chart that fits in the time left, and is reversed
 * after that, as `chartPicks` already does with its cap. A one-hour slot is about a top fourteen and
 * a five-hour one a top seventy, from the same chart.
 *
 * Pure and separate from the console for `chart.picks.ts`'s reason: the interesting behaviour is a
 * piece of arithmetic, and arithmetic is worth table-testing without a resolver in the way.
 *
 * ## An estimate, allowed to run over by its last record
 *
 * A record counts as {@link recordSpacingLength}: its trimmed length where it was measured, the file
 * where it was not, and `NOMINAL_TRACK_MS` where nothing is known. By the time a chart is fitted every
 * record has been looked up, so the lengths are the provider's and mostly measured; talk is the one
 * real unknown, and a measured share of the budget is held back for it.
 *
 * The countdown is then allowed to run PAST the end of its slot, by the record that airs last. A
 * changeover the clock makes leaves the record on air playing (`schedule/changeover.overrun.ts`), so
 * number one only has to START before the boundary; what is queued behind it is what a changeover
 * drops. Fitting strictly inside the slot finished a setlist minutes early, and a setlist cannot top
 * itself up, so the remainder aired as silence. The overrun is bounded by the station's own
 * `schedule.overrunMinutes`, which is also how long a capped station lets that record run before it
 * fades it, so a fitted countdown is never the record that gets cut.
 */

import type { RundownTrack } from '#modules/playout/rundown.js';
import { NOMINAL_TRACK_MS, recordSpacingLength } from './air.estimate.js';

/**
 * The share of a slot held back for talk when the broadcast takes breaks.
 *
 * Measured rather than guessed. Over the week to 2026-10-09 the live station rendered 88 minutes of
 * talk (talk breaks, bulletins, welcomes, weather, jingles, changeovers) against 601 records aired,
 * about 4% of its airtime, or nine seconds a record. A twentieth is that and a little room. It was a
 * tenth first, which finished a four-hour countdown a quarter of an hour early, and a setlist cannot
 * top itself up, so that quarter of an hour aired as silence.
 */
export const CHART_TALK_SHARE = 0.05;

/**
 * How many more lookups than would fit are asked for, because some names resolve to nothing.
 *
 * A chart pick is a title and an artist, so some of them are not in the catalog and no provider has
 * them. Asking for exactly what fits would leave a short slot shorter; asking for the whole chart
 * spends a hundred provider searches on a one-hour show.
 */
const LOOKUP_OVERSAMPLE = 1.5;

/** How much airtime the records may have, out of `budgetMs`, once talk has had its share. */
export const recordBudget = (budgetMs: number, talks: boolean): number => Math.max(0, budgetMs * (talks ? 1 - CHART_TALK_SHARE : 1));

/**
 * How many chart entries are worth resolving for `budgetMs` of records.
 *
 * Counted at the nominal length, oversampled for the names that come to nothing, and never fewer
 * than one: a slot with a minute left still airs the top record rather than nothing.
 */
export const lookupsFor = (budgetMs: number): number => Math.max(1, Math.ceil((budgetMs / NOMINAL_TRACK_MS) * LOOKUP_OVERSAMPLE));

/** How a fitted chart may use the end of its slot. */
export interface FitOptions {
    /** How far past the end of the slot the last record may run. Absent is not at all. */
    overrunMs?: number;
    /**
     * Which end of the kept run airs LAST: `top` for a countdown, which ends on number one, and
     * `bottom` for a chart walked from the top. Only that record may straddle the boundary.
     */
    lastAirs?: 'top' | 'bottom';
}

/**
 * The top of a chart that fits in `budgetMs`, in the order it was given.
 *
 * `tracks` must be in RANK order, number one first: what is kept is the longest run from the top
 * that fits, so the records dropped are always the lowest-ranked ones. Reversing for a countdown
 * happens afterwards, for `chartPicks`' reason.
 *
 * "Fits" is two conditions, both of which only grow as records are added, which is what lets this
 * stop at the first failure: the record that airs last must START inside the budget, and the whole
 * run must end inside the budget plus `overrunMs`. With no overrun that is the run fitting outright.
 *
 * The first record is kept whatever its length. A chart with nothing on it is a refusal the caller
 * already has words for, and a slot with three minutes left is better spent on number one than on
 * silence.
 */
export function fitAirtime<T extends Pick<RundownTrack, 'durationMs' | 'cueInMs' | 'cueOutMs'>>(
    tracks: readonly T[],
    budgetMs: number,
    options: FitOptions = {},
): T[] {
    const { overrunMs = 0, lastAirs = 'bottom' } = options;
    const kept: T[] = [];
    let spent = 0;
    let topLength = 0;
    for (const track of tracks) {
        const length = recordSpacingLength(track);
        const total = spent + length;
        // Where the last record to air starts: after everything else in the run.
        const lastStarts = total - (lastAirs === 'top' ? (kept.length === 0 ? length : topLength) : length);
        if (kept.length > 0 && (lastStarts > budgetMs || total > budgetMs + Math.max(0, overrunMs))) break;
        if (kept.length === 0) topLength = length;
        kept.push(track);
        spent = total;
    }
    return kept;
}
