import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import type { RundownItem } from '#modules/playout/rundown.js';
import { artistKey, songKey } from './rotation.keys.js';

/** One track that actually aired, as the director hands it over. */
export interface PlayHistoryEntry {
    item: RundownItem;
    /** What put it in the running order: `director`, `import`, later a request. */
    source: string;
    /** Which station aired it. Every read below is scoped to it: a repeat window is per station. */
    stationKey: string;
    /**
     * Which broadcast aired it.
     *
     * Absent should not happen in practice — something aired, so a broadcast was on — but it is
     * optional rather than required because this is a history table and refusing to record what a
     * listener demonstrably heard, over a missing label, would be the wrong way round.
     */
    broadcastId?: string;
}

/**
 * How long a station may run before its history is trimmed.
 *
 * Far past the longest window any rule reads, so pruning can never take a row a
 * rotation still cares about. It exists so a station left running for a year
 * does not carry a table nobody will ever query.
 */
const RETENTION_DAYS = 120;

/** Writes between retention sweeps. A track boundary is not the moment to delete a year of rows. */
const PRUNE_EVERY = 50;

/**
 * What the station has aired: `deadair.play_history`.
 *
 * Written from the rundown's `onAired`, which is the only event that can
 * honestly say a track started. Writing it when an item is handed to the player
 * would put every row one track ahead of what the listener heard, and every
 * rotation rule downstream would be steering off that lie.
 *
 * The keys are computed here, through the same helpers the rules read them with,
 * so the writer and the reader cannot drift. A rotation rule that silently never
 * matches has no symptom except a station that repeats itself.
 */
@Injectable()
export class PlayHistoryRepository extends DataRepository {
    /** Writes since the last sweep. Process-local, and only ever a heuristic for when to prune. */
    private static writesSincePrune = 0;

    /**
     * Record one aired track, and occasionally sweep.
     *
     * The sweep rides on the write rather than a timer because it needs no
     * accuracy at all: retention is measured in months, and a station that airs
     * nothing has nothing to trim.
     */
    async record(entry: PlayHistoryEntry): Promise<void> {
        const { item } = entry;

        await this.db
            .insertInto('deadair.playHistory')
            .values({
                stationKey: entry.stationKey,
                broadcastId: entry.broadcastId ?? null,
                trackId: item.trackId ?? null,
                pluginId: item.pluginId,
                externalId: item.externalId,
                title: item.title,
                // The credit as written, for display. Identity comes from the keys below.
                artists: item.artists.join(', '),
                songKey: songKey(item.title, item.artists),
                artistKey: artistKey(item.artists),
                source: entry.source,
            })
            .execute();

        PlayHistoryRepository.writesSincePrune += 1;
        if (PlayHistoryRepository.writesSincePrune >= PRUNE_EVERY) {
            PlayHistoryRepository.writesSincePrune = 0;
            await this.prune();
        }
    }

    /**
     * Songs aired within the last `days` — the repeat window.
     *
     * `0` or less answers with an empty set WITHOUT querying, which is what makes
     * a disabled rule free rather than a branch at every call site. It is also
     * the honest answer: nothing is suppressed.
     */
    async songKeysSince(days: number, stationKey: string): Promise<Set<string>> {
        if (days <= 0) return new Set();

        const rows = await this.db
            .selectFrom('deadair.playHistory')
            .select('songKey')
            .distinct()
            // Scoped to the station, and the index leads with it. A repeat window is an argument
            // about what THIS station has been playing; answering it from every station's history
            // would have one station's rotation suppressed by another's.
            .where('stationKey', '=', stationKey)
            // Literal interval rather than a bound parameter: `$1::interval` cannot be
            // multiplied by a plain number in a way every driver agrees on, and the value
            // is an integer this code produced, never operator input.
            .where('airedAt', '>', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .execute();

        return new Set(rows.map(row => row.songKey));
    }

    /** Artists aired within the last `minutes` — the cooldown. `0` disables it, as above. */
    async artistKeysSince(minutes: number, stationKey: string): Promise<Set<string>> {
        if (minutes <= 0) return new Set();

        const rows = await this.db
            .selectFrom('deadair.playHistory')
            .select('artistKey')
            .distinct()
            .where('stationKey', '=', stationKey)
            .where('airedAt', '>', sql<DateTime>`now() - ${sql.lit(`${Math.floor(minutes)} minutes`)}::interval`)
            .execute();

        return new Set(rows.map(row => row.artistKey));
    }

    /**
     * Drop anything older than the retention window.
     *
     * Deliberately NOT scoped to a station, unlike the two reads above: retention is one number for
     * the install, and a sweep that ran per station would leave every other station's rows to
     * whichever station happened to be airing.
     */
    async prune(days = RETENTION_DAYS): Promise<number> {
        const result = await this.db
            .deleteFrom('deadair.playHistory')
            .where('airedAt', '<', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .executeTakeFirst();

        return Number(result.numDeletedRows ?? 0);
    }
}
