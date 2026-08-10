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
}

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
        const row = await this.db.selectFrom('deadair.stationAir').select(['slot', 'active']).where('slot', '=', slot).executeTakeFirst();
        if (!row) return undefined;

        return { slot: row.slot, active: row.active };
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
}
