import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberOr } from '#modules/shared/setting.numbers.js';
import { RUNWAY_CEILING_MS, RUNWAY_FLOOR_MS, type Runway } from '#modules/lyrics/vocal.runway.js';
import { DUCK_FADE_MS } from '#modules/stream/stream.service.js';
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
 * How much later Liquidsoap fires a cue than it was asked to, as a fraction of how far in it is.
 *
 * Measured by `stream/voicecue.check.liq` and documented beside `on_air_elapsed` in `radio.liq`: the
 * counter adds a fixed tick rather than measuring one, so a cue due at 6s landed at 6.22s and one at
 * 14s at 14.48s. Without this a link timed to end at the post would end a few hundred milliseconds
 * into the vocal on a long intro.
 */
export const CUE_CLOCK_DRIFT = 0.035;

export interface TalkUpSettings {
    enabled: boolean;
    safetyMs: number;
}

export function resolveTalkUp(config: AppConfig): TalkUpSettings {
    const safety = numberOr(config, TALK_UP_KEYS.safetyMs, DEFAULT_TALK_UP_SAFETY_MS);
    return {
        enabled: settingIsOn(config, TALK_UP_KEYS.enabled, TALK_UP_DEFAULT),
        safetyMs: Math.min(TALK_UP_SAFETY_RANGE.max, Math.max(TALK_UP_SAFETY_RANGE.min, safety)),
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
}

/**
 * How far into the next record to start the link, or `undefined` for "air it in the gap as before".
 *
 * Ends the link at the post (`runway - safety`), allowing for the duck's ramp after the last word and
 * for the cue clock running slow. On an intro long enough not to bind, starts at {@link SETTLE_MS}
 * instead of hanging silent until the post. Never trims and never re-renders: a link that does not
 * fit is simply aired in the gap.
 */
export function talkUpAt({ voiceMs, runway, safetyMs, duckFadeMs }: TalkUpQuestion): number | undefined {
    if (runway.kind !== 'ms') return undefined;
    if (!Number.isFinite(voiceMs) || voiceMs <= 0) return undefined;
    if (runway.ms < RUNWAY_FLOOR_MS) return undefined;

    const post = runway.ms - safetyMs;
    const spoken = voiceMs + duckFadeMs;
    // Solve start * (1 + drift) + spoken <= post for the latest start that still lands in time.
    const latest = Math.floor((post - spoken) / (1 + CUE_CLOCK_DRIFT));
    if (latest < 0) return undefined;

    return runway.ms >= RUNWAY_CEILING_MS ? Math.min(latest, SETTLE_MS) : latest;
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
export function talkUpBudget(runway: Runway, safetyMs: number): { runwayMs: number; words: number } | undefined {
    if (runway.kind !== 'ms' || runway.ms < RUNWAY_FLOOR_MS || runway.ms >= RUNWAY_CEILING_MS) return undefined;

    const spokenMs = (runway.ms - safetyMs - DUCK_FADE_MS) / (1 + CUE_CLOCK_DRIFT);
    const words = Math.floor((spokenMs / 1000) * WORDS_PER_SECOND);
    return words < MIN_TALK_UP_WORDS ? undefined : { runwayMs: runway.ms, words };
}
