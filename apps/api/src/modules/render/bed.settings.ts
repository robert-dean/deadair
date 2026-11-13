/**
 * How the station lays a music bed under a break. See `BED_KIND` in `segment.repository.ts`.
 *
 * `pad.settings.ts`' shape and its rules, for a sound that is the other half of the same question:
 * a pad is a sound at a moment and has to be heard, a bed is a sound for the whole break and only
 * has to be there.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { ASSUMED_SPEECH_LUFS, MAX_GAIN_DB } from '#modules/playout/gain.js';
import { numberFrom } from '#modules/shared/setting.numbers.js';

/** The `deadair.settings` key for where a bed sits under the words. In the `render` group. */
export const BED_LEVEL_KEY = 'render.bedLevelDb';

/**
 * How far UNDER the speech a bed is levelled, in dB of loudness.
 *
 * **Eighteen, the figure the pad's own note names and refuses for itself.** A bed runs for the whole
 * break and is never ducked, because a duck that rode every pause would pump; so it is quiet by
 * being mixed quiet, and eighteen under is the usual spacing between a presenter and the music under
 * them: there, felt more than heard, and never in the way of a word.
 */
const DEFAULT_LEVEL_DB = -18;

/**
 * Thirty-six under is a bed nobody can hear at all, which is what switching beds off is for. Six
 * under is the loudest that still leaves the words in front: past that the station is talking over a
 * record, which is a talk-over and not a break.
 */
const MIN_LEVEL_DB = -36;
const MAX_LEVEL_DB = -6;

/**
 * Where a bed sits under the words, in dB relative to the speech.
 *
 * Clamped rather than refused, and parsed from a string, like every resolver here (see
 * `padLevelDb`): a stored row is read, not typed, and a setting that refused to load would stop the
 * render behind it.
 */
export function bedLevelDb(config: AppConfig): number {
    const set = numberFrom(config.get(BED_LEVEL_KEY, String(DEFAULT_LEVEL_DB)), DEFAULT_LEVEL_DB);

    return Math.min(MAX_LEVEL_DB, Math.max(MIN_LEVEL_DB, set));
}

/** What the console draws, so the form and the resolver cannot disagree about the range. */
export const BED_LEVEL_BOUNDS = { default: DEFAULT_LEVEL_DB, min: MIN_LEVEL_DB, max: MAX_LEVEL_DB } as const;

/**
 * How long a bed runs before the first word, in milliseconds.
 *
 * A breath of music, long enough that a break opens on the show's sound rather than on a voice out
 * of silence, and short enough not to read as a record starting. A constant rather than a setting:
 * nobody has asked to move it, and a knob for a figure nobody has an opinion about is a knob to get
 * wrong.
 */
export const BED_LEAD_MS = 1_500;

/** How long a bed runs on after the last word, fading as it goes, in milliseconds. The lead-in's reason. */
export const BED_TAIL_MS = 1_500;

/**
 * What a bed with no measurement is taken to have been mastered at, in LUFS.
 *
 * Where a pad with no figure gets no gain at all, a bed cannot: a bed at its own master is music at
 * full level under the words, which is a talk-over on top of a record. Fourteen is where music is
 * usually mastered for streaming, so the guess lands within a few decibels of the truth for nearly
 * every bed, and a measured loudness always wins.
 */
export const ASSUMED_BED_LUFS = -14;

/**
 * The gain that puts a bed `levelDb` under the station's speech, in dB.
 *
 * `padGainDb`'s arithmetic with two differences, both because a bed is under the words for the whole
 * break. It always answers, falling back to {@link ASSUMED_BED_LUFS} rather than leaving the bed at
 * its master. And the floor is far lower than `gain.ts`' twelve: that bound is against a measurement
 * of the wrong file, where eighteen under the speech is the ordinary case for a bed and a loud master
 * needs thirty down to get there. The ceiling stays twelve, for that bound's reason.
 */
export function bedGainDb(bedLufs: number | undefined, levelDb: number): number {
    const measured = typeof bedLufs === 'number' && Number.isFinite(bedLufs) ? bedLufs : ASSUMED_BED_LUFS;
    const wanted = ASSUMED_SPEECH_LUFS + levelDb - measured;

    return Math.round(Math.min(MAX_GAIN_DB, Math.max(MIN_BED_GAIN_DB, wanted)) * 10) / 10;
}

/** The deepest a bed is ever turned down: a bed this far under its master is silence with extra steps. */
const MIN_BED_GAIN_DB = -48;
