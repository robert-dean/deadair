import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { readClock } from '#modules/director/clock.bands.js';
import { stationZone } from '#modules/director/clock.words.js';
import { DirectorService } from '#modules/director/director.service.js';
import type { ChartOrder } from '#modules/director/chart.picks.js';
import { isChartSource, overlap, resolveSlot, type ScheduleSlot } from '#modules/director/schedule.js';
import type { ScheduleNow, ScheduleSlotInput, ScheduleSlotList, ScheduleTimetable, ScheduleTimetableQuery } from './types/schedule.types.js';
import { project, stamp, type StationDate } from './schedule.occurrences.js';
import { ScheduleRepository, type ScheduleSlotDraft } from './schedule.repository.js';

/** A week, which is what a schedule page opens on. */
const DEFAULT_TIMETABLE_DAYS = 7;

/**
 * How many blocks ahead {@link ScheduleService.current} answers with.
 *
 * Three: what is on, what is next, and what is after that. A fourth is a timetable, and there is one
 * of those on the same page.
 */
const UPCOMING_BLOCKS = 3;

/**
 * How far ahead to project to find them.
 *
 * A week plus the day we are part-way through, because a slot may run one weekday in seven: looking
 * two days ahead would answer "nothing is scheduled" for a station whose only block is on Sundays,
 * which is the opposite of what it wants said. The projection is over a handful of rows and is
 * thrown away, so the width costs nothing worth saving.
 */
const UPCOMING_DAYS = 8;

/**
 * What the station plays in the hours no block claims.
 *
 * A schedule need not cover the day, so a GAP is an ordinary state rather than a fault, and it has to
 * have an answer or ending a block would mean nothing — the station would simply carry on with what
 * the last one left it, which is the shape this schedule was rebuilt to stop meaning.
 *
 * The answer is a SUSTAINING service, which is what a broadcaster calls the thing that plays when
 * nothing is scheduled. Deliberately NOT silence: the schedule can then never stop a running station,
 * so `Stop` keeps meaning only what an operator meant by it, and the mount lease and the audience
 * gate stay the only things that decide whether the station is on air at all.
 */
export const SUSTAINING_KEYS = {
    pluginId: 'schedule.sustainingPluginId',
    playlistId: 'schedule.sustainingPlaylistId',
    chartId: 'schedule.sustainingChartId',
    chartOrder: 'schedule.sustainingChartOrder',
    brief: 'schedule.sustainingBrief',
    eraFrom: 'schedule.sustainingEraFrom',
    eraTo: 'schedule.sustainingEraTo',
} as const;

/** What the station falls back to between blocks, or `undefined` when the operator has named nothing. */
export interface SustainingSource {
    pluginId?: string;
    playlistId?: string;
    /**
     * A published chart to sustain from instead, qualified as `plugin:chart`.
     *
     * An alternative to the pair above and it wins over one, as it does on a slot. Worth naming what
     * it means here rather than leaving it to be heard: a chart is a fixed document of a few dozen
     * records, so a gap longer than that plays the chart and then extends into the station's own
     * rotation. That is what `onEnd: 'extend'` already does for every other short source, so it is
     * allowed rather than special-cased — but an operator choosing one for the hours nothing claims
     * is choosing a chart followed by a rotation, not a chart on a loop.
     */
    chartId?: string;
    chartOrder?: ChartOrder;
    brief?: string;
    /** The period it plays, on the same terms as a slot's. Either end may stand alone. */
    era?: { from?: number; to?: number };
}

/**
 * The bounds a sustaining year has to fall inside to be believed. As the migrations'.
 *
 * A setting is text an operator typed, so this is the same guard `catalog.resolver.repository.ts`
 * puts on a plugin's year and for the same reason: a value nobody can parse is a period nobody set,
 * and reading `'nineteen eighty'` as `NaN` would narrow the draw to nothing while the console showed
 * the words back.
 */
