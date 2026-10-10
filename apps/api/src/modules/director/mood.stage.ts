import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { LyricMood } from '#modules/lyrics/lyric.moods.js';
import type { ScheduleService } from '#modules/schedule/schedule.service.js';
import { batchMidpointMs } from './air.estimate.js';
import { stationZone } from './clock.words.js';
import { minutesIntoSlot, minutesLeftInSlot, type ScheduleSlot } from './schedule.js';
import type { StationLineupItem } from './station.lineup.js';

/**
 * Which of a slot's mood stages a batch of records will mostly air in.
 *
 * The stages split the slot into equal shares, in order: two stages over four hours are the first two
 * hours and the last two. Where the batch falls is measured from `now`, when the slot is known to be
 * in force, plus how far ahead the batch will mostly be airing, because `minutesIntoSlot` is only
 * meaningful for an instant the slot holds and a batch's midpoint can lie past the changeover. Past
 * the end is the last stage, which is what a slot that overruns into its close sounds like.
 *
 * One stage per batch, and that is coarse on purpose: a refill is about an hour of records, so a slot
 * with more stages than it has hours only ever airs the stages its refills land in. A single stage, or
 * no slot to measure against, is the first stage, which is exactly the lean before stages existed.
 */
export function stageAt(
    moods: readonly LyricMood[] | undefined,
    slot: ScheduleSlot | undefined,
    now: number,
    aheadMs: number,
    zone: string,
): LyricMood | undefined {
    if (moods === undefined || moods.length === 0) return undefined;
    if (moods.length === 1 || slot === undefined) return moods[0];

    const into = minutesIntoSlot(slot, now, zone);
    const length = into + minutesLeftInSlot(slot, now, zone);
    if (length <= 0) return moods[0];

    const position = (into + Math.max(0, aheadMs) / 60_000) / length;
    return moods[Math.min(moods.length - 1, Math.max(0, Math.floor(position * moods.length)))];
}

/**
 * The mood a refill of `count` records after `ahead` should lean into, for the broadcast in `lineup`.
 *
 * Stages only mean anything against the slot the broadcast was put on for, so the slot in force is
 * read and used only when it IS that slot; a broadcast an operator started by hand outside its slot, or
 * one that is still airing after a changeover moved on, leans into its first stage. A schedule that
 * cannot be read costs the stage and never the refill.
 */
export async function refillMood(
    lineup: { readonly moods?: readonly LyricMood[] | undefined; readonly slotId?: string | undefined },
    ahead: readonly StationLineupItem[],
    count: number,
    schedule: Pick<ScheduleService, 'inForce'>,
    config: AppConfig,
    now = Date.now(),
): Promise<LyricMood | undefined> {
    const moods = lineup.moods;
    if (moods === undefined || moods.length === 0) return undefined;
    if (moods.length === 1 || lineup.slotId === undefined) return moods[0];

    const slot = await schedule.inForce(new Date(now)).catch(() => undefined);
    if (slot?.id !== lineup.slotId) return moods[0];
    return stageAt(moods, slot, now, batchMidpointMs(ahead, count), stationZone(config));
}
