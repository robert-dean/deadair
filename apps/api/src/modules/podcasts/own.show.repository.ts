import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';
import { isWritingMode } from '#modules/productions/production.passes.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { OwnShowRecord, OwnShowWrite } from './own.show.js';

/** `deadair.own_shows`: the station's own shows, one row a recipe. */
@Injectable()
export class OwnShowRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Every show, by title. */
    async list(): Promise<OwnShowRecord[]> {
        const rows = await this.db
            .selectFrom('deadair.ownShows')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('title', 'asc')
            .orderBy('id', 'asc')
            .execute();

        return rows.map(toShow);
    }

    async find(id: string): Promise<OwnShowRecord | undefined> {
        const row = await this.db
            .selectFrom('deadair.ownShows')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('id', '=', id)
            .executeTakeFirst();

        return row === undefined ? undefined : toShow(row);
    }

    async create(show: OwnShowWrite): Promise<OwnShowRecord> {
        const row = await this.db
            .insertInto('deadair.ownShows')
            .values({ stationKey: this.station.stationKey, ...columnsOf(show) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toShow(row);
    }

    /** Rewrites one, whole. `undefined` when there is no such show. */
    async update(id: string, show: OwnShowWrite): Promise<OwnShowRecord | undefined> {
        const row = await this.db
            .updateTable('deadair.ownShows')
            .set(columnsOf(show))
            .where('stationKey', '=', this.station.stationKey)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toShow(row);
    }

    /** Whether there was one to remove. Its episodes keep their rows, no longer filed under it. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.ownShows')
            .where('stationKey', '=', this.station.stationKey)
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }
}

/**
 * Every column an operator writes, with an absent field written as null: an update is a whole rewrite,
 * so a field left out of it is a field cleared rather than one kept.
 */
function columnsOf(show: OwnShowWrite) {
    return {
        title: show.title,
        description: show.description ?? null,
        subject: show.subject ?? null,
        personaId: show.personaId ?? null,
        targetMs: show.targetMs ?? null,
        writingMode: show.writingMode ?? null,
        newsFeedIds: show.newsFeedIds === undefined || show.newsFeedIds.length === 0 ? null : toJsonb([...show.newsFeedIds]),
        newsHours: show.newsHours ?? null,
    };
}

/** One row as the rest of the app reads it. `== null` throughout: see `apps/api/CLAUDE.md`. */
function toShow(row: Record<string, unknown>): OwnShowRecord {
    const mode = row.writingMode == null ? undefined : String(row.writingMode);
    const created = row.createdAt as DateTime | Date | null;
    const feeds = Array.isArray(row.newsFeedIds) ? row.newsFeedIds.filter((feed): feed is string => typeof feed === 'string' && feed.length > 0) : [];

    return {
        id: String(row.id),
        title: String(row.title),
        ...(row.description == null ? {} : { description: String(row.description) }),
        ...(row.subject == null ? {} : { subject: String(row.subject) }),
        ...(row.personaId == null ? {} : { personaId: String(row.personaId) }),
        ...(row.targetMs == null ? {} : { targetMs: Number(row.targetMs) }),
        ...(mode !== undefined && isWritingMode(mode) ? { writingMode: mode } : {}),
        ...(feeds.length === 0 ? {} : { newsFeedIds: feeds }),
        ...(row.newsHours == null ? {} : { newsHours: Number(row.newsHours) }),
        createdAt: created == null ? 0 : created instanceof Date ? created.getTime() : created.toMillis(),
    };
}
