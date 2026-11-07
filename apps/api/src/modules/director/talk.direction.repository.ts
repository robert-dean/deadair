import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** The longest direction the station keeps, in characters. The table holds it to the same figure. */
export const MAX_DIRECTION_LENGTH = 280;

/** The fewest and most hours a direction can be given for, on the genre steer's terms. */
export const DIRECTION_HOURS = { min: 1, max: 24 } as const;

/** A talk direction in force: the operator's words, and until when the presenters hear them. */
export interface TalkDirectionRow {
    words: string;
    /** ISO instant. */
    endsAt: string;
}

/**
 * The station's one talk direction, as a row. Station-scoped like every other station-owned table.
 *
 * Read against an INSTANT rather than against now, because a break is written about twenty minutes
 * before it airs and what decides whether it hears the direction is whether the direction still holds
 * when the break is heard.
 */
@Injectable()
export class TalkDirectionRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * The direction in force at `at` (an ISO instant, or now when absent), or `undefined` once it has
     * run out by then. An expired row is left for the next write to replace.
     */
    async direction(at?: string): Promise<TalkDirectionRow | undefined> {
        const instant = at === undefined ? sql<DateTime>`now()` : sql<DateTime>`${at}::timestamptz`;
        const row = await this.db
            .selectFrom('deadair.talkDirections')
            .select(['words', 'endsAt'])
            .where('stationKey', '=', this.station.stationKey)
            .where('endsAt', '>', instant)
            .executeTakeFirst();

        return row === undefined ? undefined : { words: row.words, endsAt: iso(row.endsAt) };
    }

    /** Direct the presenters with `words` for `hours` from now, replacing whatever direction there was. */
    async setDirection(words: string, hours: number): Promise<TalkDirectionRow> {
        const endsAt = sql<DateTime>`now() + make_interval(hours => ${hours})`;
        const row = await this.db
            .insertInto('deadair.talkDirections')
            .values({ stationKey: this.station.stationKey, words, endsAt })
            .onConflict(oc => oc.column('stationKey').doUpdateSet({ words, endsAt, createdAt: sql<DateTime>`now()` }))
            .returning(['words', 'endsAt'])
            .executeTakeFirstOrThrow();

        return { words: row.words, endsAt: iso(row.endsAt) };
    }

    async clearDirection(): Promise<void> {
        await this.db.deleteFrom('deadair.talkDirections').where('stationKey', '=', this.station.stationKey).execute();
    }
}

/** A timestamp column as ISO text, whichever shape the driver handed back. */
const iso = (value: DateTime | Date | string): string =>
    DateTime.isDateTime(value) ? (value.toISO() ?? '') : value instanceof Date ? value.toISOString() : (DateTime.fromISO(value).toISO() ?? value);
