import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
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

    /**
     * Remember that a record from the slot's playlist aired, as the place its next opening starts after.
     *
     * Written only while the slot still resumes, and still names the playlist the record came from.
     * Both are asked of the slot row in the same statement rather than by a read first, because the
     * aired edge is where this is called and an operator may have edited the slot since the block
     * opened: a record from the playlist the slot USED to name is not a place in the one it names now,
     * and the edit that changed it has already let the old place go (`ScheduleRepository.update`).
     *
     * @param playlist - The playlist the airing broadcast was built from: a provider's, with its plugin,
     *   or the station's own, with none, which is how the running order's binding tells the two apart.
     */
    async advance(slotId: string, playlist: { pluginId?: string; playlistId: string }, songKey: string): Promise<void> {
        await this.db
            .insertInto('deadair.schedulePlaylistPositions')
            .columns(['slotId', 'lastSongKey'])
            .expression(eb =>
                eb
                    .selectFrom('deadair.scheduleSlots')
                    .select(['id', eb.val(songKey).as('lastSongKey')])
                    .where('id', '=', slotId)
                    .where('stationKey', '=', this.station.stationKey)
                    .where('resumePlaylist', '=', true)
                    .where(where =>
                        playlist.pluginId === undefined
                            ? where(sql`source_station_playlist_id::text`, '=', playlist.playlistId)
                            : where.and([where('sourcePluginId', '=', playlist.pluginId), where('sourcePlaylistId', '=', playlist.playlistId)]),
                    ),
            )
            .onConflict(oc =>
                oc.column('slotId').doUpdateSet(eb => ({
                    lastSongKey: eb.ref('excluded.lastSongKey'),
                    updatedAt: sql<never>`now()`,
                })),
            )
            .execute();
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
