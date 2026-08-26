/**
 * How the station joins a soundboard hit into a break.
 *
 * `production.settings.ts`'s `stationGapMs` in shape and in every rule it states, with one number
 * that is deliberately different and one that is deliberately the same.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';

/** The `deadair.settings` key. Dot-keyed, and in the `render` group like everything else this path reads. */
export const PAD_GAP_KEY = 'render.padGapMs';

/**
 * The silence either side of a pad, in milliseconds.
 *
 * **Much shorter than a production's 200ms, and the difference is what the gap is FOR.** Between two
 * turns of a phone-in a pause is the conversation breathing, and 200ms is somebody taking their
 * moment. Around a drop it is the opposite: a rimshot lands ON the beat after the line, and a fifth
 * of a second of silence in front of it is a presenter who missed their own cue. So 60ms, which is
 * enough to keep the mixer's trim from clipping the attack and not enough to hear as a pause.
 *
 * It is one number for both sides, because `AudioJoin.gapMs` is one number for the whole join. Per-
 * join control is the timeline the mixer capability deliberately has not designed yet, and it is what
 * would let a drop land UNDER the last word rather than after it.
 */
const DEFAULT_GAP_MS = 60;

/**
 * Zero is meaningful and is the floor: butt the pad straight against the words.
 *
 * The ceiling is where a gap stops being timing and starts being a hole. Past half a second the
 * station is not landing a joke, it is playing two things that happen to be in the same file, and a
 * break in the programme is two items in the running order.
 */
const MIN_GAP_MS = 0;
const MAX_GAP_MS = 500;

/**
 * The gap to put either side of a pad.
 *
 * CLAMPED rather than refused, which is the rule every resolver here follows: this reads a row that
 * is already stored, and a setting that will not load stops the join behind it. The console refuses
 * an out-of-range figure at the point somebody types one.
 *
 * Read as a string and parsed, because every layer of `AppConfig` holds text: a stored `120` arrives
 * as `'120'`, and `Number.isFinite('120')` is false. See the `settingIsOn` gotcha in CLAUDE.md, of
 * which this is the numeric half.
 */
export function padGapMs(config: AppConfig): number {
    const set = Number(String(config.get(PAD_GAP_KEY, String(DEFAULT_GAP_MS))).trim());
    if (!Number.isFinite(set)) return DEFAULT_GAP_MS;

    return Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, Math.round(set)));
}

/** What the console draws, so the form and the resolver cannot disagree about the range. */
export const PAD_GAP_BOUNDS = { default: DEFAULT_GAP_MS, min: MIN_GAP_MS, max: MAX_GAP_MS } as const;
