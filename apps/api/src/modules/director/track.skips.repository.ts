import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import type { RundownItem } from '#modules/playout/rundown.js';
import { PLAY_HISTORY_RETENTION_DAYS } from './play.history.repository.js';
import { artistKey, songKey } from './rotation.keys.js';

/** One record an operator cut short with Skip. */
export interface TrackSkipEntry {
    /** What was on air. Keyed exactly as `play_history` keys it, off the lead artist. */
    item: RundownItem;
    stationKey: string;
    /** How far into the record the cut came, when the player had said when it started. */
    afterMs?: number;
    /** The user who pressed it, when there was one. */
    actorId?: string;
}

/**
 * The operator's Skips, kept so the draw can lean away from what they cut (`skip.lean.ts`).
 *
 * The sibling of `PlayHistoryRepository` and keyed the same way, by `song_key` per station, for the
 * reason every rotation read is: two catalog rows holding one work share one history.
 */
@Injectable()
export class TrackSkipsRepository extends DataRepository {
    /**
     * Record one Skip, and sweep anything older than the history's retention.
     *
     * Swept on every write rather than every fiftieth, as the history is: a Skip is something a person
     * presses, a few times an evening at most, and the delete runs against an index.
     */
    async record(entry: TrackSkipEntry): Promise<void> {
        const { item } = entry;

        await this.db
            .insertInto('deadair.trackSkips')
            .values({
                stationKey: entry.stationKey,
                trackId: item.trackId ?? null,
                songKey: songKey(item.title, [item.artist]),
                artistKey: artistKey([item.artist]),
                afterMs: entry.afterMs === undefined ? null : Math.max(0, Math.round(entry.afterMs)),
                actorId: entry.actorId ?? null,
            })
            .execute();

        await this.db
            .deleteFrom('deadair.trackSkips')
            .where('skippedAt', '<', sql<DateTime>`now() - ${sql.lit(`${PLAY_HISTORY_RETENTION_DAYS} days`)}::interval`)
            .execute();
    }

    /**
     * When each song was LAST skipped, for every song skipped within the last `days`.
     *
     * `0` or less answers with an empty map without querying, so a station with the lean off pays
     * nothing, on `PlayHistoryRepository.lastAiredSince`'s rule.
     */
    async lastSkippedSince(days: number, stationKey: string): Promise<Map<string, DateTime>> {
        if (days <= 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.trackSkips')
            .select(eb => ['songKey', eb.fn.max('skippedAt').as('lastSkippedAt')])
            .where('stationKey', '=', stationKey)
            .where('skippedAt', '>', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .groupBy('songKey')
            .execute();

        return new Map(rows.map(row => [row.songKey, row.lastSkippedAt]));
    }
}
