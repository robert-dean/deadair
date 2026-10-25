import { isChartSource, isStationPlaylistSource, type ScheduleSlot, type ScheduleSlotSource } from './schedule.js';
import type { NightHost } from './slot.visits.js';
import type { PutOnAirInput } from './types/director.types.js';

/**
 * What going on air as this slot asks for.
 *
 * `withoutSource` is the block started from everything but its source. It is always a rotation that
 * keeps going: a `setlist` or a `feature` with nothing in it is silence, and a block's end is the
 * schedule's to call rather than the order's. The mix-in goes with the playlist it would have
 * mixed into.
 */
export function slotInput(slot: ScheduleSlot, options: { withoutSource?: boolean; host?: NightHost } = {}): PutOnAirInput {
    const withoutSource = options.withoutSource === true;
    // Tonight's presenter: a guest sitting in, or the slot's own host. The slot's own when nobody said.
    const personaId = options.host === undefined ? slot.personaId : options.host.personaId;
    return {
        name: slot.label,
        ...(withoutSource ? {} : sourceInput(slot.source)),
        ...(slot.brief === undefined ? {} : { brief: slot.brief }),
        // Copied onto the running order beside the brief, for the brief's own reason:
        // `onEnd: 'extend'` keeps asking for more, and a period held anywhere but the
        // order would last one batch.
        ...(slot.era?.from === undefined ? {} : { eraFrom: slot.era.from }),
        ...(slot.era?.to === undefined ? {} : { eraTo: slot.era.to }),
        // Beside the period and for its reason: it has to steer every refill, not the first batch.
        ...(slot.moods === undefined ? {} : { moods: slot.moods }),
        ...(slot.avoidMoods === undefined ? {} : { avoidMoods: slot.avoidMoods }),
        ...(personaId === undefined ? {} : { personaId }),
        // Absent leaves the station's own setting standing, which is the same three-way
        // `putOnAir` gives an operator briefing by hand. Passing `false` for an unset
        // slot would have every scheduled show overrule a station that takes calls.
        ...(slot.callins === undefined ? {} : { callins: slot.callins }),
        // The same three-way, for the same reason: absent is the station's setting.
        ...(slot.mixInSimilar === undefined || withoutSource ? {} : { mixInSimilar: slot.mixInSimilar }),
        // The same three-way again, except that absent is yes: see `StationLineupRules.chartPositions`.
        ...(slot.chartPositions === undefined ? {} : { chartPositions: slot.chartPositions }),
        // The same three-way, and absent is the mode's answer: a countdown slot is a setlist that says yes.
        ...(slot.breaks === undefined ? {} : { breaks: slot.breaks }),
        // A kind of show rather than a station setting, so absent is simply no.
        ...(slot.requestShow === undefined ? {} : { requestShow: slot.requestShow }),
        ...(slot.requestFollowOn === undefined ? {} : { requestFollowOn: slot.requestFollowOn }),
        // The same three-way, and absent is the mode's answer. On the order's rules rather than in
        // the first batch, because `onEnd: 'extend'` keeps asking for more and a lift held anywhere
        // else would be gone within the hour.
        ...(slot.repeatWindowDays === undefined ? {} : { repeatWindowDays: slot.repeatWindowDays }),
        ...(slot.artistCooldownMinutes === undefined ? {} : { artistCooldownMinutes: slot.artistCooldownMinutes }),
        ...(slot.maxPerArtist === undefined ? {} : { maxPerArtist: slot.maxPerArtist }),
        // A show rule like the ones above: absent leaves the station's `llm.breakWriterOrder` standing.
        ...(slot.writerOrder === undefined ? {} : { writerOrder: slot.writerOrder }),
        mode: withoutSource ? 'rotation' : slot.mode,
        onEnd: withoutSource ? 'extend' : slot.onEnd,
    };
}

/**
 * A slot's source as the half of `PutOnAirInput` that names one.
 *
 * One function rather than two ternaries at the call site, because the two arms are alternatives
 * and spelling them inline is how a changeover ends up sending both. A slot with no source spreads
 * nothing, which is what a stretch of the day the station fills itself already meant.
 */
function sourceInput(source: ScheduleSlotSource | undefined): Partial<PutOnAirInput> {
    if (source === undefined) return {};
    if (isChartSource(source)) return { chartId: source.chartId, ...(source.chartOrder === undefined ? {} : { chartOrder: source.chartOrder }) };
    if (isStationPlaylistSource(source)) return { stationPlaylistId: source.stationPlaylistId };

    return { pluginId: source.pluginId, playlistId: source.playlistId };
}
