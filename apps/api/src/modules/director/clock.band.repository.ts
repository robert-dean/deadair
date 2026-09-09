import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { ClockBand, ClockBandDraft, ClockBandRecord } from './clock.bands.js';

/**
 * The station's format clock, as rows.
 *
 * A plain reader and writer, the same shape `ScheduleRepository` is and for the same reason: this is
 * a stored document that the planner reads on its pass, and nothing here holds an opinion about what
 * airs. `docs/internals/director.md` § "Who owns the running order" is why that separation is worth
 * stating twice.
 *
 * ## Two reads, and they are not the same question
 *
 * {@link active} is what the planner and the production scheduler ask: the rules that are in force,
 * in the order the operator put them in. {@link list} is what the console asks: everything, including
 * the rules that are switched off, because an operator cannot turn a rule back on that they cannot
 * see. Handing the planner the console's answer would have it walking bands somebody had explicitly
 * turned off.
 *
 * ## Minutes go in, milliseconds come out
 *
 * The column is `every_minutes` because that is what an operator writes and what a console shows;
 * {@link ClockBand} carries `everyMs` because every consumer does arithmetic with it against
 * `Date.now()`. The conversion is here rather than at either end, so there is exactly one place the
 * two units meet — the same reason `starts_at_minutes` is read into a resolver that compares minutes
 * and never instants.
 */
@Injectable()
export class ClockBandRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * The rules in force, in the operator's own order.
     *
     * Ordered by `position` and then by `id`, which is `ScheduleRepository.list`'s tiebreaker and is
     * there for the same reason: rows written in one statement share a position as easily as a
     * timestamp, and precedence that reshuffles between passes is a clock nobody can reason about.
     */
    async active(): Promise<ClockBand[]> {
        const rows = await this.withSubject()
            .where('enabled', '=', true)
            .orderBy('position', 'asc')
            .orderBy('deadair.clockBands.id', 'asc')
            .execute();

        return rows.map(toBand);
    }

    /** Every band this station has, switched off ones included. For the console. */
    async list(): Promise<ClockBandRecord[]> {
        const rows = await this.withSubject().orderBy('position', 'asc').orderBy('deadair.clockBands.id', 'asc').execute();

        return rows.map(toRecord);
    }

    /**
     * The band, with whatever subject it names.
     *
     * A LEFT join rather than a second read, because a band with no subject is the ordinary case and
     * a second query per pass would pay for the exception. The key and the label ride along for the
     * reason `ClockBandSubject` gives: what a writer reads is the key, and going back to the table
     * for it would be a query on the path to writing a break.
     */
    private withSubject() {
        return this.db
            .selectFrom('deadair.clockBands')
            .leftJoin('deadair.topics', 'deadair.topics.id', 'deadair.clockBands.topicId')
            .select([
                'deadair.clockBands.id as id',
                'deadair.clockBands.kind as kind',
                'deadair.clockBands.at as at',
                'deadair.clockBands.hour as hour',
                'deadair.clockBands.minute as minute',
                'deadair.clockBands.everyMinutes as everyMinutes',
                'deadair.clockBands.position as position',
                'deadair.clockBands.enabled as enabled',
                'deadair.clockBands.topicId as topicId',
                'deadair.topics.key as topicKey',
                'deadair.topics.label as topicLabel',
            ])
            .where('deadair.clockBands.stationKey', '=', this.station.stationKey);
    }

    async create(draft: ClockBandDraft): Promise<ClockBandRecord | undefined> {
        const row = await this.db
            .insertInto('deadair.clockBands')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returning('id')
            .executeTakeFirstOrThrow();

        return await this.find(row.id);
    }

    /** Answers `undefined` for a band this station does not have, which is a 404 and not a throw. */
    async update(id: string, draft: ClockBandDraft): Promise<ClockBandRecord | undefined> {
        const row = await this.db
            .updateTable('deadair.clockBands')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returning('id')
            .executeTakeFirst();

        return row === undefined ? undefined : await this.find(row.id);
    }

    /** One band with its subject, which is what a write answers with. */
    private async find(id: string): Promise<ClockBandRecord | undefined> {
        const row = await this.withSubject().where('deadair.clockBands.id', '=', id).executeTakeFirst();

        return row === undefined ? undefined : toRecord(row);
    }

    /** Whether there was one to delete. A band going mid-hour costs the slot it would have claimed. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.clockBands')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return (result.numDeletedRows ?? 0n) > 0n;
    }
}

/** The row a draft writes. The shape check in the migration is what keeps the two halves exclusive. */
function columnsOf(draft: ClockBandDraft) {
    return {
        kind: draft.kind.trim(),
        at: draft.at,
        hour: draft.at === 'clock' ? (draft.hour ?? null) : null,
        minute: draft.at === 'clock' ? draft.minute : null,
        everyMinutes: draft.at === 'interval' ? Math.max(1, Math.round(draft.everyMs / 60_000)) : null,
        position: draft.position ?? 0,
        enabled: draft.enabled ?? true,
        // The id alone: the key and the label are the topic row's own and are read back through the
        // join. Storing a copy here would be a second writer of the same fact.
        topicId: draft.topic?.id ?? null,
    };
}

interface BandRow {
    id: string;
    kind: string;
    at: 'clock' | 'interval';
    hour: number | null;
    minute: number | null;
    everyMinutes: number | null;
    position: number;
    enabled: boolean;
    topicId: string | null;
    topicKey: string | null;
    topicLabel: string | null;
}

/**
 * The rule a row states.
 *
 * Read back defensively for `ScheduleRepository.days`'s reason: the check constraint says a `clock`
 * row has a minute and an `interval` row has a positive `every_minutes`, but a null read as `0`
 * would be a band firing at the top of every hour or at every boundary forever, and neither is
 * something an operator asked for. A missing half falls back to the value that makes the band inert
 * rather than loud.
 */
function toBand(row: BandRow): ClockBand {
    // A row whose topic went is a row the database would have deleted, so a present id with no key
    // beside it can only be a join that found nothing — read as no subject rather than as a subject
    // nothing can name.
    const subject =
        row.topicId == null || row.topicKey == null ? {} : { topic: { id: row.topicId, key: row.topicKey, label: row.topicLabel ?? row.topicKey } };

    if (row.at === 'interval') return { at: 'interval', everyMs: Math.max(1, row.everyMinutes ?? 1) * 60_000, kind: row.kind, ...subject };

    return { at: 'clock', minute: row.minute ?? 0, ...(row.hour == null ? {} : { hour: row.hour }), kind: row.kind, ...subject };
}

/** Read back as `undefined` rather than `null`, per the note in CLAUDE.md, so `== null` is the test. */
const toRecord = (row: BandRow): ClockBandRecord => ({ ...toBand(row), id: row.id, position: row.position, enabled: row.enabled });
