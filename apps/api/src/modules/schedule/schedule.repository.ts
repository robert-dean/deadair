import { avoidMoodsField, moodsField } from '#modules/lyrics/lyric.moods.js';
import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { WriterOrder } from '#modules/director/writer.order.js';
import {
    isChartSource,
    isPlaylistSource,
    isStationPlaylistSource,
    type ScheduleSlot,
    type ScheduleSlotSource,
    type SlotPerson,
} from '#modules/director/schedule.js';

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

        return this.withPeople(rows.map(toSlot));
    }

    async create(draft: ScheduleSlotDraft): Promise<ScheduleSlot> {
        const row = await this.db
            .insertInto('deadair.scheduleSlots')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        await this.writePeople(row.id, draft);
        return { ...toSlot(row), ...peopleOf(draft) };
    }

    /** Answers `undefined` for a slot this station does not have, which is a 404 and not a throw. */
    async update(id: string, draft: ScheduleSlotDraft): Promise<ScheduleSlot | undefined> {
        // Read before it is overwritten, because it is the only record of which playlist the slot's
        // place was kept in. See below.
        const before = await this.db
            .selectFrom('deadair.scheduleSlots')
            .select(['sourcePluginId', 'sourcePlaylistId', 'sourceChartId', 'sourceStationPlaylistId'])
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        const row = await this.db
            .updateTable('deadair.scheduleSlots')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        if (row === undefined) return undefined;

        await this.writePeople(row.id, draft);
        // A set prepared for this slot was chosen against the brief this edit replaced. Deleting a
        // slot needs no line of its own: the foreign key cascades. See migration 0080.
        await this.db.deleteFrom('deadair.schedulePreparedSets').where('slotId', '=', row.id).execute();
        // Where the slot got to in its playlist goes only when the edit changed WHICH source it plays.
        // A place in one playlist means nothing in another, but renaming the show or moving its hours
        // is not a reason to start a long playlist from the top again. Turning resuming off keeps the
        // place too, so turning it back on carries on rather than starting over. See migration 0102.
        if (before !== undefined && sourceChanged(before, row)) {
            await this.db.deleteFrom('deadair.schedulePlaylistPositions').where('slotId', '=', row.id).execute();
        }
        return { ...toSlot(row), ...peopleOf(draft) };
    }

    /**
     * The guest hosts on each slot, read in one query and put back on the slots they belong to.
     *
     * Ordered by position, which is precedence: the first guest whose night it is takes it.
     */
    private async withPeople(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
        if (slots.length === 0) return slots;

        const rows = await this.db
            .selectFrom('deadair.scheduleSlotHosts')
            .select(['slotId', 'personaId', 'role', 'days', 'everyN', 'cooldownDays'])
            .where(
                'slotId',
                'in',
                slots.map(slot => slot.id),
            )
            .orderBy('position', 'asc')
            .orderBy('id', 'asc')
            .execute();

        return slots.map(slot => {
            const guests = rows.filter(row => row.slotId === slot.id && row.role === 'guest').map(toPerson);
            const coHosts = rows.filter(row => row.slotId === slot.id && row.role === 'cohost').map(toPerson);
            return {
                ...slot,
                ...(guests.length === 0 ? {} : { guestHosts: guests }),
                ...(coHosts.length === 0 ? {} : { coHosts }),
            };
        });
    }

    /** A slot's guest hosts and co-hosts replaced by the draft's, which is what a `PUT` of the whole slot means. */
    private async writePeople(slotId: string, draft: ScheduleSlotDraft): Promise<void> {
        await this.db.deleteFrom('deadair.scheduleSlotHosts').where('slotId', '=', slotId).execute();

        // Position is per role, which is precedence within it: the first guest whose night it is
        // takes it, and the first co-hosts listed fill a night before a visitor does.
        const people = [
            ...(draft.guestHosts ?? []).map((person, position) => ({ person, position, role: 'guest' as const })),
            ...(draft.coHosts ?? []).map((person, position) => ({ person, position, role: 'cohost' as const })),
        ];
        if (people.length === 0) return;

        await this.db
            .insertInto('deadair.scheduleSlotHosts')
            .values(
                people.map(({ person, position, role }) => ({
                    slotId,
                    personaId: person.personaId,
                    role,
                    position,
                    days: person.days === undefined ? null : sql<string>`${JSON.stringify([...person.days])}::jsonb`,
                    everyN: person.everyN ?? null,
                    cooldownDays: person.cooldownDays ?? null,
                })),
            )
            .execute();
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
        // One arm only, never two: a source that named a playlist AND a chart would be a row
        // `toSlot` has to pick a winner from, which is a decision nobody made.
        sourcePluginId: providerPlaylistOf(draft.source)?.pluginId ?? null,
        sourcePlaylistId: providerPlaylistOf(draft.source)?.playlistId ?? null,
        sourceChartId: isChartSource(draft.source) ? draft.source.chartId : null,
        sourceChartOrder: isChartSource(draft.source) ? (draft.source.chartOrder ?? null) : null,
        sourceStationPlaylistId: isStationPlaylistSource(draft.source) ? draft.source.stationPlaylistId : null,
        personaId: draft.personaId ?? null,
        brief: draft.brief ?? '',
        eraFrom: draft.era?.from ?? null,
        eraTo: draft.era?.to ?? null,
        moods: draft.moods === undefined || draft.moods.length === 0 ? null : draft.moods,
        avoidMoods: draft.avoidMoods === undefined || draft.avoidMoods.length === 0 ? null : draft.avoidMoods,
        callins: draft.callins ?? null,
        mixInSimilar: draft.mixInSimilar ?? null,
        chartPositions: draft.chartPositions ?? null,
        breaks: draft.breaks ?? null,
        requestShow: draft.requestShow ?? null,
        requestFollowOn: draft.requestFollowOn ?? null,
        repeatWindowDays: draft.repeatWindowDays ?? null,
        artistCooldownMinutes: draft.artistCooldownMinutes ?? null,
        maxPerArtist: draft.maxPerArtist ?? null,
        writerOrder: draft.writerOrder ?? null,
        // Cast in SQL rather than handed over as a `DateTime`, because a date is a reading of the
        // station's calendar and not an instant: building one in JS would mean choosing a zone for a
        // value that has none.
        startsOn: draft.dates === undefined ? null : sql<DateTime>`${draft.dates.from}::date`,
        endsOn: draft.dates === undefined ? null : sql<DateTime>`${draft.dates.to}::date`,
        yearly: draft.dates?.yearly ?? false,
        // Only on a playlist, so a slot whose source moves to a chart does not carry a choice that means
        // nothing there back to the console as though it still applied.
        resumePlaylist: draft.resumePlaylist === true && isPlaylistSource(draft.source),
        live: draft.live === true,
        mode: draft.mode,
        onEnd: draft.onEnd,
    };
}

