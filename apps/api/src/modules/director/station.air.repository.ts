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
     * Put a lineup on air, from the top.
     *
     * `interrupting` is what makes a feature able to hand the station back: the
     * lineup and cursor being displaced are remembered, so an album played over
     * the afternoon rotation resumes that rotation where it left off rather than
     * at its beginning. Passing nothing CLEARS that memory, which is right for an
     * operator deliberately changing programming — there is nothing to go back to.
     */
    async putOnAir(lineupId: string, interrupting?: { lineupId: string; cursor: number }, slot = MAIN_SLOT): Promise<void> {
        const values = {
            lineupId,
            cursor: 0,
            active: true,
            resumeLineupId: interrupting?.lineupId ?? null,
            resumeCursor: interrupting?.cursor ?? null,
        };

        await this.db
            .insertInto('deadair.stationAir')
            .values({ slot, ...values })
            .onConflict(oc => oc.column('slot').doUpdateSet(values))
            .execute();
    }

    /**
     * Go back to a remembered lineup at a remembered position, and forget it.
     *
     * The one place a cursor is restored rather than reset. Clearing the memory in
     * the same statement matters: a second resume would otherwise return to the
     * same point a second time, replaying whatever aired in between.
     */
    async resume(lineupId: string, cursor: number, slot = MAIN_SLOT): Promise<void> {
        await this.db
            .updateTable('deadair.stationAir')
            .set({ lineupId, cursor, active: true, resumeLineupId: null, resumeCursor: null })
            .where('slot', '=', slot)
            .execute();
    }

    /**
     * Stand the station down: stop driving, and forget what it was going to
     * resume.
     *
     * The lineup and cursor are LEFT ALONE, so the console can still say what the
     * station was playing and pressing play again continues rather than starting
     * over. `active` is the whole difference between stopped and stopped-and-lost.
     */
    async standDown(slot = MAIN_SLOT): Promise<void> {
        await this.db
            .updateTable('deadair.stationAir')
            .set({ active: false, resumeLineupId: null, resumeCursor: null })
            .where('slot', '=', slot)
            .execute();
    }

    /** Name the slot's home programming, for `on_end: 'rotation'`. */
    async setDefaultLineup(lineupId: string | undefined, slot = MAIN_SLOT): Promise<void> {
        await this.db
            .insertInto('deadair.stationAir')
            .values({ slot, defaultLineupId: lineupId ?? null })
            .onConflict(oc => oc.column('slot').doUpdateSet({ defaultLineupId: lineupId ?? null }))
            .execute();
    }

    /**
     * Forget a lineup that has been deleted.
     *
     * The foreign keys already null the pointers, but the cursor and `active` flag
     * are left behind by that and would describe a broadcast of nothing. Called by
     * the delete path so the row does not have to be read to be understood.
     */
    async forgetLineup(lineupId: string): Promise<void> {
        await this.db
            .updateTable('deadair.stationAir')
            .set({ lineupId: null, cursor: 0, active: false })
            .where('lineupId', '=', lineupId)
            .execute();

        await this.db
            .updateTable('deadair.stationAir')
            .set({ resumeLineupId: null, resumeCursor: null })
            .where('resumeLineupId', '=', lineupId)
            .execute();
    }
}
