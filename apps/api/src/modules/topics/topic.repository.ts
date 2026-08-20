import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { Topic, TopicDraft } from './topic.js';

/**
 * The operator's vocabulary, read and written.
 *
 * A plain reader and writer, like `ScheduleRepository` and `ClockBandRepository` beside it: what a
 * topic MEANS is the business of the kind that declared it, and nothing here classifies, resolves or
 * decides anything.
 *
 * ## `config` is read back defensively
 *
 * Postgres hands back whatever went in, and what went in came from a console form. A column holding
 * a string where an object belongs would otherwise reach a classifier that expects to be able to
 * look fields up on it, so anything that is not a plain object is read as `{}` — an unconfigured
 * topic, which is a state the kinds already have to handle, rather than a throw on the path to
 * writing a break.
 */
@Injectable()
export class TopicRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * This station's topics, in the operator's order, for one kind or for all of them.
     *
     * The id is a tiebreaker for `ScheduleRepository.list`'s reason: rows written in one statement
     * share a position as easily as a timestamp, and a list that reshuffles between reads is a page
     * an operator cannot use.
     */
    async list(kind?: string): Promise<Topic[]> {
        let query = this.db.selectFrom('deadair.topics').selectAll().where('stationKey', '=', this.station.stationKey);
        if (kind !== undefined) query = query.where('kind', '=', kind);

        const rows = await query.orderBy('kind', 'asc').orderBy('position', 'asc').orderBy('id', 'asc').execute();
        return rows.map(toTopic);
    }

    /** How many this station holds for a kind, for a seeder asking whether it has anything to do. */
    async countFor(kind: string): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.topics')
            .select(({ fn }) => fn.countAll<string>().as('held'))
            .where('stationKey', '=', this.station.stationKey)
            .where('kind', '=', kind)
            .executeTakeFirst();

        return Number(row?.held ?? 0);
    }

    async create(draft: TopicDraft): Promise<Topic> {
        const row = await this.db
            .insertInto('deadair.topics')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toTopic(row);
    }

    /** Answers `undefined` for a topic this station does not have, which is a 404 and not a throw. */
    async update(id: string, draft: TopicDraft): Promise<Topic | undefined> {
        const row = await this.db
            .updateTable('deadair.topics')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toTopic(row);
    }

    /**
     * Whether there was one to delete.
     *
     * What goes with it is decided by the schema rather than here: a clock band pointing at this
     * topic is deleted with it, because a band that quietly lost its subject would go on reading a
     * general bulletin under a category's name. See `0018_topics.sql`.
     */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.topics')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return (result.numDeletedRows ?? 0n) > 0n;
    }
}

function columnsOf(draft: TopicDraft) {
    return {
        kind: draft.kind.trim(),
        key: draft.key.trim(),
        label: draft.label.trim(),
        config: sql<string>`${JSON.stringify(draft.config ?? {})}::jsonb`,
        position: draft.position,
    };
}

/** Read back as `undefined` rather than `null`, per the note in CLAUDE.md, so `== null` is the test. */
function toTopic(row: { id: string; kind: string; key: string; label: string; config: unknown; position: number }): Topic {
    return {
        id: row.id,
        kind: row.kind,
        key: row.key,
        label: row.label,
        config: settingsIn(row.config),
        position: row.position,
    };
}

/** The settings a stored value actually holds. Anything that is not an object is an unconfigured topic. */
const settingsIn = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