/** The people half of a draft, as the slot written back carries it. */
const peopleOf = (draft: ScheduleSlotDraft): Pick<ScheduleSlot, 'guestHosts' | 'coHosts'> => ({
    ...(draft.guestHosts === undefined || draft.guestHosts.length === 0 ? {} : { guestHosts: draft.guestHosts }),
    ...(draft.coHosts === undefined || draft.coHosts.length === 0 ? {} : { coHosts: draft.coHosts }),
});

/** The columns that name a slot's source. */
interface SourceColumns {
    sourcePluginId: string | null;
    sourcePlaylistId: string | null;
    sourceChartId: string | null;
    sourceStationPlaylistId: string | null;
}

/** Whether an edit changed which source a slot plays, comparing the stored columns before and after. */
const sourceChanged = (before: SourceColumns, after: SourceColumns): boolean =>
    before.sourcePluginId !== after.sourcePluginId ||
    before.sourcePlaylistId !== after.sourcePlaylistId ||
    before.sourceChartId !== after.sourceChartId ||
    before.sourceStationPlaylistId !== after.sourceStationPlaylistId;

/** A stored row as a slot person, dropping what is absent per the `== null` rule. */
function toPerson(row: { personaId: string; days: unknown; everyN: number | null; cooldownDays: number | null }): SlotPerson {
    return {
        personaId: row.personaId,
        ...(row.days == null ? {} : { days: weekdaysIn(row.days) }),
        ...(row.everyN == null ? {} : { everyN: row.everyN }),
        ...(row.cooldownDays == null ? {} : { cooldownDays: row.cooldownDays }),
    };
}

