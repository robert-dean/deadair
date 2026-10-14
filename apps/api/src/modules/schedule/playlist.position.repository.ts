import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/**
 * Where each slot that resumes its playlist got to in it.
 *
 * One row per slot, holding the song key of the last record from the slot's playlist that aired. It
 * is prepared material for the slot's NEXT opening, in the way a prepared set is (see
 * `PreparedSetRepository`), and never a cursor over what is airing: the running order is still built
 * whole at the changeover and consumed, and the director is still its only writer. See migration 0102
 * for why it is a row beside the slot rather than a column on it, and why it holds a key rather than a
 * row number.
 *
 * The slot is read through `schedule_slots` on every statement, so a slot another station owns reads
 * as having no place and cannot be cleared from here.
 */
@Injectable()
export class PlaylistPositionRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** The song key of the last record from the slot's playlist that aired, or `undefined` for none. */
    async lastSongKey(slotId: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.schedulePlaylistPositions as position')
            .innerJoin('deadair.scheduleSlots as slot', 'slot.id', 'position.slotId')
            .select('position.lastSongKey')
            .where('position.slotId', '=', slotId)
            .where('slot.stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row?.lastSongKey;
    }

    /** Forget where the slot got to, so it starts its playlist from the top the next time it opens. */
    async clear(slotId: string): Promise<void> {
        await this.db
            .deleteFrom('deadair.schedulePlaylistPositions')
            .where('slotId', '=', slotId)
            .where('slotId', 'in', eb =>
                eb.selectFrom('deadair.scheduleSlots').select('id').where('id', '=', slotId).where('stationKey', '=', this.station.stationKey),
            )
            .execute();
    }
}
