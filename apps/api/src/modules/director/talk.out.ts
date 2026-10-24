import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { RUNWAY_CEILING_MS, RUNWAY_FLOOR_MS } from '#modules/lyrics/vocal.runway.js';
import type { VocalMarkers } from '#modules/lyrics/vocal.ranges.js';
import { DUCK_FADE_MS } from '#modules/stream/stream.service.js';
import { WORDS_PER_SECOND } from './break.prompt.js';
import { CUE_CLOCK_LAG_MS, MIN_TALK_UP_WORDS } from './talk.up.js';

/**
 * Talking over the end of a record: airing a link over the instrumental tail of the record before it,
 * so the last word lands as that record ends and the next one starts straight after.
 *
 * The back half of what `talk.up.ts` is the front of. A presenter back-announces over a fade far
 * more often than they hit a post, and the station had no way to: every link aired in the gap.
 *
 * ## The talk-over owns the boundary
 *
 * A record carrying one of these does NOT blend into the next. The link ends at the record's measured
 * end, `cue_out`, and the next record starts straight after it, which is the talk-over and the blend
 * sharing the same seconds by giving them all to the talk-over. The alternative, ending the link
 * before the blend begins, keeps the mix and puts the cue's timing at the mercy of the cross buffer,
 * which is exactly where `radio.liq`'s notes on `on_air_elapsed` say an earlier version got it wrong.
 * `annotate.ts` stamps a hard join on such a record whatever `blendFor` says.
 *
 * ## Where the tail is
 *
 * From the LAST sung word, moved onto the timeline the record airs on, to the record's measured end.
 * Both are needed: an unmeasured record has no end to land on and a record with no timed lyrics has
 * no last word to start after, and either airs the link in the gap exactly as before. So does an
 * instrumental, as for the talk-up: "nothing sung" is a claim from a lyrics source, and a link over a
 * record somebody mislabelled is a presenter talking over the singing.
 *
 * Decided at HAND-OVER like the talk-up, and for its reason: only once the link is audio is its
 * length a fact. A link is never trimmed or rendered again to fit.
 */

export const TALK_OUT_KEYS = {
    /** Whether a link may air over the end of the record before it. OFF: lyrics must not change what airs. */
    enabled: 'breaks.talkOut',
} as const;

export const TALK_OUT_DEFAULT = false;

/** Whether talking over a record's end is on. The room after the last word is the talk-up's setting. */
export function talkOutIsOn(config: AppConfig): boolean {
    return settingIsOn(config, TALK_OUT_KEYS.enabled, TALK_OUT_DEFAULT);
}

/**
 * The instrumental tail of a record, on its aired timeline: from the last sung word to the end.
 *
 * - `ms`: `fromMs` is the last sung word and `endMs` the record's end, both from the cue-in.
 * - `none`: nothing can be said, and the link airs in the gap.
 */
export type Tail = { kind: 'ms'; fromMs: number; endMs: number } | { kind: 'none' };

const NO_TAIL: Tail = { kind: 'none' };

/**
 * The tail of a record whose markers and cue points are known.
 *
 * `cueOutMs` is required: a record nobody measured has no end the station can land on. A marker whose
 * end is not after its onset is an operator's correction of the post with nothing derived to say
 * where the singing stops, which is no answer about the outro at all.
 */
export function tailFor(markers: VocalMarkers, cue: { cueInMs?: number; cueOutMs?: number }): Tail {
    if (markers.kind !== 'ranges' || markers.endMs <= markers.onsetMs) return NO_TAIL;

    const { cueInMs, cueOutMs } = cue;
    if (cueOutMs === undefined || !Number.isFinite(cueOutMs) || cueOutMs <= 0) return NO_TAIL;

    const shift = cueInMs !== undefined && Number.isFinite(cueInMs) && cueInMs > 0 ? cueInMs : 0;
    const endMs = cueOutMs - shift;
    const fromMs = Math.max(0, markers.endMs - shift);
    return fromMs >= endMs ? NO_TAIL : { kind: 'ms', fromMs, endMs };
}

export interface TalkOutQuestion {
    /** How long the rendered link is. */
    voiceMs: number;
    /** The record's tail, on its aired timeline. */
    tail: Tail;
    /** How long after the last sung word the presenter may start. The talk-up's own room. */
    safetyMs: number;
    /** The duck's ramp. The bed comes back up over this long after the last word, so it is part of the link. */
    duckFadeMs: number;
}

/**
 * How far into the record to start the link, or `undefined` for "air it in the gap as before".
 *
 * As late as it can start and still end at the record's end, allowing for the duck's ramp and the cue
 * firing a tick or two late, so a link over a long fade is heard over its last bars rather than over
 * the first of them; and no earlier than `safetyMs` after the last sung word, since the one mistake
 * worse than airing in the gap is talking over the singing.
 */
export function talkOutAt({ voiceMs, tail, safetyMs, duckFadeMs }: TalkOutQuestion): number | undefined {
    if (tail.kind !== 'ms') return undefined;
    if (!Number.isFinite(voiceMs) || voiceMs <= 0) return undefined;
    if (tail.endMs - tail.fromMs < RUNWAY_FLOOR_MS) return undefined;

    const latest = Math.floor(tail.endMs - voiceMs - duckFadeMs - CUE_CLOCK_LAG_MS);
    return latest < tail.fromMs + safetyMs ? undefined : latest;
}

/**
 * What the writer of a link is told about the record before it: how long its tail runs after the last
 * sung word, and how many words would fit over it. `undefined` when there is nothing useful to say.
 *
 * Advice, as `talkUpBudget` is: the hand-over decides on the clip's real length, so a link that runs
 * long simply airs in the gap. Only a tail inside the band where it binds is worth a sentence: below
 * the floor nothing fits, and past the ceiling any link the station writes does.
 */
export function talkOutBudget(tail: Tail, safetyMs: number): { tailMs: number; words: number } | undefined {
    if (tail.kind !== 'ms') return undefined;
    const tailMs = tail.endMs - tail.fromMs;
    if (tailMs < RUNWAY_FLOOR_MS || tailMs >= RUNWAY_CEILING_MS) return undefined;

    const spokenMs = tailMs - safetyMs - DUCK_FADE_MS - CUE_CLOCK_LAG_MS;
    const words = Math.floor((spokenMs / 1000) * WORDS_PER_SECOND);
    return words < MIN_TALK_UP_WORDS ? undefined : { tailMs, words };
}