/** The provider-playlist arm of a source, when that is the arm it is. */
function providerPlaylistOf(source: ScheduleSlotSource | undefined): { pluginId: string; playlistId: string } | undefined {
    return source === undefined || isChartSource(source) || isStationPlaylistSource(source) ? undefined : source;
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
    sourceStationPlaylistId: string | null;
    personaId: string | null;
    brief: string;
    eraFrom: number | null;
    eraTo: number | null;
    moods: string[] | null;
    avoidMoods: string[] | null;
    callins: boolean | null;
    mixInSimilar: boolean | null;
    chartPositions: boolean | null;
    breaks: boolean | null;
    requestShow: boolean | null;
    requestFollowOn: number | null;
    repeatWindowDays: number | null;
    artistCooldownMinutes: number | null;
    maxPerArtist: number | null;
    writerOrder: WriterOrder | null;
    startsOn: DateTime | null;
    endsOn: DateTime | null;
    yearly: boolean;
    resumePlaylist: boolean;
    live: boolean;
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
        // Then the station's own playlist, and then the provider's pair, both halves or neither. One
        // without the other is not a source anything could read, and the resolver's caller treats a
        // slot with no source as one the station fills itself. The same order `draftOf` writes with.
        ...(row.sourceChartId != null
            ? { source: { chartId: row.sourceChartId, ...(row.sourceChartOrder == null ? {} : { chartOrder: row.sourceChartOrder }) } }
            : row.sourceStationPlaylistId != null
              ? { source: { stationPlaylistId: row.sourceStationPlaylistId } }
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
        ...moodsField(row.moods),
        ...avoidMoodsField(row.avoidMoods),
        // `== null` rather than a falsy test, because `false` is a real answer here and means the
        // opposite of absent: this slot takes no calls, on a station that otherwise would.
        ...(row.callins == null ? {} : { callins: row.callins }),
        // The same `== null`, for the same reason: `false` is a slot declining a station default.
        ...(row.mixInSimilar == null ? {} : { mixInSimilar: row.mixInSimilar }),
        ...(row.chartPositions == null ? {} : { chartPositions: row.chartPositions }),
        ...(row.breaks == null ? {} : { breaks: row.breaks }),
        ...(row.requestShow == null ? {} : { requestShow: row.requestShow }),
        ...(row.requestFollowOn == null ? {} : { requestFollowOn: row.requestFollowOn }),
        // `== null` once more, and here a falsy test would be the bug itself: `0` is the lift.
        ...(row.repeatWindowDays == null ? {} : { repeatWindowDays: row.repeatWindowDays }),
        ...(row.artistCooldownMinutes == null ? {} : { artistCooldownMinutes: row.artistCooldownMinutes }),
        ...(row.maxPerArtist == null ? {} : { maxPerArtist: row.maxPerArtist }),
        ...(row.writerOrder == null ? {} : { writerOrder: row.writerOrder }),
        // Both ends or neither, which the table already checks; reading one alone as no special keeps
        // a half-written row an ordinary weekly slot rather than a special with an open end. The
        // driver parses a `date` as midnight UTC, so `toISODate` is the calendar date that was stored.
        ...(row.startsOn == null || row.endsOn == null
            ? {}
            : { dates: { from: row.startsOn.toISODate() ?? '', to: row.endsOn.toISODate() ?? '', yearly: row.yearly } }),
        ...(row.resumePlaylist ? { resumePlaylist: true } : {}),
        ...(row.live ? { live: true } : {}),
        mode: row.mode,
        onEnd: row.onEnd,
    };
}
