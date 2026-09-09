import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { isChartSource, type ScheduleSlot } from '#modules/director/schedule.js';

/**
 * The slots an operator has written.
 *
 * A plain reader and writer, and that is the whole of it. The ownership rule
 * (`docs/internals/director.md` § "Who owns the running order") is explicit that the schedule is a
 * stored document with a pure resolver over it and must never become a second stateful owner of what
 * airs, so nothing here holds an opinion about which slot is on: that question is `resolveSlot` in
 * `#modules/director/schedule.js`, and the answer is recorded on the running order, which the
 * director alone writes.
 *
 * ## `days` is read back defensively
 *
 * Postgres hands back whatever went in, and what went in came from a console form. A column holding
 * a string where an array of weekdays belongs would otherwise decide which day a show airs on, so
 * {@link weekdaysIn} keeps only the integers that are actually weekdays and answers an empty list
 * for anything else. Empty means EVERY day, which is the same call the resolver makes, and the
 * failure mode is therefore a slot that runs more often than it was meant to rather than a schedule
 * that throws while the station is trying to change over.
 */
@Injectable()
export class ScheduleRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Every slot this station has, earliest in the day first.
     *
     * Ordered for the console rather than for the resolver, which sorts nothing and compares start
     * minutes directly. The id is a tiebreaker for the same reason personas keeps one: rows written
     * in one statement share a timestamp, and a list that reshuffles between reads is a page an
     * operator cannot use.
     */
    async list(): Promise<ScheduleSlot[]> {
        const rows = await this.db
            .selectFrom('deadair.scheduleSlots')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('startsAtMinutes', 'asc')
            .orderBy('id', 'asc')
            .execute();

        return rows.map(toSlot);
    }

    async create(draft: ScheduleSlotDraft): Promise<ScheduleSlot> {
        const row = await this.db
            .insertInto('deadair.scheduleSlots')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toSlot(row);
    }

    /** Answers `undefined` for a slot this station does not have, which is a 404 and not a throw. */
    async update(id: string, draft: ScheduleSlotDraft): Promise<ScheduleSlot | undefined> {
        const row = await this.db
            .updateTable('deadair.scheduleSlots')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toSlot(row);
    }

    /** Whether there was one to delete. A slot going while its show is on air is legitimate: see the migration. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.scheduleSlots')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return (result.numDeletedRows ?? 0n) > 0n;
    }
}

/** A slot as the operator wrote it, before the database gives it an id. */
export type ScheduleSlotDraft = Omit<ScheduleSlot, 'id'>;

function columnsOf(draft: ScheduleSlotDraft) {
    return {
        label: draft.label,
        startsAtMinutes: draft.startsAtMinutes,
        endsAtMinutes: draft.endsAtMinutes,
        days: sql<string>`${JSON.stringify([...draft.days])}::jsonb`,
        // One arm or the other, never both: a source that named a playlist AND a chart would be a
        // row `toSlot` has to pick a winner from, which is a decision nobody made.
        sourcePluginId: isChartSource(draft.source) ? null : (draft.source?.pluginId ?? null),
        sourcePlaylistId: isChartSource(draft.source) ? null : (draft.source?.playlistId ?? null),
        sourceChartId: isChartSource(draft.source) ? draft.source.chartId : null,
        sourceChartOrder: isChartSource(draft.source) ? (draft.source.chartOrder ?? null) : null,
        personaId: draft.personaId ?? null,
        brief: draft.brief ?? '',
        eraFrom: draft.era?.from ?? null,
        eraTo: draft.era?.to ?? null,
        callins: draft.callins ?? null,
        mode: draft.mode,
        onEnd: draft.onEnd,
    };
}

/** The weekdays a stored value actually names. Anything else is an empty list, which means every day. */
function weekdaysIn(value: unknown): number[] {
    if (!Array.isArray(value)) return [];

    return value.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 6);
}

/** Read back as `undefined` rather than `null`, per the note in CLAUDE.md, so `== null` is the test. */
function toSlot(row: {
    id: string;
    label: string;
    startsAtMinutes: number;
    endsAtMinutes: number;
    days: unknown;
    sourcePluginId: string | null;
    sourcePlaylistId: string | null;
    sourceChartId: string | null;
    sourceChartOrder: 'countdown' | 'ranked' | 'unordered' | null;
    personaId: string | null;
    brief: string;
    eraFrom: number | null;
    eraTo: number | null;
    callins: boolean | null;
    mode: 'rotation' | 'setlist' | 'feature';
    onEnd: 'extend' | 'repeat' | 'stop';
}): ScheduleSlot {
    return {
        id: row.id,
        label: row.label,
        startsAtMinutes: row.startsAtMinutes,
        endsAtMinutes: row.endsAtMinutes,
        days: weekdaysIn(row.days),
        // A chart FIRST, because it is one column and the pair is two: a row holding both is not
        // something the writer above can produce, and reading it as the chart is the answer that
        // needs no second rule about which half of a contradiction to believe.
        //
        // Otherwise both halves or neither. One without the other is not a source anything could
        // read, and the resolver's caller treats a slot with no source as one the station fills
        // itself.
        ...(row.sourceChartId != null
            ? { source: { chartId: row.sourceChartId, ...(row.sourceChartOrder == null ? {} : { chartOrder: row.sourceChartOrder }) } }
            : row.sourcePluginId == null || row.sourcePlaylistId == null
              ? {}
              : { source: { pluginId: row.sourcePluginId, playlistId: row.sourcePlaylistId } }),
        ...(row.personaId == null ? {} : { personaId: row.personaId }),
        ...(row.brief.trim().length === 0 ? {} : { brief: row.brief }),
        // Absent entirely when neither end is set, so a slot with no period and one that was never
        // asked about a period are the same thing to every reader.
        ...(row.eraFrom == null && row.eraTo == null
            ? {}
            : { era: { ...(row.eraFrom == null ? {} : { from: row.eraFrom }), ...(row.eraTo == null ? {} : { to: row.eraTo }) } }),
        // `== null` rather than a falsy test, because `false` is a real answer here and means the
        // opposite of absent: this slot takes no calls, on a station that otherwise would.
        ...(row.callins == null ? {} : { callins: row.callins }),
        mode: row.mode,
        onEnd: row.onEnd,
    };
}
