import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';

/**
 * The slot the station broadcasts on. One today; the column exists so a second
 * mount is a row rather than a migration.
 */
export const MAIN_SLOT = 'main';

/** Whether the station is driving, as stored. */
export interface StationAir {
    slot: string;
    /**
     * Whether the station is driving. False after a stand-down, and read at boot:
     * a station stopped before a restart must not put itself back on air.
     */
    active: boolean;
    /**
     * Whether a stand-down was the running order running out and saying to stop, rather than
     * somebody stopping the station. Only ever true while `active` is false.
     *
     * The schedule reads it: a station an operator stopped is left alone, and one whose programme
     * simply ended is changed over when the next block begins. See migration 0046.
     */
    ranOut: boolean;
    /**
     * How many more records the station keeps quiet for: no breaks of its own until that many have
     * started. `0` is not quiet. See migration 0114 and `quiet.spell.ts`.
     */
    quietRecords: number;
    /**
     * Whether a stand-down was a presenter taking the air through the live input, so the hand-back
     * puts the station on again. Only ever true while `active` is false. See migration 0120.
     */
    forLive: boolean;
}

/** The longest quiet spell, in records. The table holds it to the same figure. */
export const MAX_QUIET_RECORDS = 500;

/**
 * Storage for `deadair.station_air`: whether the station is driving.
 *
 * One column of substance, and that is the point of it. This row used to name the
 * lineup on air and hold the position the broadcast had reached, which made it a
 * second opinion about programming that lives next door in `station_lineup` — and
 * the older opinion always won. What the station is airing is the running order
 * itself; all this says is whether the station is putting it out.
 *
 * The row is created on first use rather than seeded by the migration, so a
 * station that has never been given anything to play has no row and reads as
 * "not active" — which is exactly what it is.
 */
@Injectable()
export class StationAirRepository extends DataRepository {
    /** Whether this slot is driving, or `undefined` before the station has ever aired anything. */
    async get(slot = MAIN_SLOT): Promise<StationAir | undefined> {
        const row = await this.db
            .selectFrom('deadair.stationAir')
            .select(['slot', 'active', 'ranOut', 'breaksQuietRecords', 'stoodDownForLive'])
            .where('slot', '=', slot)
            .executeTakeFirst();
        if (!row) return undefined;

        return { slot: row.slot, active: row.active, ranOut: row.ranOut, quietRecords: row.breaksQuietRecords, forLive: row.stoodDownForLive };
    }

    /**
     * Keep the station quiet for this many records, or stop being quiet with `0`.
     *
     * An upsert, so a station that has never aired can be told before its first record. Clamped to
     * the table's own range rather than refused, since the console offers fixed choices and a caller
     * asking for more than the ceiling has asked for "as long as it can".
     *
     * @returns the count now stored.
     */
    async setQuiet(records: number, slot = MAIN_SLOT): Promise<number> {
        const quiet = Math.max(0, Math.min(MAX_QUIET_RECORDS, Math.floor(records)));
        await this.db
            .insertInto('deadair.stationAir')
            .values({ slot, active: false, ranOut: false, breaksQuietRecords: quiet })
            .onConflict(oc => oc.column('slot').doUpdateSet({ breaksQuietRecords: quiet }))
            .execute();
        return quiet;
    }

    /**
     * One record has started: take one off the quiet spell, never below zero.
     *
     * One statement that answers what it left, so two records starting a moment apart cannot both
     * read the same count and write the same answer back.
     *
     * @returns the count now stored, or `undefined` for a station with no row.
     */
    async countDownQuiet(slot = MAIN_SLOT): Promise<number | undefined> {
        const row = await this.db
            .updateTable('deadair.stationAir')
            .set(eb => ({ breaksQuietRecords: eb.fn('greatest', [eb.lit(0), eb('breaksQuietRecords', '-', 1)]) }))
            .where('slot', '=', slot)
            .where('breaksQuietRecords', '>', 0)
            .returning('breaksQuietRecords')
            .executeTakeFirst();
        return row?.breaksQuietRecords;
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
            .values({ slot, active: true, ranOut: false, stoodDownForLive: false })
            .onConflict(oc => oc.column('slot').doUpdateSet({ active: true, ranOut: false, stoodDownForLive: false }))
            .execute();
    }

    /**
     * Stand the station down: stop driving.
     *
     * The running order is LEFT ALONE, in `station_lineup`, with every item still
     * saying where it got to — so the console can still draw what the station stopped
     * part-way through. `active` is the whole difference between stopped and
     * stopped-and-lost.
     *
     * @param ranOut - The running order ran out and said to stop, rather than anybody stopping the
     *   station. Written either way, so an operator's Stop clears what a run-out left behind.
     * @param forLive - A presenter took the air through the live input, so the hand-back puts the
     *   station on again. Written either way too, so an operator's Stop during a show is not
     *   overruled when the show ends.
     */
    async standDown(slot = MAIN_SLOT, ranOut = false, forLive = false): Promise<void> {
        await this.db.updateTable('deadair.stationAir').set({ active: false, ranOut, stoodDownForLive: forLive }).where('slot', '=', slot).execute();
    }
}
