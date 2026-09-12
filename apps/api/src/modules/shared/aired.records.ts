import { Injectable } from 'injectkit';
import type { DateTime } from 'luxon';

/**
 * How many days ago each record last aired, for the refill a model is choosing records for.
 *
 * ## Why a model is told this rather than judged on it
 *
 * Smart shuffle leans the station away from what aired lately, and a generator that NAMES records
 * cannot be weighted the way the catalog draw is: a name is either judged or not, and judging is the
 * repeat window's job. What the station can do is say so on the row the model is choosing from, the
 * move `owned` and `queued` already make. It is information, never a veto: the model may still name
 * a record that aired yesterday, and for a brief that only a handful of records can fill it should.
 *
 * ## Why it travels out of band
 *
 * The same reason as `QueuedRecords`, which this is the sibling of: `ModelSetGenerator` is what
 * knows a refill is running and reads the history, and `MusicSearchTool` is what writes the rows, and
 * the second is built by the tool registry and knows nothing about any refill. Scoped, so one refill's
 * history is never read by another.
 *
 * ## Empty is the ordinary state
 *
 * A break writer shares the search tool and fills nothing, and a station with smart shuffle off asks
 * for nothing. Either way no row is marked, which is the old answer.
 */
@Injectable()
export class AiredRecords {
    private readonly daysAgoByKey = new Map<string, number>();

    /**
     * Take the history's answer: when each song last aired.
     *
     * Whole days, floored, so "0" means today. Additive and keeping the most recent airing, because a
     * scope may plan twice and the second read can only be newer than the first.
     */
    remember(lastAired: ReadonlyMap<string, DateTime>, now: DateTime): void {
        for (const [key, at] of lastAired) {
            const days = Math.max(0, Math.floor(now.diff(at, 'days').days));
            if (!Number.isFinite(days)) continue;
            const known = this.daysAgoByKey.get(key);
            if (known === undefined || days < known) this.daysAgoByKey.set(key, days);
        }
    }

    /** How many whole days ago this record aired, or undefined when it has not aired inside the horizon. */
    daysAgo(key: string): number | undefined {
        return this.daysAgoByKey.get(key);
    }

    /** How many, for a caller deciding whether it is worth saying anything at all. */
    get size(): number {
        return this.daysAgoByKey.size;
    }
}
