import { Injectable } from 'injectkit';
import { Kysely, sql, type Selectable } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import type { DeadairFestivalActs, DeadairFestivals } from '#modules/data/db.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { Festival, FestivalAct, FestivalDraft } from './festival.rules.js';

/**
 * The station's festivals and their bills, as rows.
 *
 * Station-scoped like every other station-owned table. A bill is rewritten whole on every save, since an
 * operator edits it as one list.
 */
@Injectable()
export class FestivalRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Every festival, soonest first. */
    async list(): Promise<Festival[]> {
        const rows = await this.db
            .selectFrom('deadair.festivals')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('startsOn')
            .orderBy('name')
            .execute();

        return await this.withActs(rows);
    }

    /** One festival, or `undefined` for one this station does not have. */
    async find(id: string): Promise<Festival | undefined> {
        const row = await this.db
            .selectFrom('deadair.festivals')
            .selectAll()
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row === undefined ? undefined : (await this.withActs([row]))[0];
    }

    /** The new festival's id. */
    async add(draft: FestivalDraft): Promise<string> {
        const row = await this.db
            .insertInto('deadair.festivals')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returning('id')
            .executeTakeFirstOrThrow();

        await this.writeActs(row.id, draft.acts);
        return row.id;
    }

    /** Whether there was one to change. The bill is replaced whole. */
    async change(id: string, draft: FestivalDraft): Promise<boolean> {
        const changed = await this.db
            .updateTable('deadair.festivals')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();
        if (changed.numUpdatedRows === 0n) return false;

        await this.db.deleteFrom('deadair.festivalActs').where('festivalId', '=', id).execute();
        await this.writeActs(id, draft.acts);
        return true;
    }

    /** Whether there was one to remove. Its bill goes with it. */
    async remove(id: string): Promise<boolean> {
        const removed = await this.db
            .deleteFrom('deadair.festivals')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return removed.numDeletedRows > 0n;
    }

    private async writeActs(festivalId: string, acts: readonly FestivalAct[]): Promise<void> {
        if (acts.length === 0) return;
        await this.db
            .insertInto('deadair.festivalActs')
            .values(
                acts.map((act, position) => ({
                    festivalId,
                    position,
                    artist: act.artist,
                    headliner: act.headliner,
                    day: act.day === undefined ? null : sql<DateTime>`${act.day}::date`,
                })),
            )
            .execute();
    }

    private async withActs(rows: Selectable<DeadairFestivals>[]): Promise<Festival[]> {
        if (rows.length === 0) return [];
        const acts = await this.db
            .selectFrom('deadair.festivalActs')
            .selectAll()
            .where(
                'festivalId',
                'in',
                rows.map(row => row.id),
            )
            .orderBy('festivalId')
            .orderBy('position')
            .execute();

        const bills = new Map<string, FestivalAct[]>();
        for (const act of acts) {
            const bill = bills.get(act.festivalId) ?? [];
            bill.push(toAct(act));
            bills.set(act.festivalId, bill);
        }
        return rows.map(row => toFestival(row, bills.get(row.id) ?? []));
    }
}

/**
 * A draft as columns, every one named, so a festival that loses its place says nothing about where it was.
 *
 * Dates are cast in SQL rather than handed over as a `DateTime`, for `schedule.repository.ts`'s reason: a
 * date is a reading of a calendar and has no zone to choose.
 */
function columnsOf(draft: FestivalDraft) {
    return {
        name: draft.name,
        startsOn: sql<DateTime>`${draft.startsOn}::date`,
        endsOn: sql<DateTime>`${draft.endsOn}::date`,
        place: draft.place ?? null,
        url: draft.url ?? null,
        sourcePluginId: draft.source?.pluginId ?? null,
        sourceEventId: draft.source?.eventId ?? null,
    };
}

/** A row as the code reads it, with every absent optional dropped rather than passed on as `null`. */
export function toFestival(row: Selectable<DeadairFestivals>, acts: FestivalAct[]): Festival {
    return {
        id: row.id,
        name: row.name,
        startsOn: row.startsOn.toISODate() ?? '',
        endsOn: row.endsOn.toISODate() ?? '',
        ...(row.place == null ? {} : { place: row.place }),
        ...(row.url == null ? {} : { url: row.url }),
        acts,
        ...(row.sourcePluginId == null || row.sourceEventId == null ? {} : { source: { pluginId: row.sourcePluginId, eventId: row.sourceEventId } }),
    };
}

const toAct = (row: Selectable<DeadairFestivalActs>): FestivalAct => ({
    artist: row.artist,
    headliner: row.headliner,
    ...(row.day == null ? {} : { day: row.day.toISODate() ?? '' }),
});
