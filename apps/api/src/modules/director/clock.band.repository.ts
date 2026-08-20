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
 * airs. `docs/decisions/on-air-ownership.md` is why that separation is worth stating twice.
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
        const rows = await this.db
            .selectFrom('deadair.clockBands')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('enabled', '=', true)
            .orderBy('position', 'asc')
            .orderBy('id', 'asc')
            .execute();

        return rows.map(toBand);
    }

    /** Every band this station has, switched off ones included. For the console. */
    async list(): Promise<ClockBandRecord[]> {
        const rows = await this.db
            .selectFrom('deadair.clockBands')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('position', 'asc')
            .orderBy('id', 'asc')
            .execute();

        return rows.map(toRecord);
    }

    async create(draft: ClockBandDraft): Promise<ClockBandRecord> {
        const row = await this.db
            .insertInto('deadair.clockBands')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toRecord(row);
    }

    /** Answers `undefined` for a band this station does not have, which is a 404 and not a throw. */
    async update(id: string, draft: ClockBandDraft): Promise<ClockBandRecord | undefined> {
        const row = await this.db
            .updateTable('deadair.clockBands')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

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
    if (row.at === 'interval') return { at: 'interval', everyMs: Math.max(1, row.everyMinutes ?? 1) * 60_000, kind: row.kind };

    return { at: 'clock', minute: row.minute ?? 0, ...(row.hour == null ? {} : { hour: row.hour }), kind: row.kind };
}

/** Read back as `undefined` rather than `null`, per the note in CLAUDE.md, so `== null` is the test. */
const toRecord = (row: BandRow): ClockBandRecord => ({ ...toBand(row), id: row.id, position: row.position, enabled: row.enabled });
