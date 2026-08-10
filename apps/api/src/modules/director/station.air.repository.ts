import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';

/**
 * The slot the station broadcasts on. One today; the column exists so a second
 * mount is a row rather than a migration.
 */
export const MAIN_SLOT = 'main';

/** What is on air, as stored. */
export interface StationAir {
    slot: string;
    /** The lineup being aired, absent when the station has never been given one. */
    lineupId?: string;
    /** How far through it this broadcast has committed. */
    cursor: number;
    /**
     * Whether the station is driving. False after a stand-down, and read at boot:
     * a station stopped before a restart must not put itself back on air.
     */
    active: boolean;
    /** What to go back to when the current lineup ends with `on_end: 'resume'`, and where in it. */
    resumeLineupId?: string;
    resumeCursor?: number;
    /** The slot's home programming, for `on_end: 'rotation'`. */
    defaultLineupId?: string;
}

/**
 * Storage for `deadair.station_air`: what the station is airing right now.
 *
 * Separate from the lineup itself because it describes this BROADCAST rather
 * than the plan. The same lineup put on air again tomorrow starts from the top,
 * and a lineup being edited off air has no cursor at all.
 *
 * The row is created on first use rather than seeded by the migration, so a
 * station that has never been given anything to play has no row and reads as
 * "nothing on air, not active" — which is exactly what it is.
 */
@Injectable()
export class StationAirRepository extends DataRepository {
    /** What is on air in this slot, or `undefined` before the station has ever aired anything. */
    async get(slot = MAIN_SLOT): Promise<StationAir | undefined> {
        const row = await this.db
            .selectFrom('deadair.stationAir')
            .select(['slot', 'lineupId', 'cursor', 'active', 'resumeLineupId', 'resumeCursor', 'defaultLineupId'])
            .where('slot', '=', slot)
            .executeTakeFirst();
        if (!row) return undefined;

        return {
            slot: row.slot,
            ...(row.lineupId == null ? {} : { lineupId: row.lineupId }),
            cursor: row.cursor,
            active: row.active,
            ...(row.resumeLineupId == null ? {} : { resumeLineupId: row.resumeLineupId }),
            ...(row.resumeCursor == null ? {} : { resumeCursor: row.resumeCursor }),
            ...(row.defaultLineupId == null ? {} : { defaultLineupId: row.defaultLineupId }),
        };
    }

    /**
     * Switch the station on.
     *
     * All this row says now is WHETHER the station is driving. What it is driving is
     * the director's own running order, in `station_lineup`, which is why nothing here
     * names a lineup any more: a pointer to programming kept beside the programming
     * itself is two answers to one question, and the older one always won.
     */
    async goOnAir(slot = MAIN_SLOT): Promise<void> {
        await this.db
            .insertInto('deadair.stationAir')
            .values({ slot, active: true })
            .onConflict(oc => oc.column('slot').doUpdateSet({ active: true }))
            .execute();
    }

    /**
     * Stand the station down: stop driving.
     *
     * The running order is LEFT ALONE, in `station_lineup`, with every item still
     * saying where it got to — so the console can still draw what the station stopped
     * part-way through. `active` is the whole difference between stopped and
     * stopped-and-lost.
     */
    async standDown(slot = MAIN_SLOT): Promise<void> {
        await this.db.updateTable('deadair.stationAir').set({ active: false }).where('slot', '=', slot).execute();
    }

    /**
     * Forget a lineup that has been deleted.
     *
     * The foreign keys already null the pointers, but the cursor and `active` flag
     * are left behind by that and would describe a broadcast of nothing. Called by
     * the delete path so the row does not have to be read to be understood.
     */
    async forgetLineup(lineupId: string): Promise<void> {
        await this.db.updateTable('deadair.stationAir').set({ lineupId: null, cursor: 0, active: false }).where('lineupId', '=', lineupId).execute();

        await this.db
            .updateTable('deadair.stationAir')
            .set({ resumeLineupId: null, resumeCursor: null })
            .where('resumeLineupId', '=', lineupId)
            .execute();
    }
}
