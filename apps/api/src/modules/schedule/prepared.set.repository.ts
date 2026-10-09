import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/**
 * The first records of a show, chosen before it starts.
 *
 * A slot that is only a brief used to go on air with an EMPTY running order and wait out a model
 * refill and a download at the boundary, which was two to three minutes of silence per show on the
 * live station. A set prepared ahead of the boundary is what the changeover airs instead. See
 * migration 0080 for why it is a table, and why it is in Postgres rather than Redis.
 *
 * It is prepared material, never a running order: the schedule's tick reads it and hands the records
 * to `DirectorConsoleService.putOnAir`, which posts them to the director like any playlist, so the
 * director stays the only writer of what airs.
 */
@Injectable()
export class PreparedSetRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * The records prepared for one night of a slot, or `undefined` when there are none.
     *
     * Keyed on the NIGHT as well as the slot, because a set prepared for a night that never aired (the
     * station was stood down through it) was chosen against that night and is not this one's. A
     * stored value that is not a list reads as nothing prepared rather than a throw, since this is
     * read while the station is changing over and the fallback is what every brief-only show did
     * before this existed.
     */
    async forNight(slotId: string, occurrence: string): Promise<RundownTrack[] | undefined> {
        const row = await this.db
            .selectFrom('deadair.schedulePreparedSets')
            .select('tracks')
            .where('slotId', '=', slotId)
            .where('stationKey', '=', this.station.stationKey)
            .where('occurrence', '=', sql<never>`${occurrence}::date`)
            .executeTakeFirst();

        if (row === undefined || !Array.isArray(row.tracks) || row.tracks.length === 0) return undefined;
        return row.tracks as unknown as RundownTrack[];
    }

    /**
     * Keep the records chosen for one night of a slot, replacing whatever the slot held before.
     *
     * One row per slot, so a set left over from a night that never aired is overwritten here rather
     * than swept: it was for that night, and this one is for the next.
     */
    async save(slotId: string, occurrence: string, tracks: readonly RundownTrack[]): Promise<void> {
        const values = {
            // Cast in SQL, as `station_lineup.slot_occurrence` is: a date is a reading of the station's
            // calendar rather than an instant.
            occurrence: sql<never>`${occurrence}::date`,
            tracks: toJsonb(tracks),
            preparedAt: sql<never>`now()`,
        };

        await this.db
            .insertInto('deadair.schedulePreparedSets')
            .values({ slotId, stationKey: this.station.stationKey, ...values })
            .onConflict(oc => oc.column('slotId').doUpdateSet(values))
            .execute();
    }

    /** Let a slot's prepared set go, once it has aired or no longer describes the slot. */
    async discard(slotId: string): Promise<void> {
        await this.db
            .deleteFrom('deadair.schedulePreparedSets')
            .where('slotId', '=', slotId)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }
}
