import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberInRange } from '#modules/shared/setting.numbers.js';
import { RUNWAY_CEILING_MS, RUNWAY_FLOOR_MS, type Runway } from '#modules/lyrics/vocal.runway.js';
import type { VocalMarkers } from '#modules/lyrics/vocal.ranges.js';
import { DUCK_FADE_KEY, resolveDuckFadeMs } from '#modules/playout/gain.js';
import { WORDS_PER_SECOND } from './break.prompt.js';

/**
 * Talking up to the post: airing a link over the start of the next record, so the last word lands
 * just before the first sung one.
 *
 * Every link the station speaks used to air in the gap between two records. A presenter talks over
 * an intro instead, and the trade's word for doing it well is hitting the post. What makes it safe
 * here is knowing where the post is, which is the first sung line of the record's timed lyrics,
 * moved onto the timeline the record airs on (`lyrics/vocal.runway.ts`). With no such answer the
 * link airs in the gap exactly as before: the failure this is built against is a presenter talking
 * over the first word, which is the most audible mistake a station makes, and the second one to
 * avoid is a station that stops talking up anything. So it fails open, link by link.
 *
 * The decision is taken at HAND-OVER and not when the break is planted, because a planted break is
 * written and spoken afterwards: only once it is audio is its length a fact.
 */

export const TALK_UP_KEYS = {
    /** Whether a link may air over the next record's intro. OFF: installing lyrics must not change what airs. */
    enabled: 'breaks.talkUp',
    /** How far before the first sung word the presenter's last one must land, in milliseconds. */
    safetyMs: 'breaks.talkUpSafetyMs',
} as const;

export const TALK_UP_DEFAULT = false;
export const DEFAULT_TALK_UP_SAFETY_MS = 1_500;
export const TALK_UP_SAFETY_RANGE = { min: 500, max: 5_000 } as const;

/**
 * How far into a LONG intro a link starts, rather than at the top of the record or hanging silent
 * until the post. Long enough for the record to establish itself under the voice.
 */
export const SETTLE_MS = 2_000;

/**
 * How much later Liquidsoap fires a cue than it was asked to, in milliseconds, wherever it is due.
 *
 * Two ticks of `voice_tick`: the counter's own, since `on_air_elapsed` only moves when its thread
 * runs, and the cue check's, which runs on a tick of its own. A constant rather than a fraction of
 * how far in, because the counter now adds the time that actually passed (see `on_air_elapsed` in
 * `radio.liq`). It used to add a fixed tick and ran 3.5% slow, which this allowed for as a ratio; a
 * cue due 170s in landed at 173s that way, and at 170.03s now (`stream/voiceclock.check.liq`).
 */
export const CUE_CLOCK_LAG_MS = 200;

export interface TalkUpSettings {
    enabled: boolean;
    safetyMs: number;
    /**
     * The duck's ramp, `playout.duckFadeMs`, read with the rest so one pass times every link against
     * one figure. Every cue the pass attaches carries it on to the arm, so `radio.liq` fires the cue on
     * the ramp it was timed against even if the setting moves while it waits for its record.
     */
    duckFadeMs: number;
}

export function resolveTalkUp(config: AppConfig): TalkUpSettings {
    return {
        enabled: settingIsOn(config, TALK_UP_KEYS.enabled, TALK_UP_DEFAULT),
        safetyMs: numberInRange(config.get(TALK_UP_KEYS.safetyMs, DEFAULT_TALK_UP_SAFETY_MS), DEFAULT_TALK_UP_SAFETY_MS, TALK_UP_SAFETY_RANGE),
        duckFadeMs: resolveDuckFadeMs(config.get(DUCK_FADE_KEY, '')),
    };
}

export interface TalkUpQuestion {
    /** How long the rendered link is. */
    voiceMs: number;
    /** The next record's runway, on its aired timeline. */
    runway: Runway;
    safetyMs: number;
    /** The duck's ramp. The bed comes back up over this long after the last word, so it is part of the link. */
    duckFadeMs: number;
    /**
     * How far into the record the RECORD BEFORE it is still being sung, from {@link outgoingClearMs}.
     * The link may not be heard before this. Absent, or zero, when nothing is still singing under it.
     */
    clearFromMs?: number;
}

/**
 * How far into the next record to start the link, or `undefined` for "air it in the gap as before".
 *
 * Ends the link at the post (`runway - safety`), allowing for the duck's ramp after the last word and
 * for the cue firing a tick or two late. On an intro long enough not to bind, starts at {@link SETTLE_MS}
 * instead of hanging silent until the post. Never trims and never re-renders: a link that does not
 * fit is simply aired in the gap.
 *
 * And never starts before `clearFromMs`, which is the other end of the window: the record before can
 * still be playing under this one's intro for the length of the blend, and still singing. `radio.liq`
 * starts the voice the duck's ramp ahead of the cue, so that ramp is allowed for at this end too.
 */
