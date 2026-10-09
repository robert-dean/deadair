/**
 * Cutting a chart to the time it has, so a countdown reaches number one before its slot ends.
 *
 * A chart is up to a hundred records and a slot is however long an operator made it. Airing the whole
 * document into a four-hour block played ranks 100 down to about 45 and was then cut off by the next
 * changeover: the one part of a countdown everybody waits for is the part that never aired. So a chart
 * airing inside a slot keeps only the TOP of the chart that fits in the time left, and is reversed
 * after that, as `chartPicks` already does with its cap. A one-hour slot is a top fifteen and a
 * five-hour one is most of a top seventy, from the same chart.
 *
 * Pure and separate from the console for `chart.picks.ts`'s reason: the interesting behaviour is a
 * piece of arithmetic, and arithmetic is worth table-testing without a resolver in the way.
 *
 * ## An estimate, erring short
 *
 * A record counts as {@link recordSpacingLength}: its trimmed length where it was measured, the file
 * where it was not, and `NOMINAL_TRACK_MS` where nothing is known. Talk is the other unknown. Nothing
 * measures a break before it is written, so a share of the budget is held back for it whenever the
 * broadcast takes breaks at all. The two ways of being wrong are not symmetrical, which is why the
 * share is generous: a countdown that finishes a few minutes early is topped up by the broadcast's own
 * `onEnd`, and one that runs a few minutes long loses number one.
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

/**
 * The top of a chart that fits in `budgetMs`, in the order it was given.
 *
 * `tracks` must be in RANK order, number one first: what is kept is the longest run from the top
 * whose estimated lengths fit, so the records dropped are always the lowest-ranked ones. Reversing
 * for a countdown happens afterwards, for `chartPicks`' reason.
 *
 * The first record is kept whatever its length. A chart with nothing on it is a refusal the caller
 * already has words for, and a slot with three minutes left is better spent on number one than on
 * silence.
 */
export function fitAirtime<T extends Pick<RundownTrack, 'durationMs' | 'cueInMs' | 'cueOutMs'>>(tracks: readonly T[], budgetMs: number): T[] {
    const kept: T[] = [];
    let spent = 0;
    for (const track of tracks) {
        const length = recordSpacingLength(track);
        if (kept.length > 0 && spent + length > budgetMs) break;
        kept.push(track);
        spent += length;
    }
    return kept;
}
