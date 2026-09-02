/**
 * Turning a published chart into picks, once, for both the things that ask for one.
 *
 * `ChartSetGenerator` takes a SHARE of a refill from a chart and an operator airing a chart takes
 * the whole of it, but the step between the entries and the picks is the same step: drop what the
 * period excludes, drop what the order already holds, keep one entry per song, and stop at what was
 * asked for. It lived inside the generator's own loop, which was correct while the generator was
 * the only caller and is a second copy the moment it is not.
 *
 * Pure and separate from either caller for `chart.ids.ts`'s reason: the interesting behaviour here
 * is the ORDER, and an order is worth table-testing without a plugin registry in the way.
 *
 * ## It names records and decides nothing
 *
 * A {@link TrackPick} is a title and an artist as strings, and nothing here sets a `trackId` even
 * where the library happens to hold the record. This step has not read the catalog and does not
 * know which row it would be; `PickResolver` matches by name and is the one place that decision
 * belongs. Everything that decides whether a named record may AIR — the dislike veto, the advisory
 * policy, the repeat window where one applies — is downstream of this file, so anything here that
 * grew its own idea of what may air would be a bug.
 */

import { withinPeriod, type EraWindow } from './candidates.repository.js';
import { songKey } from './rotation.keys.js';
import type { TrackPick } from './set.generator.js';

/** One entry of a chart as the host reads it. The plugin SDK's `ChartEntry`, narrowed to what is used here. */
export interface ChartEntryLike {
    rank: number;
    title: string;
    artist: string;
    year?: number;
}

/**
 * Which way round a chart is played.
 *
 * `countdown` is the shape a chart show has on the radio: the lowest rank first, building to number
 * one, so the broadcast ends on the biggest record rather than opening on it. `ranked` walks the
 * published document from the top. `unordered` hands the names over in rank order and leaves the
 * sequence to whatever judges them next, which for a rotation is `spaceArtists`.
 *
 * Worth knowing about `unordered`: it is not a shuffle and does not promise one. It is the absence
 * of an instruction, and what the picks do afterwards is somebody else's rule.
 */
export type ChartOrder = 'countdown' | 'ranked' | 'unordered';

/** What an operator gets when they air a chart without saying which way round. */
export const DEFAULT_CHART_ORDER: ChartOrder = 'countdown';

/** What a caller knows about the chart it is turning into picks. */
export interface ChartPickOptions {
    /** How many picks are wanted. Absent takes everything the chart offered. */
    want?: number;
    /** The period the broadcast plays, when it was asked for one. */
    era?: EraWindow;
    /** Songs not to name again: what the running order already holds. */
    avoidSongKeys?: ReadonlySet<string>;
    /**
     * Which way round. Absent is `ranked`, which is what the generator has always done — the
     * default belongs to the operator's own path rather than to this function.
     */
    order?: ChartOrder;
}

/**
 * The picks a chart names, in the order they should enter the running order.
 *
 * The cap is applied BEFORE the reverse, so "the top ten as a countdown" is the top ten played
 * backwards rather than the bottom ten played forwards. Reversing first and then taking ten would
 * be a countdown of the records nobody asked for, and it is the one thing about this that is not
 * obvious from either end.
 *
 * A period bites harder here than anywhere else and that is worth knowing rather than discovering:
 * a chart is a snapshot of what is popular NOW, so a broadcast asked for a decade and built from a
 * current chart will find almost none of it eligible. That is the period doing what it says — an
 * operator who wants both wants a chart FROM that period, which is a different chart rather than a
 * filter over this one.
 */
export const chartPicks = (entries: readonly ChartEntryLike[], options: ChartPickOptions = {}): TrackPick[] => {
    const { want, era, avoidSongKeys, order = 'ranked' } = options;
    if (want !== undefined && want <= 0) return [];

    const picks: TrackPick[] = [];
    const taken = new Set<string>();

    // Rank order, whatever is asked for, because the cap has to mean "the top so many" before the
    // direction is applied. A source that answered out of order is sorted rather than trusted: rank
    // is the one field a chart is defined by, and the entries arrive from somebody else's service.
    for (const entry of [...entries].sort((left, right) => left.rank - right.rank)) {
        if (want !== undefined && picks.length >= want) break;

        // `PickResolver` drops an out-of-period pick whatever named it, so naming one here spends a
        // slot that could have been filled. Same reason `ChartSetGenerator` and `SimilarSetGenerator`
        // both judge the period before they hand anything over.
        if (era !== undefined && !withinPeriod(entry.year, era)) continue;

        const key = songKey(entry.title, [entry.artist]);
        if (avoidSongKeys?.has(key) || taken.has(key)) continue;

        taken.add(key);
        picks.push({ title: entry.title, artist: entry.artist });
    }

    return order === 'countdown' ? picks.reverse() : picks;
};
