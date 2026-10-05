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
 * The gain for one pad, in dB, or `undefined` to leave it alone.
 *
 * `undefined` is the answer for an UNMEASURED pad, which is most of them: integrated loudness is
 * gated in 400ms blocks, so a short rimshot has no figure at all, and inventing one would be worse
 * than today's 0 dB. It is also the answer for a correction under half a decibel, on `gainFor`'s
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
