import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { stationZone } from '#modules/director/clock.words.js';
import { resolveSlot, type ScheduleSlot } from '#modules/director/schedule.js';
import type { ScheduleSlotInput, ScheduleSlotList } from './types/schedule.types.js';
import { ScheduleRepository, type ScheduleSlotDraft } from './schedule.repository.js';

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
