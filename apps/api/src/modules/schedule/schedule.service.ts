import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { readClock } from '#modules/director/clock.bands.js';
import { stationZone } from '#modules/director/clock.words.js';
import { DirectorService } from '#modules/director/director.service.js';
import { resolveSlot, type ScheduleSlot } from '#modules/director/schedule.js';
import type { ScheduleNow, ScheduleSlotInput, ScheduleSlotList, ScheduleTimetable, ScheduleTimetableQuery } from './types/schedule.types.js';
import { project, type StationDate } from './schedule.occurrences.js';
import { ScheduleRepository, type ScheduleSlotDraft } from './schedule.repository.js';

/** A week, which is what a schedule page opens on. */
const DEFAULT_TIMETABLE_DAYS = 7;

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
     * Which slot the clock says should be on, and which one the station is actually airing.
     *
     * Two facts from their two owners, and the console needs both because they legitimately differ:
     * an operator's own choice holds until the next slot BEGINS, so between a takeover and the next
     * boundary the schedule has an answer the station is not following. A page that badged the
     * in-force slot "on now" without checking would be confidently wrong for exactly as long as
     * somebody was doing something deliberate.
     *
     * It reads the director rather than the director reading the schedule, which is the direction
     * that already exists: `DirectorConsoleService` resolves this service, and `modules.ts` puts
     * this module above that one. What is AIRING is the director's to answer.
     *
     * Its own route rather than a field on each slot in the list, because this is a function of the
     * clock: it changes every minute without the schedule changing at all, and folding it in would
     * make a cached grid go stale for a reason that has nothing to do with the grid.
     */
    async current(): Promise<ScheduleNow> {
        const inForce = await this.inForce();
        const airing = this.director.status().slotId;

        return {
            ...(inForce === undefined ? {} : { slotId: inForce.id }),
            ...(airing === undefined ? {} : { airingSlotId: airing }),
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
        const created = await this.slots.create(draftOf(body));
        this.logger.info('schedule: an operator added a slot', { slot: created.id, label: created.label, startsAt: created.startsAtMinutes });

        return this.answer();
    }

    async update(id: string, body: ScheduleSlotInput): Promise<ScheduleSlotList> {
        const updated = await this.slots.update(id, draftOf(body));
        if (updated === undefined) throw httpError(404).withDetails({ message: `schedule slot "${id}" does not exist` });

        this.logger.info('schedule: an operator edited a slot', { slot: id, label: updated.label, startsAt: updated.startsAtMinutes });
        return this.answer();
    }

    async remove(id: string): Promise<ScheduleSlotList> {
        if (!(await this.slots.remove(id))) throw httpError(404).withDetails({ message: `schedule slot "${id}" does not exist` });

        this.logger.info('schedule: an operator deleted a slot', { slot: id });
        return this.answer();
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
        days: body.days ?? [],
        ...(body.sourcePluginId === undefined || body.sourcePlaylistId === undefined
            ? {}
            : { source: { pluginId: body.sourcePluginId, playlistId: body.sourcePlaylistId } }),
        ...(body.personaId?.trim() ? { personaId: body.personaId.trim() } : {}),
        ...(body.brief?.trim() ? { brief: body.brief.trim() } : {}),
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
        days: [...slot.days],
        ...(slot.source === undefined ? {} : { sourcePluginId: slot.source.pluginId, sourcePlaylistId: slot.source.playlistId }),
        ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }),
        ...(slot.brief === undefined ? {} : { brief: slot.brief }),
        mode: slot.mode,
        onEnd: slot.onEnd,
    };
}
