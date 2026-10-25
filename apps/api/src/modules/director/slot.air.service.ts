import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { avoidMoodsField, moodsField } from '#modules/lyrics/lyric.moods.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { ScheduleRepository } from '#modules/schedule/schedule.repository.js';
import { ScheduleService } from '#modules/schedule/schedule.service.js';
import type { ScheduleSlotApplied, ScheduleSlotPart } from '#modules/schedule/types/schedule.types.js';
import { rulesAskedFor } from './director.console.service.js';
import { DirectorService } from './director.service.js';
import type { ReplanLineupPayload } from './replan.lineup.job.js';
import { resolveRules, stationRules } from './rotation.rules.js';
import { isChartSource, isStationPlaylistSource, type ScheduleSlot } from './schedule.js';
import { slotInput } from './slot.input.js';
import type { ProgrammeChange, StationLineupRules, StationLineupSnapshot } from './station.lineup.js';
import type { PutOnAirInput } from './types/director.types.js';

/** A slot id is a uuid, and anything else would reach Postgres as a type error rather than a 404. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rules that change which records are chosen, as opposed to how the show around them behaves. */
const CHOICE_RULES = ['repeatWindowDays', 'artistCooldownMinutes', 'maxPerArtist'] as const satisfies readonly (keyof StationLineupRules)[];

/**
 * Apply a slot, as it is saved now, to the show on air.
 *
 * Saving a slot never touches the air: `ScheduleService.update` writes the row and the show on air
 * follows it the next time the slot comes round, which is the invariant the schedule lives inside.
 * This is the separate act an operator takes when they want the show they are listening to changed
 * too, and it changes it the way an operator at the desk would, never by starting it again.
 * `putOnAir` would mint a new broadcast, retract what the player holds and open on an empty order
 * while a model chose the first records: minutes of silence for a change of brief.
 *
 * So the slot is read the way a changeover reads it (`slotInput`, with tonight's host), compared
 * with the broadcast on air, and only what differs is posted:
 *
 * - the programme (name, brief, period, moods, rules) as one `reprogramme`, written through;
 * - the host as a `recast`, which also has the breaks the outgoing host wrote written again;
 * - and, when the change reaches which records are chosen, a replan, which keeps the old tail
 *   playing until it has a new one to put there.
 *
 * What cannot change mid-show is reported rather than forced. A different source, mode or end is a
 * different programme, and only a changeover builds one; the co-hosts are settled for the night when
 * it begins. Those wait for the slot's next occurrence, exactly as everything did before this.
 *
 * Here rather than on `ScheduleService` for `SlotPlaylistService`'s reason: it posts to the director,
 * and the director console already depends on the schedule.
 */
