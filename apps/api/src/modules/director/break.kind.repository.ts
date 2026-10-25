import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { AuthoredKind, AuthoredKindDraft } from './break.kind.js';

/**
 * The kinds of break an operator writes, read and written.
 *
 * A plain reader and writer, like `TopicRepository` and `ClockBandRepository`: what a kind MEANS is
 * the writer's business, and nothing here decides whether one may air.
 */
@Injectable()
export class BreakKindRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Every kind this station holds, in the operator's order. The id breaks ties, for `TopicRepository.list`'s reason. */
    async list(): Promise<AuthoredKind[]> {
        const rows = await this.db
            .selectFrom('deadair.breakKinds')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('position', 'asc')
            .orderBy('id', 'asc')
            .execute();

        return rows.map(toKind);
    }

    /** Answers `undefined` for a kind this station does not have. */
    async get(id: string): Promise<AuthoredKind | undefined> {
        const row = await this.db
            .selectFrom('deadair.breakKinds')
            .selectAll()
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row === undefined ? undefined : toKind(row);
    }

    async create(draft: AuthoredKindDraft): Promise<AuthoredKind> {
        const row = await this.db
            .insertInto('deadair.breakKinds')
            .values({ stationKey: this.station.stationKey, key: draft.key, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toKind(row);
    }

    /**
     * Rewrites everything but the key, which is fixed once written (`0117_break_kinds.sql`).
     * Answers `undefined` for a kind this station does not have.
     */
    async update(id: string, draft: AuthoredKindDraft): Promise<AuthoredKind | undefined> {
        const row = await this.db
            .updateTable('deadair.breakKinds')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toKind(row);
    }

    /** Whether there was one to delete. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.breakKinds')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return (result.numDeletedRows ?? 0n) > 0n;
    }
}

function columnsOf(draft: AuthoredKindDraft) {
    return {
        name: draft.name,
        brief: draft.brief,
        rules: draft.rules,
        showsPrevious: draft.showsPrevious,
        showsPlayed: draft.showsPlayed,
        showsFacts: draft.showsFacts,
        showsNotebook: draft.showsNotebook,
        enabled: draft.enabled,
        position: draft.position,
    };
}

function toKind(row: {
    id: string;
    key: string;
    name: string;
    brief: string;
    rules: string[] | null;
    showsPrevious: boolean;
    showsPlayed: boolean;
    showsFacts: boolean;
    showsNotebook: boolean;
    enabled: boolean;
    position: number;
}): AuthoredKind {
    return {
        id: row.id,
        key: row.key,
        name: row.name,
        brief: row.brief,
        // `== null` for the reason in apps/api/CLAUDE.md: a SQL null reads back as `undefined`.
        rules: row.rules == null ? [] : [...row.rules],
        showsPrevious: row.showsPrevious,
        showsPlayed: row.showsPlayed,
        showsFacts: row.showsFacts,
        showsNotebook: row.showsNotebook,
        enabled: row.enabled,
        position: row.position,
    };
}
