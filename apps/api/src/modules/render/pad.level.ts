/**
 * How loud a pad is mixed into a break, decided from what it measured.
 *
 * A pad is mastered by whoever made it, and an air horn is mastered LOUD, so mixing every pad at
 * 0 dB put each one wherever its maker left it: a drop twelve decibels over the words it landed on,
 * or one lost under them. The pad's own row already carries `loudnessLufs`, and the station already
 * holds a figure for where its voice arrives, so the gain that puts one against the other is a
 * subtraction. This is that subtraction and the bounds on it, kept pure for the reason `gain.ts` is:
 * a wrong number here is not an error anybody sees, it is a sound that airs at the wrong level.
 */

import { ASSUMED_SPEECH_LUFS, MAX_GAIN_DB, MIN_GAIN_DB } from '#modules/playout/gain.js';

/**
 * How far a short pad's loudness is assumed to sit under its peak, in dB, when nothing measured it.
 *
 * The peak-to-loudness ratio of the station's own voice, measured rather than chosen: the bundled
 * engine's voices came in between -25.5 and -28.3 LUFS with true peaks around -9 to -11 dBTP (see
 * `ASSUMED_SPEECH_LUFS`), which is sixteen and a half either way of a decibel. Using the SPEECH figure
 * for the pad is the whole design: a pad estimated as `peak - 16` and then set `render.padLevelDb`
 * under the assumed speech loudness has its PEAK land that same distance under the voice's peaks,
 * which is how an editor matches a drop by eye on a waveform and the only comparison a sound too short
 * to gate supports.
 *
 * It is also a fair figure for the sound itself. A rimshot, a click or a short drop spends nearly all
 * of its length well under its first few milliseconds, so its ratio of peak to energy is high; sixteen
 * sits inside the range a short percussive hit measures at, and a sustained sound like an air horn is
 * the one that is long enough to have a measured loudness instead. Where it is wrong, it is wrong by a
 * few decibels on a sound a third of a second long, against the 0 dB guess it replaces.
 */
export const SHORT_PAD_CREST_DB = 16;

/**
 * What a pad's loudness is taken to be, in LUFS, or `undefined` when nothing can say.
 *
 * **A measured loudness always wins.** The peak is the fallback for the sound that has none, which is
 * most pads: integrated loudness is gated in 400ms blocks and a short drop produces no block, where a
 * peak needs only a sample. The estimate is made here, at the moment a gain is wanted, rather than
 * stored as a loudness, so the column on the row stays a measurement and the guess stays labelled.
 */
export function padLoudness(pad: { loudnessLufs?: number; peakDb?: number }): number | undefined {
    if (typeof pad.loudnessLufs === 'number' && Number.isFinite(pad.loudnessLufs)) return pad.loudnessLufs;
    if (typeof pad.peakDb === 'number' && Number.isFinite(pad.peakDb)) return pad.peakDb - SHORT_PAD_CREST_DB;

    return undefined;
}

/**
 * The gain for one pad, in dB, or `undefined` to leave it alone.
 *
 * `undefined` is the answer for a pad with no figure at all, neither a measured loudness nor a peak to
 * estimate one from ({@link padLoudness}): a station with no analyzer, or a pad not yet measured. It
 * is also the answer for a correction under half a decibel, on `gainFor`'s
 * rule, so a pad already sitting where it belongs puts the same request on the wire it always did.
 *
 * The figure is against the station's ASSUMED speech level rather than a measured take, because the
 * takes are spoken and joined in one pass and nothing measures them in between. That assumption is
 * wrong by a decibel or so per voice, which is well inside what anybody hears on a drop.
 *
 * A BOOST is allowed here where `gainFor` refuses one with no peak to check against, and the reason
 * is downstream: the mixer scales the whole join down if the sum passed full scale, so a lifted pad
 * cannot clip, it can only make the break quieter before the station measures and levels it. What
 * IS kept from `gainFor` is the clamp, for its reason: the failure worth defending against is a
 * measurement of the wrong file asking for thirty decibels with total confidence.
 *
 * @param padLufs - What the pad measured, if anything did.
 * @param relativeDb - Where the pad should sit against the speech: negative is under it.
 */
export function padGainDb(padLufs: number | undefined, relativeDb: number): number | undefined {
    if (typeof padLufs !== 'number' || !Number.isFinite(padLufs) || !Number.isFinite(relativeDb)) return undefined;

    const wanted = ASSUMED_SPEECH_LUFS + relativeDb - padLufs;
    const gainDb = Math.round(Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, wanted)) * 10) / 10;

    return Math.abs(gainDb) < MIN_GAIN_DB ? undefined : gainDb;
}
