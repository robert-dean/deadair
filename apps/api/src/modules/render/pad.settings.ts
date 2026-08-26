/**
 * How the station joins a soundboard hit into a break.
 *
 * `production.settings.ts`'s `stationGapMs` in shape and in every rule it states, with one number
 * that is deliberately different and one that is deliberately the same.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';

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

/** Whether the station reaches for its soundboard at all. */
export const PADS_KEY = 'render.pads';

/** How many breaks apart the deterministic floor puts one. */
export const PAD_EVERY_KEY = 'render.padEveryBreaks';

/**
 * On, because off makes the whole path inert.
 *
 * `rotation.discover`'s call and its reason: a feature whose default is off is a feature nobody
 * finds. The thing this actually switches off is not the model — a character told about its rack
 * will reach for it — it is the FLOOR below, which is the half an operator might genuinely not
 * want. Both are behind one switch because "the station may make a noise" is one question.
 *
 * Read through `settingIsOn` and never as a boolean, because every layer of `AppConfig` holds
 * strings: `config.get(key, false)` answers `'false'`, which is truthy, so a switch written that way
 * can be turned on and never back off, in silence, with the console showing the change.
 */
export function padsAreOn(config: AppConfig): boolean {
    return settingIsOn(config, PADS_KEY, true);
}

/**
 * How many breaks apart the floor puts a pad, and why the number is not smaller.
 *
 * Four, measured against the same thing `MAX_PADS` is: this station's median break is 28 words, so a
 * pad every other break is a station that makes a noise roughly every ninety seconds of speech. That
 * is a jingle package rather than a presenter. Four is often enough to be a habit and rare enough to
 * still be a punchline.
 *
 * Zero switches the floor off while leaving the model free to hit one, which is the one state
 * {@link padsAreOn} cannot express and is worth having: a station that trusts its character and does
 * not want the machine joining in.
 *
 * Clamped rather than refused, like every resolver here, and parsed from a string for the same
 * reason {@link padGapMs} is.
 */
export function padEveryBreaks(config: AppConfig): number {
    const set = Number(String(config.get(PAD_EVERY_KEY, String(PAD_EVERY_BOUNDS.default))).trim());
    if (!Number.isFinite(set)) return PAD_EVERY_BOUNDS.default;

    return Math.min(PAD_EVERY_BOUNDS.max, Math.max(PAD_EVERY_BOUNDS.min, Math.round(set)));
}

/** What the console draws, so the form and the resolver cannot disagree about the range. */
export const PAD_EVERY_BOUNDS = { default: 4, min: 0, max: 100 } as const;
