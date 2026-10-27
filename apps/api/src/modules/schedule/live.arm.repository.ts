import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** One night of a booked live show the schedule has dealt with. */
export interface LiveArm {
    slotId: string;
    /** The date the night began, `YYYY-MM-DD`, as `occurrenceOf` answers it. */
    occurrence: string;
    /** Whether the schedule armed the input itself, rather than finding it armed or on air already. */
    armed: boolean;
}

/**
 * Which nights of a live show the schedule has armed for, so it arms each night ONCE (migration 0121).
 *
 * Without it the tick would arm the input every minute of the show, undoing a Cancel pressed at the
 * Desk and a presenter's early hand-back alike. A row is written when the show begins and closed when
 * it ends, and a closed row is kept rather than deleted, because "this night was dealt with" is what
 * stops a show that is still in force being armed again.
 */
@Injectable()
export class LiveArmRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Whether the schedule has already dealt with this night of the show, open or closed. */
    async has(slotId: string, occurrence: string): Promise<boolean> {
        const row = await this.db
            .selectFrom('deadair.scheduleLiveArms')
            .select('slotId')
            .where('slotId', '=', slotId)
            .where('stationKey', '=', this.station.stationKey)
            .where('occurrence', '=', sql<never>`${occurrence}::date`)
            .executeTakeFirst();

        return row !== undefined;
    }

    /** The nights whose end has not been dealt with yet. */
    async open(): Promise<LiveArm[]> {
        const rows = await this.db
            .selectFrom('deadair.scheduleLiveArms')
            .select(['slotId', 'occurrence', 'armed'])
            .where('stationKey', '=', this.station.stationKey)
            .where('closedAt', 'is', null)
            .execute();

        // The driver parses a `date` as midnight UTC, so `toISODate` is the calendar date that was stored.
        return rows.map(row => ({ slotId: row.slotId, occurrence: row.occurrence.toISODate() ?? '', armed: row.armed }));
    }

    /** Write down that this night has begun. A second write for the same night changes nothing. */
    async record(arm: LiveArm): Promise<void> {
        await this.db
            .insertInto('deadair.scheduleLiveArms')
            .values({ slotId: arm.slotId, stationKey: this.station.stationKey, occurrence: sql<never>`${arm.occurrence}::date`, armed: arm.armed })
            .onConflict(oc => oc.columns(['slotId', 'occurrence']).doNothing())
            .execute();
    }

    /** Write down that this night's end has been dealt with. */
    async close(slotId: string, occurrence: string): Promise<void> {
        await this.db
            .updateTable('deadair.scheduleLiveArms')
            .set({ closedAt: sql<never>`now()` })
            .where('slotId', '=', slotId)
            .where('stationKey', '=', this.station.stationKey)
            .where('occurrence', '=', sql<never>`${occurrence}::date`)
            .execute();
    }
}
