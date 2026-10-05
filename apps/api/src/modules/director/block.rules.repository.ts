import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { BlockRule } from './block.rules.js';
import type { StationMode } from './types/director.types.js';

/** A rule as an operator writes one: everything but the id. */
export type BlockRuleDraft = Omit<BlockRule, 'id'>;

/** A lean in force: which genres, and until when. */
export interface GenreSteerRow {
    genres: string[];
    /** ISO instant. */
    endsAt: string;
}

const MODES: readonly StationMode[] = ['rotation', 'setlist', 'feature'];

/**
 * The station's never-play rules and its one lean, as rows.
 *
 * Station-scoped like every other station-owned table. Answers the JSON-safe shapes `block.rules.ts`
 * judges with, so the director can read them on a commit pass without knowing a column.
 */
@Injectable()
export class BlockRulesRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Every rule, newest first. Expired ones included: the console shows what held yesterday, the judge skips it. */
    async list(): Promise<BlockRule[]> {
        const rows = await this.db
            .selectFrom('deadair.blockRules')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('createdAt', 'desc')
            .execute();

        return rows.map(toRule);
    }

    async add(draft: BlockRuleDraft): Promise<BlockRule> {
        const row = await this.db
            .insertInto('deadair.blockRules')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toRule(row);
    }

    /** `undefined` for a rule this station does not have. */
    async change(id: string, draft: BlockRuleDraft): Promise<BlockRule | undefined> {
        const row = await this.db
            .updateTable('deadair.blockRules')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toRule(row);
    }

    /** Whether there was one to remove. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.blockRules')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return (result.numDeletedRows ?? 0n) > 0n;
    }

    /** The lean in force, or `undefined` once it has run out. An expired row is left for the next write to replace. */
    async steer(): Promise<GenreSteerRow | undefined> {
        const row = await this.db
            .selectFrom('deadair.genreSteers')
            .select(['genres', 'endsAt'])
            .where('stationKey', '=', this.station.stationKey)
            .where('endsAt', '>', sql<DateTime>`now()`)
            .executeTakeFirst();

        return row === undefined ? undefined : { genres: row.genres, endsAt: iso(row.endsAt) };
    }

    /** Lean toward `genres` for `hours` from now, replacing whatever lean there was. */
    async setSteer(genres: readonly string[], hours: number): Promise<GenreSteerRow> {
        const endsAt = sql<DateTime>`now() + make_interval(hours => ${hours})`;
        const row = await this.db
            .insertInto('deadair.genreSteers')
            .values({ stationKey: this.station.stationKey, genres: [...genres], endsAt })
            .onConflict(oc => oc.column('stationKey').doUpdateSet({ genres: [...genres], endsAt, createdAt: sql<DateTime>`now()` }))
            .returning(['genres', 'endsAt'])
            .executeTakeFirstOrThrow();

        return { genres: row.genres, endsAt: iso(row.endsAt) };
    }

    async clearSteer(): Promise<void> {
        await this.db.deleteFrom('deadair.genreSteers').where('stationKey', '=', this.station.stationKey).execute();
    }
}

type RuleRow = {
    id: string;
    field: 'genre' | 'tag';
    value: string;
    seasonFrom: string | null;
    seasonTo: string | null;
    fromHour: number | null;
    untilHour: number | null;
    modes: string[];
    slotIds: string[];
    endsAt: DateTime | null;
};

/** A row as the judge reads it, dropping every absent scope rather than passing a null through (`apps/api/CLAUDE.md`). */
function toRule(row: RuleRow): BlockRule {
    const modes = (row.modes ?? []).filter((mode): mode is StationMode => (MODES as readonly string[]).includes(mode));
    return {
        id: row.id,
        field: row.field,
        value: row.value,
        ...(row.seasonFrom == null ? {} : { seasonFrom: row.seasonFrom }),
        ...(row.seasonTo == null ? {} : { seasonTo: row.seasonTo }),
        ...(row.fromHour == null ? {} : { fromHour: row.fromHour }),
        ...(row.untilHour == null ? {} : { untilHour: row.untilHour }),
        ...(modes.length === 0 ? {} : { modes }),
        ...((row.slotIds ?? []).length === 0 ? {} : { slotIds: row.slotIds }),
        ...(row.endsAt == null ? {} : { endsAt: iso(row.endsAt) }),
    };
}

/** A draft as columns, with every absent scope stored as the column's own "always". */
function columnsOf(draft: BlockRuleDraft) {
    return {
        field: draft.field,
        value: draft.value.trim(),
        seasonFrom: draft.seasonFrom ?? null,
        seasonTo: draft.seasonTo ?? null,
        fromHour: draft.fromHour ?? null,
        untilHour: draft.untilHour ?? null,
        modes: [...(draft.modes ?? [])],
        slotIds: [...(draft.slotIds ?? [])],
        endsAt: draft.endsAt === undefined ? null : DateTime.fromISO(draft.endsAt),
    };
}

/** A timestamp column as ISO text, whichever shape the driver handed back. */
const iso = (value: DateTime | Date | string): string =>
    DateTime.isDateTime(value) ? (value.toISO() ?? '') : value instanceof Date ? value.toISOString() : (DateTime.fromISO(value).toISO() ?? value);
