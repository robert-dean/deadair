import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { instant } from '#modules/data/timestamp.columns.js';
import type { RundownItem } from '#modules/playout/rundown.js';
import { isRenderItem } from '#modules/render/segment.source.js';

/**
 * How long the as-run log is kept.
 *
 * Longer than `PLAY_HISTORY_RETENTION_DAYS`, because the two answer different questions: that table
 * is the memory the rotation steers off and nothing reads it past a few weeks, while this one is
 * what an operator asks "what was on air last March" of. A year and a little, so the same week last
 * year is still there, and bounded so a station left running for a decade is not carrying all of it.
 */
export const AS_RUN_RETENTION_DAYS = 400;

/** A prune every this many writes, on `PlayHistoryRepository`'s argument: cheap, and never on the boundary's clock. */
const PRUNE_EVERY = 100;

/** What went out, as the aired edge knows it. */
export interface AsRunEntry {
    item: RundownItem;
    stationKey: string;
    broadcastId?: string;
    /** What put a record in the running order, as `play_history.source` spells it. Ignored for a break. */
    source: string;
    /** How many handed items the player moved past to reach this one. See `Rundown.onAired`. */
    passedOver: number;
    /** When the player said it started. */
    at: number;
}

/**
 * The as-run log: what actually went out, in order, with when it started and when it ended.
 *
 * ## One row per item, opened and closed on two edges
 *
 * A row is written on the rundown's `onAired`, the player saying the item started, and the row before
 * it is closed in the same breath: the moment one item airs is the moment the last one stopped being
 * what was on. A stand-down closes the open row too. Nothing else does, deliberately: a process that
 * died mid-record saw nothing end, and an `ended_at` guessed from the running time would be a time
 * the operator could not trust, which is the one thing this table is for. An open row older than the
 * item airing now therefore means the station stopped without saying so.
 *
 * ## Why it is not `play_history`
 *
 * That table holds records only, because a break in it would put "Station ident" into the song key
 * space the repeat window reads. This one holds every kind of item and nothing reads it to decide
 * anything.
 */
@Injectable()
export class AsRunRepository extends DataRepository {
    private static writesSincePrune = 0;

    /**
     * Opens a row for the item that just started, and closes whichever row was open before it.
     *
     * **Two statements that are safe in either order**, because the aired edge hands each write to its
     * own scope and two items starting a second apart can land out of order. The close touches only
     * rows that started before this one, so a late write cannot end a later item, and it also pulls in
     * an earlier row whose end a later item stamped past this one's start. And a row inserted after a
     * later item already aired ends where that item began, so it is never left open behind it.
     */
    async record(entry: AsRunEntry): Promise<void> {
        const { item } = entry;
        const render = isRenderItem(item);
        const at = instant(entry.at);

        await this.close(entry.stationKey, entry.at);
        await this.db
            .insertInto('deadair.asRun')
            .values({
                stationKey: entry.stationKey,
                broadcastId: entry.broadcastId ?? null,
                itemId: item.id,
                kind: render ? (item.programme === true ? 'programme' : 'break') : 'record',
                trackId: render ? null : (item.trackId ?? null),
                // A break's external id IS its segment's id: that is how every other aired-edge mark
                // finds it (`PersonaTellingRepository.markAired`).
                segmentId: render ? item.externalId : null,
                // The station's own title, and for a break that is its segment's label ("Talk break:
                // one into two") rather than the line a listener was shown, which is often only the
                // station's name. An operator reading the log wants to know which break it was.
                title: item.title,
                artists: item.artists.join(', '),
                source: render ? null : entry.source,
                airedAt: at,
                // Null in the ordinary case. Set only when a later item's row is already there, which
                // means this write was overtaken and that item's start is where this one stopped.
                endedAt: sql<DateTime>`(
                    select min(later.aired_at) from deadair.as_run later
                    where later.station_key = ${entry.stationKey} and later.aired_at > ${at}
                )`,
                passedOver: Math.max(0, Math.floor(entry.passedOver)),
                // Why the model picked a record, when it was asked to say. Null for a break, whose
                // render item has no such field, and for every record the station drew itself.
                pickedBecause: render ? null : (item.pickedBecause ?? null),
            })
            .execute();

        AsRunRepository.writesSincePrune += 1;
        if (AsRunRepository.writesSincePrune >= PRUNE_EVERY) {
            AsRunRepository.writesSincePrune = 0;
            await this.prune();
        }
    }

    /**
     * Ends whichever item started before `at` and is still open, or was ended after `at`, at `at`.
     *
     * The second half is the overtaken write: a later item that wrote first closed the row before it
     * at its own start, and this item started in between. Bounded below by the row's own start, so a
     * clock that stepped backwards cannot write an end before a beginning (the table refuses one).
     */
    async close(stationKey: string, at: number): Promise<void> {
        await this.db
            .updateTable('deadair.asRun')
            .set({ endedAt: sql<DateTime>`greatest(aired_at, ${instant(at)})` })
            .where('stationKey', '=', stationKey)
            .where(eb => eb.or([eb('endedAt', 'is', null), eb('endedAt', '>', instant(at))]))
            .where('airedAt', '<', instant(at))
            .execute();
    }

    /** Drops everything older than {@link AS_RUN_RETENTION_DAYS}. */
    async prune(days = AS_RUN_RETENTION_DAYS): Promise<number> {
        const result = await this.db
            .deleteFrom('deadair.asRun')
            .where('airedAt', '<', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .executeTakeFirst();

        return Number(result.numDeletedRows ?? 0);
    }
}