export function talkUpAt({ voiceMs, runway, safetyMs, duckFadeMs, clearFromMs }: TalkUpQuestion): number | undefined {
    if (runway.kind !== 'ms') return undefined;
    if (!Number.isFinite(voiceMs) || voiceMs <= 0) return undefined;
    if (runway.ms < RUNWAY_FLOOR_MS) return undefined;

    const post = runway.ms - safetyMs;
    const spoken = voiceMs + duckFadeMs;
    // The latest start that still lands in time when the cue fires a lag late.
    const latest = Math.floor(post - spoken - CUE_CLOCK_LAG_MS);
    if (latest < 0) return undefined;

    // The earliest start that is not heard over the record before. A cue firing late only helps here.
    const earliest = clearFromMs !== undefined && Number.isFinite(clearFromMs) && clearFromMs > 0 ? Math.ceil(clearFromMs + duckFadeMs) : 0;
    if (earliest > latest) return undefined;

    const at = runway.ms >= RUNWAY_CEILING_MS ? Math.min(latest, SETTLE_MS) : latest;
    return Math.max(at, earliest);
}

/** The record a talked-up link follows, as far as {@link outgoingClearMs} needs it. */
export interface OutgoingRecord {
    /** Where its singing is. */
    markers: VocalMarkers;
    /** Its measured cue-out, in milliseconds from the top of its file. Absent on an unmeasured record. */
    cueOutMs?: number;
    /** How long it overlaps the record the link rides, from `blendFor`. Zero for a hard join. */
    blendMs: number;
}

/**
 * How far into the incoming record the outgoing one stops being sung, plus `safetyMs`, or 0 when it
 * is not sung under it at all.
 *
 * The talk-up's clock starts as the blend BEGINS (see `on_air_elapsed` in `radio.liq`), so for the
 * first `blendMs` of the incoming record the outgoing one's last seconds are playing under it, and a
 * record that is still being sung then is one a link talked up from the top would talk over. Measured
 * on air: "Bad Medicine" blended 12s into the next record with its last line running 6.8s into it,
 * and a link timed only against the next record's post started at 5.8s.
 *
 * The outgoing record's vocal end is on its FILE timeline, as its cue-out is, so the two compare with
 * no shift. A record whose singing is unknown is assumed to sing to its end: the cautious reading,
 * which waits out the blend before the link starts. An instrumental needs nothing.
 */
export function outgoingClearMs(outgoing: OutgoingRecord | undefined, safetyMs: number): number {
    if (outgoing === undefined || !(outgoing.blendMs > 0)) return 0;
    if (outgoing.markers.kind === 'instrumental') return 0;
    if (outgoing.markers.kind === 'unknown' || outgoing.cueOutMs === undefined || !Number.isFinite(outgoing.cueOutMs)) return outgoing.blendMs;

    // Where the incoming record starts, on the outgoing record's own timeline.
    const handOverMs = outgoing.cueOutMs - outgoing.blendMs;
    const sungUntilMs = Math.min(outgoing.markers.endMs, outgoing.cueOutMs) - handOverMs;
    return sungUntilMs <= 0 ? 0 : sungUntilMs + safetyMs;
}

/** Below this many words there is no link worth offering to fit, so the writer is told nothing. */
export const MIN_TALK_UP_WORDS = 4;

/**
 * What the writer of a link is told about the record after it: how far in its singing starts, and
 * how many words would fit in front of it. `undefined` when there is nothing useful to say.
 *
 * Advice and nothing more. The placement at hand-over is what decides, on the clip's real length, so
 * a link that runs long simply airs in the gap. That is also why nothing is said about a record whose
 * singing starts almost at once: a link written for it airs in the gap, where it clashes with nothing.
 * Only a runway inside the band where it binds is worth a sentence; past the ceiling any link fits.
 */
export function talkUpBudget(runway: Runway, safetyMs: number, duckFadeMs: number): { runwayMs: number; words: number } | undefined {
    if (runway.kind !== 'ms' || runway.ms < RUNWAY_FLOOR_MS || runway.ms >= RUNWAY_CEILING_MS) return undefined;

    const spokenMs = runway.ms - safetyMs - duckFadeMs - CUE_CLOCK_LAG_MS;
    const words = Math.floor((spokenMs / 1000) * WORDS_PER_SECOND);
    return words < MIN_TALK_UP_WORDS ? undefined : { runwayMs: runway.ms, words };
}