@Injectable()
export class SlotAirService {
    constructor(
        private readonly slots: ScheduleRepository,
        // For tonight's host and co-hosts, which a guest sitting in makes something other than the
        // slot's own. Read the way the changeover reads them.
        private readonly schedule: ScheduleService,
        // The singleton that owns the running order: read for what is on, posted to for the change.
        private readonly director: DirectorService,
        private readonly jobs: JobBroker,
        private readonly config: AppConfig,
        private readonly context: AuthorizationContext,
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    async apply(id: string): Promise<ScheduleSlotApplied> {
        const slot = await this.slotOr404(id);
        const order = this.director.order();
        if (order?.slotId !== slot.id) {
            throw httpError(409).withDetails({
                message: `"${slot.label || 'that slot'}" is not on air, so there is no show to apply it to. Its changes apply the next time it comes round.`,
            });
        }

        const night = this.schedule.nightOf(slot);
        const input = slotInput(slot, { host: night.host });
        const change = changeFrom(programmeOf(input), order);
        const hostChanged = input.personaId !== order.personaId;

        const applied: ScheduleSlotPart[] = [...(Object.keys(change) as ScheduleSlotPart[]), ...(hostChanged ? (['host'] as const) : [])];
        const waiting = waitingParts(slot, order, night.coHosts);
        const replanning = choosesDifferently(change, order) && resolveRules(order.mode, order.rules, stationRules(this.config)).mayGenerate;

        // The programme first and awaited, because the replan reads it off the row: sent the other
        // way round, the fresh set is chosen against the brief being replaced.
        if (Object.keys(change).length > 0) await this.director.post({ kind: 'reprogramme', change });
        if (hostChanged)
            await this.director.post({ kind: 'recast', bind: { ...(input.personaId === undefined ? {} : { personaId: input.personaId }) } });
        if (replanning) await this.jobs.send('director.replan_lineup', { broadcastId: order.broadcastId } satisfies ReplanLineupPayload);

        this.logger.info('schedule: an operator applied a slot to the show on air', { slot: slot.id, applied, waiting, replanning });
        if (applied.length > 0) {
            const actorId = this.actor();
            void this.activity.record({
                module: 'director',
                kind: 'air.reprogrammed',
                // The slot's label, which is the operator's own text about their own station: the one
                // kind this feed may quote. See `ActivityRecorder`.
                detail: `An operator applied the edited "${slot.label}" slot to the show on air.`,
                data: { slotId: slot.id, applied, waiting, replanning },
                ...(actorId === undefined ? {} : { actorId }),
            });
        }

        return { applied, waiting, replanning };
    }

    private actor(): string | undefined {
        return this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
    }

    private async slotOr404(id: string): Promise<ScheduleSlot> {
        const slot = UUID.test(id) ? (await this.slots.list()).find(candidate => candidate.id === id) : undefined;
        if (slot === undefined) throw httpError(404).withDetails({ message: `schedule slot "${id}" does not exist` });
        return slot;
    }
}

/**
 * Everything a slot says about how its show is programmed, as a whole {@link ProgrammeChange}: every
 * field present, an unset one as its clearing value, so the comparison below can tell "the slot
 * dropped its period" from "the slot never mentioned one". Read off the same `PutOnAirInput` a
 * changeover builds, and normalised the way `putOnAir` normalises it into the binding.
 */
export function programmeOf(input: PutOnAirInput): Required<ProgrammeChange> {
    return {
        name: input.name ?? '',
        brief: input.brief?.trim() ?? '',
        era: { ...(input.eraFrom === undefined ? {} : { from: input.eraFrom }), ...(input.eraTo === undefined ? {} : { to: input.eraTo }) },
        moods: moodsField(input.moods).moods ?? [],
        avoidMoods: avoidMoodsField(input.avoidMoods).avoidMoods ?? [],
        rules: rulesAskedFor(input).rules ?? {},
    };
}

/** The fields of `programme` that differ from the broadcast on air, and nothing else. */
export function changeFrom(programme: Required<ProgrammeChange>, order: StationLineupSnapshot): ProgrammeChange {
    const onAir: Required<ProgrammeChange> = {
        name: order.name,
        brief: order.brief ?? '',
        era: { ...(order.eraFrom === undefined ? {} : { from: order.eraFrom }), ...(order.eraTo === undefined ? {} : { to: order.eraTo }) },
        moods: order.moods ?? [],
        avoidMoods: order.avoidMoods ?? [],
        rules: order.rules ?? {},
    };
    return Object.fromEntries(
        Object.entries(programme).filter(([key, value]) => !same(value, onAir[key as keyof ProgrammeChange])),
    ) as ProgrammeChange;
}

/**
 * Whether a change reaches which records are chosen, so the ones already planned against the old
 * programme are worth replacing. A rename, or a rule about breaks or calls, leaves them as good as
 * they were.
 */
function choosesDifferently(change: ProgrammeChange, order: StationLineupSnapshot): boolean {
    if (change.brief !== undefined || change.era !== undefined || change.moods !== undefined || change.avoidMoods !== undefined) return true;
    if (change.rules === undefined) return false;
    const rules = change.rules;
    return CHOICE_RULES.some(key => rules[key] !== order.rules?.[key]);
}

/** The parts of the slot that differ from the show on air and only a changeover can bring about. */
function waitingParts(slot: ScheduleSlot, order: StationLineupSnapshot, coHosts: readonly string[]): ScheduleSlotPart[] {
    return [
        ...(sourceMatches(slot, order) ? [] : (['source'] as const)),
        ...(slot.mode === order.mode ? [] : (['mode'] as const)),
        ...(slot.onEnd === order.onEnd ? [] : (['onEnd'] as const)),
        ...(same([...coHosts], [...(order.coHostPersonaIds ?? [])]) ? [] : (['coHosts'] as const)),
    ];
}

/** Whether the broadcast reads the source the slot names, compared the way `putOnAir` records each one. */
function sourceMatches(slot: ScheduleSlot, order: StationLineupSnapshot): boolean {
    const source = slot.source;
    if (source === undefined) return order.sourceChartId === undefined && order.sourcePlaylistId === undefined;
    if (isChartSource(source)) return order.sourceChartId === source.chartId;
    if (isStationPlaylistSource(source)) return order.sourcePluginId === undefined && order.sourcePlaylistId === source.stationPlaylistId;
    return order.sourcePluginId === source.pluginId && order.sourcePlaylistId === source.playlistId;
}

/** Structural equality over the plain values a programme holds, with an object's keys in any order. */
function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, inner]) => [key, sorted(inner)]),
    );
}
