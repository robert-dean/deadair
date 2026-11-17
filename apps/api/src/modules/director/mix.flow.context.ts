import type { MixFlow } from '#modules/schedule/types/mix.types.js';
import { countThrough, type MixContext, type MixRecord } from './mix.flow.js';

/** A record as the context builder is handed it: what aired, or what is queued to. */
export interface MixSourceRecord {
    trackId?: string;
    title: string;
    artist: string;
}

export interface MixContextInputs {
    flow: MixFlow;
    /** What this broadcast has aired that the flow counts (no requests), oldest first, with when. */
    aired: readonly (MixSourceRecord & { airedAtMs: number })[];
    /** What is queued to air and was not a request or a request's follow-on, in airing order. */
    queued: readonly MixSourceRecord[];
    /** Main genre by track id: `CandidatesRepository.mainGenresFor`. */
    genres: ReadonlyMap<string, string>;
    /** The hour on the station's clock at an instant. */
    hourOf: (ms: number) => number;
    nowMs: number;
    /** The show's window, for `showProgress` and `require`'s `afterPercent`. Absent reads as the start. */
    show?: { startMs: number; endMs: number };
}

/** A record the walk can read, with its main genre looked up. */
export function mixRecordOf(record: MixSourceRecord, genres: ReadonlyMap<string, string>): MixRecord {
    const genre = record.trackId === undefined ? undefined : genres.get(record.trackId);
    return { title: record.title, artist: record.artist, ...(genre === undefined ? {} : { mainGenre: genre }) };
}

/**
 * What the walk needs to judge the next record the station proposes for this show.
 *
 * What is QUEUED counts as well as what aired, because a refill adds records behind ones that have not
 * played yet: a limit read off the history alone would let each refill take the show's whole black
 * metal again. Queued records are taken to air in the current hour, which is where most of them do.
 * Each record's path is worked out by walking it, in order, through the flow as it is now.
 */
export function buildMixContext(inputs: MixContextInputs): MixContext {
    const hour = inputs.hourOf(inputs.nowMs);
    const records = [
        ...inputs.aired.map(record => ({ ...mixRecordOf(record, inputs.genres), hour: inputs.hourOf(record.airedAtMs) })),
        ...inputs.queued.map(record => ({ ...mixRecordOf(record, inputs.genres), hour })),
    ];
    return { hour, showProgress: progressOf(inputs.show, inputs.nowMs), counted: countThrough(inputs.flow, records) };
}

/** How far through the show an instant is, as a percent clamped to 0 and 100. */
export function progressOf(show: { startMs: number; endMs: number } | undefined, nowMs: number): number {
    if (show === undefined || show.endMs <= show.startMs) return 0;
    return Math.min(100, Math.max(0, ((nowMs - show.startMs) / (show.endMs - show.startMs)) * 100));
}