const SUSTAINING_YEAR_MIN = 1900;
const SUSTAINING_YEAR_MAX = 2100;

/** A stored order, or `undefined` for anything that is not one. */
function chartOrderIn(value: string | undefined): ChartOrder | undefined {
    return value === 'countdown' || value === 'ranked' || value === 'unordered' ? value : undefined;
}

/** A settings pair as a period, or `undefined` when neither end is a year. */
function sustainingEra(from: string | undefined, to: string | undefined): { from?: number; to?: number } | undefined {
    const year = (value: string | undefined): number | undefined => {
        if (value === undefined) return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return undefined;

        const truncated = Math.trunc(parsed);
        return truncated >= SUSTAINING_YEAR_MIN && truncated <= SUSTAINING_YEAR_MAX ? truncated : undefined;
    };

    const start = year(from);
    const end = year(to);
    if (start === undefined && end === undefined) return undefined;

    return { ...(start === undefined ? {} : { from: start }), ...(end === undefined ? {} : { to: end }) };
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
 * The operator's surface over the station's day.
 *
 * ## Every mutation answers the whole schedule
 *
 * Because a slot has no end of its own: it runs until the next one begins, so adding, moving or
 * deleting one changes how its NEIGHBOURS read. A caller handed back only the row it named would be
 * holding a list it has to fetch again to draw.
 *
 * ## Nothing here changes what is on air
 *
 * Writing a slot does not put the station on it, and deleting the slot that is currently on does not
 * take the station off. The tick notices at the next boundary, which is the invariant in
 * `docs/decisions/on-air-ownership.md`: the schedule says WHAT should be on air and never WHEN the
 * changeover happens, because only the director knows where the track boundaries are.
 *
 * ## A dangling reference is voided when the schedule is RESOLVED, not refused when it is saved
 *
 * A slot naming a persona or a playlist that has since gone is left alone here. That is the same
 * call `PersonaRepository.presenting` already makes and for the same reason: refusing to broadcast
 * over a question about the DJ is worse than falling back to the station's own. It also keeps this
 * from needing to reach into the plugin host to check a playlist still exists, on a write that is
 * not the moment anybody finds out.
 */
@Injectable()
export class ScheduleService {
    constructor(
        private readonly slots: ScheduleRepository,
        // The singleton that owns the running order, for {@link current} alone. Resolved at request
        // time, so this module sitting above DirectorModule in `modules.ts` is a lifecycle order
        // rather than a resolution one.
        private readonly director: DirectorService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async list(): Promise<ScheduleSlotList> {
        return this.answer();
    }

    /**
     * The slot in force at an instant, or `undefined` for a station with no schedule.
     *
     * Not a route. It is the one reader both changeover paths share: the tick asks it to decide
     * whether the station is airing what it should be, and an operator's own `putOnAir` asks it so
     * the broadcast it starts is STAMPED with the slot it lands in. That second one is what makes a
     * manual takeover hold until the next boundary rather than being undone a minute later, and
     * having one implementation is what stops the two from ever disagreeing about which slot is on.
     *
     * **Ask it for NOW.** It takes an instant because that is what keeps `resolveSlot` pure, not
     * because anything should look ahead: a caller resolving for a later airtime would straddle a
     * boundary and disagree with a live-clock caller about which show is on, and whoever wrote
     * second would win. See the note on `resolveSlot`.
     */
    async inForce(at: Date = new Date()): Promise<ScheduleSlot | undefined> {
        return resolveSlot(at, stationZone(this.config), await this.slots.list());
    }

    /**
     * What the station plays when no block is on, or `undefined` when nothing has been named.
     *
     * `undefined` is a real state and not a misconfiguration to shout about: a station whose schedule
     * covers the whole day never reaches a gap. It becomes worth saying only when there IS a gap,
     * which is a question the console can answer and this cannot.
     */
    sustaining(): SustainingSource | undefined {
        const read = (key: string): string | undefined => {
            const value = this.config.get(key, '').trim();
            return value.length === 0 ? undefined : value;
        };

        // A settings layer holds STRINGS, so a year has to be parsed rather than read: `config.get`
        // would answer `'1975'`, which is not a number and compares as one only by accident. See
        // `settingIsOn`'s note in CLAUDE.md for the same bug in its boolean form.
        const era = sustainingEra(read(SUSTAINING_KEYS.eraFrom), read(SUSTAINING_KEYS.eraTo));

        const source: SustainingSource = {
            ...(read(SUSTAINING_KEYS.pluginId) === undefined ? {} : { pluginId: read(SUSTAINING_KEYS.pluginId) }),
            ...(read(SUSTAINING_KEYS.playlistId) === undefined ? {} : { playlistId: read(SUSTAINING_KEYS.playlistId) }),
            ...(read(SUSTAINING_KEYS.chartId) === undefined ? {} : { chartId: read(SUSTAINING_KEYS.chartId) }),
            // Read through the same guard a year is: a setting is text an operator's console wrote,
            // and an order nothing recognises is an order nobody set. Falling back to absent leaves
            // `putOnAir` to mean by it what it means for anyone pressing the button by hand.
            ...(chartOrderIn(read(SUSTAINING_KEYS.chartOrder)) === undefined ? {} : { chartOrder: chartOrderIn(read(SUSTAINING_KEYS.chartOrder)) }),
            ...(read(SUSTAINING_KEYS.brief) === undefined ? {} : { brief: read(SUSTAINING_KEYS.brief) }),
            ...(era === undefined ? {} : { era }),
        };

        // A brief on its own is a coherent sustaining service: the station programmes itself and is
        // told what to aim for. A period on its own is one too. Nothing at all is not.
        return Object.keys(source).length === 0 ? undefined : source;
    }

    /**
     * Which slot the clock says should be on, which one the station is actually airing, and what is
     * coming after it.
     *
     * ## Two slot ids rather than one
     *
     * They legitimately differ: an operator's own choice holds until the next slot BEGINS, so between
     * a takeover and the next boundary the schedule has an answer the station is not following. A page
     * that badged the in-force slot "on now" without checking would be confidently wrong for exactly
     * as long as somebody was doing something deliberate. It reads the director rather than the
     * director reading the schedule, which is the direction that already exists: `DirectorConsoleService`
     * resolves this service, and `modules.ts` puts this module above that one. What is AIRING is the
     * director's to answer.
     *
     * ## The blocks come from here rather than from the console
     *
     * A page that leads with "on now, up next" needs blocks with both ENDS, and `schedule.occurrences.ts`
     * opens by saying why a browser must not derive them: it does not know `station.timezone` and has
     * no business turning a weekday mask into dates. So it reuses `project` — one projection, not a
     * second implementation that could disagree with the grid drawn underneath it.
     *
     * `now` rides along for the same reason one step further out. "One hour left" is a subtraction
     * between two readings of one clock, which a caller can do; picking the clock is what it cannot.
     * Both readings come from the same `readClock` here, so they cannot be a boundary apart.
     *
     * ## Its own route rather than a field on each slot
     *
     * Because this is a function of the clock: it changes every minute without the schedule changing
     * at all, and folding it in would make a cached grid go stale for a reason that has nothing to do
     * with the grid.
     */
    async current(): Promise<ScheduleNow> {
        const clock = readClock(Date.now(), stationZone(this.config));
        const today: StationDate = { year: clock.year, month: clock.month, day: clock.day, weekday: clock.weekday };
        const now = stamp(today, clock.hour * 60 + clock.minute, clock.second);

        const inForce = await this.inForce();
        const airing = this.director.status().slotId;

        // Anything still to come, which for the block on now means the one it is part-way through:
        // a block is over when it ENDS, and its end is exclusive. String comparison is the whole
        // check because both stamps are fixed-width and zero-padded readings of one clock.
        const upcoming = project(today, UPCOMING_DAYS, await this.slots.list())
            .filter(occurrence => occurrence.end > now)
            .slice(0, UPCOMING_BLOCKS);

        return {
            now,
            ...(inForce === undefined ? {} : { slotId: inForce.id }),
            ...(airing === undefined ? {} : { airingSlotId: airing }),
            upcoming,
        };
    }

    /**
     * The station's day as blocks with both ends, for a console that draws a timetable.
     *
     * ## The station anchors it, not the caller
     *
     * `from` is a date on the STATION's calendar, and a browser cannot work one out: it does not know
     * `station.timezone`, and a console in another zone would ask for the wrong day for several hours
     * either side of midnight. So an absent `from` means the station's own today, and the answer
     * echoes the range it used — which is what lets a caller step forward and back by adding days to
     * a string rather than by learning the zone.
     *
     * ## It never touches an instant after this line
     *
     * One `readClock` to find out what day it is here, and everything below is wall-clock arithmetic.
     * That is what keeps the timetable as free of daylight-saving trouble as the resolver it shares
     * its core with; see `schedule.occurrences.ts`.
     */
    async timetable(query: ScheduleTimetableQuery): Promise<ScheduleTimetable> {
        const days = query.days ?? DEFAULT_TIMETABLE_DAYS;
        const from = this.anchor(query.from);
        const slots = await this.slots.list();

        return {
            from: `${pad(from.year, 4)}-${pad(from.month)}-${pad(from.day)}`,
            days,
            occurrences: project(from, days, slots),
        };
    }

    /**
     * The day to start drawing from, as a date on the station's calendar.
     *
     * A `from` that does not parse falls back to today rather than erroring, because the failure it
     * would otherwise produce is a blank timetable on a page whose only fault is a hand-typed URL.
     * The weekday has to be DERIVED from the date rather than taken from the caller — it is the one
     * field a client could get wrong in a way that silently draws the wrong schedule.
     */
    private anchor(from: string | undefined): StationDate {
        const today = readClock(Date.now(), stationZone(this.config));
        const match = from === undefined ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
        if (!match) return { year: today.year, month: today.month, day: today.day, weekday: today.weekday };

        const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
        // Through UTC, which is safe because this is civil arithmetic on a date rather than a claim
        // about a moment: UTC has no daylight saving, so it is the calendar with no opinions.
        const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

        return { year, month, day, weekday };
    }

    async create(body: ScheduleSlotInput): Promise<ScheduleSlotList> {
        const draft = draftOf(body);
        await this.refuseOverlap(draft);

        const created = await this.slots.create(draft);
        this.logger.info('schedule: an operator added a slot', { slot: created.id, label: created.label, startsAt: created.startsAtMinutes });

        return this.answer();
    }

    async update(id: string, body: ScheduleSlotInput): Promise<ScheduleSlotList> {
        const draft = draftOf(body);
        await this.refuseOverlap(draft, id);

        const updated = await this.slots.update(id, draft);
        if (updated === undefined) throw httpError(404).withDetails({ message: `schedule slot "${id}" does not exist` });

        this.logger.info('schedule: an operator edited a slot', { slot: id, label: updated.label, startsAt: updated.startsAtMinutes });
        return this.answer();
    }

    async remove(id: string): Promise<ScheduleSlotList> {
        if (!(await this.slots.remove(id))) throw httpError(404).withDetails({ message: `schedule slot "${id}" does not exist` });

        this.logger.info('schedule: an operator deleted a slot', { slot: id });
        return this.answer();
    }

    /**
     * Refuse a block that is on at the same time as one already there.
     *
     * A 409 rather than a resolution, and the editor is why: "the usual show, except Wednesdays" is
     * the usual one on the other six days plus a second block on Wednesday, which an operator writes
     * with the day checkboxes and can then SEE on the grid. A precedence rule would air the same
     * schedule while keeping the reason for it in the code.
     *
     * The comparison is `overlap`, which expands both sides first: an empty `days` means all seven,
     * and a block running past midnight spends its tail on the following weekday, so a late Monday
     * show and an early Tuesday one can collide without either row mentioning a shared day.
     *
     * `except` is the row being edited, which must not be compared against itself.
     */
    private async refuseOverlap(draft: ScheduleSlotDraft, except?: string): Promise<void> {
        const candidate = { ...draft, id: except ?? '' } as ScheduleSlot;
        const clash = (await this.slots.list()).find(slot => slot.id !== except && overlap(candidate, slot));
        if (clash === undefined) return;

        throw httpError(409).withDetails({
            message: `that overlaps "${clash.label || 'another slot'}", which is already on then. Two blocks cannot be on at once — take the days they share off one of them.`,
        });
    }

    private async answer(): Promise<ScheduleSlotList> {
        return { slots: (await this.slots.list()).map(forTheWire) };
    }
}

/**
 * A request body as a draft.
 *
 * A source is both halves or neither, because one without the other names nothing a playlist reader
 * could be asked for. Sending one alone is treated as sending none rather than refused: what it
 * produces is a slot the station fills itself, which is a coherent slot.
 */
function draftOf(body: ScheduleSlotInput): ScheduleSlotDraft {
    return {
        label: body.label,
        startsAtMinutes: body.startsAtMinutes,
        endsAtMinutes: body.endsAtMinutes,
        days: body.days ?? [],
        // A chart wins over the pair, which is the same precedence `ScheduleRepository` reads a row
        // back with. A body naming both is a caller sending a contradiction, and answering it the
        // same way in both directions is what stops a write and its read-back disagreeing.
        ...(body.sourceChartId !== undefined
            ? { source: { chartId: body.sourceChartId, ...(body.sourceChartOrder === undefined ? {} : { chartOrder: body.sourceChartOrder }) } }
            : body.sourcePluginId === undefined || body.sourcePlaylistId === undefined
              ? {}
              : { source: { pluginId: body.sourcePluginId, playlistId: body.sourcePlaylistId } }),
        ...(body.personaId?.trim() ? { personaId: body.personaId.trim() } : {}),
        ...(body.brief?.trim() ? { brief: body.brief.trim() } : {}),
        ...(body.eraFrom === undefined && body.eraTo === undefined
            ? {}
            : { era: { ...(body.eraFrom === undefined ? {} : { from: body.eraFrom }), ...(body.eraTo === undefined ? {} : { to: body.eraTo }) } }),
        // `=== undefined` rather than a falsy test: `false` is a real answer meaning this slot takes
        // no calls, which is not the same as never having been asked.
        ...(body.callins === undefined ? {} : { callins: body.callins }),
        mode: body.mode,
        onEnd: body.onEnd,
    };
}

/** The stored shape flattened back to the wire's, where a source is two optional fields rather than one object. */
function forTheWire(slot: ScheduleSlot): ScheduleSlotList['slots'][number] {
    return {
        id: slot.id,
        label: slot.label,
        startsAtMinutes: slot.startsAtMinutes,
        endsAtMinutes: slot.endsAtMinutes,
        days: [...slot.days],
        ...(slot.source === undefined
            ? {}
            : isChartSource(slot.source)
              ? { sourceChartId: slot.source.chartId, ...(slot.source.chartOrder === undefined ? {} : { sourceChartOrder: slot.source.chartOrder }) }
              : { sourcePluginId: slot.source.pluginId, sourcePlaylistId: slot.source.playlistId }),
        ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }),
        ...(slot.brief === undefined ? {} : { brief: slot.brief }),
        ...(slot.era?.from === undefined ? {} : { eraFrom: slot.era.from }),
        ...(slot.era?.to === undefined ? {} : { eraTo: slot.era.to }),
        ...(slot.callins === undefined ? {} : { callins: slot.callins }),
        mode: slot.mode,
        onEnd: slot.onEnd,
    };
}
