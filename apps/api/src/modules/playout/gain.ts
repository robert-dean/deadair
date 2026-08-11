/**
 * How much to lift or drop one record, decided before it airs.
 *
 * The station holds a rough level with `normalize` on the leaf sources in
 * `radio.liq`, and a level follower is the wrong instrument for this. It cannot
 * know what a record is going to do next, so it chases: it spends the opening of
 * each track catching up, it pumps on dynamic material, and on a fade-out it
 * rides the gain UP as the music leaves, which is audible as an ending that gets
 * louder the quieter it was meant to become. It also fights the duck ramp,
 * because both are moving gain at once.
 *
 * This is the static answer, and it is static in the way that matters: one number
 * per item, computed from a measurement of the whole file, applied flat. A fade
 * fades. See `docs/todo/station-intelligence.md` §4.
 *
 * Kept pure and unit-tested for the same reason `annotate.ts` beside it is: what
 * this returns rides an annotation into a player that will not complain about it.
 * A wrong number here is not an error anybody sees, it is a record that airs at
 * the wrong level.
 */

/**
 * What the analyzer measured about how loud a record is, as an item carries it.
 *
 * Every field optional, because absent is a real answer rather than a gap — see
 * `TrackLoudness` in the plugin SDK. The station reading these has to degrade to
 * its live normalizer, which is what it did before any of this existed.
 */
export interface MeasuredLoudness {
    /** Gated programme loudness in LUFS, to ITU-R BS.1770. */
    loudnessLufs?: number;
    /** The highest inter-sample peak in dBTP. Legitimately positive. */
    truePeakDb?: number;
    /** The highest actual sample, in dBFS. */
    samplePeakDb?: number;
}

/**
 * The ceiling a boost may not push a master through, in dBTP.
 *
 * -1 rather than 0 because the mount is a lossy encode. An MP3 or AAC decoder
 * reconstructs a waveform that is not the one that went in, and it routinely
 * overshoots the samples it was given by a fraction of a decibel; a master
 * mastered to exactly 0 dBFS clips on the way out even though nothing in the file
 * does. The dB of headroom is the standard allowance for that and costs nothing
 * audible.
 */
export const CEILING_DBTP = -1;

/**
 * The most this will move a record in either direction.
 *
 * Not a judgement about music, a bound on being wrong. Every input here comes
 * from a measurement of a file the station downloaded, and the failure worth
 * defending against is a measurement of the WRONG file — a preview clip, an error
 * page that decoded, a mostly-silent transfer — which asks for a correction of
 * tens of decibels with total confidence. Twelve is far more than the spread
 * between a quiet 1970s master and a loud modern one, so a legitimate record
 * never reaches it.
 */
export const MAX_GAIN_DB = 12;

/**
 * Below this, in either direction, no gain is stamped at all.
 *
 * Half a decibel is not audible on a track boundary, and the same call as
 * omitting `liq_cue_in` at zero in `annotate.ts`: sending a correction that
 * changes nothing makes an untouched record look measured in a queue reading, and
 * the reading is where an operator goes when something sounds wrong.
 */
export const MIN_GAIN_DB = 0.5;

/**
 * What a sample peak is assumed to hide, in dB, when no true peak was measured.
 *
 * The reconstructed waveform between two samples routinely exceeds both of them
 * by around this much, which is the entire reason `truePeakDb` exists as a
 * separate field. Using a sample peak as if it were a true one is how a quiet
 * master gets lifted into clipping, so where the true figure is missing the
 * sample figure is treated as optimistic by this much rather than trusted.
 */
export const TRUE_PEAK_ALLOWANCE_DB = 1;

/**
 * The gain for one record, in dB, or nothing.
 *
 * `undefined` means "say nothing about this record", and it is the answer for an
 * unmeasured track, a measurement without a loudness figure, and a correction too
 * small to be worth making. **Nothing downstream may treat it as a fault.** An
 * unmeasured track has to play, which is the rule every consumer of these
 * measurements is held to.
 *
 * Two asymmetries are deliberate:
 *
 * - **A cut is never capped by the peak, a boost always is.** Turning a record
 *   down cannot clip it. Turning one up can, and the number that says by how much
 *   is the true peak — which is why a boost with no peak to check against is
 *   refused rather than guessed at, while a cut in the same state goes ahead.
 * - **The clamp is applied before the peak cap**, so a wild measurement is bounded
 *   first and the headroom check operates on a plausible figure.
 *
 * @param measured - What the analyzer said, as the item carries it.
 * @param targetLufs - Where the station wants its records to sit.
 */
export function gainFor(measured: MeasuredLoudness, targetLufs: number): number | undefined {
    const { loudnessLufs } = measured;
    if (!isFinite(loudnessLufs) || !isFinite(targetLufs)) return undefined;

    const wanted = clamp(targetLufs - loudnessLufs, MAX_GAIN_DB);
    // Rounded to a tenth before the dead-band is applied, so the number that is
    // tested for being worth stamping is the number that would be stamped.
    const gainDb = round(wanted > 0 ? Math.min(wanted, boostCeiling(measured)) : wanted);

    return Math.abs(gainDb) < MIN_GAIN_DB ? undefined : gainDb;
}

/**
 * How much a record can be turned up before it reaches the ceiling.
 *
 * Never negative: a master that already runs above {@link CEILING_DBTP} — and
 * plenty of modern ones do — is left where it is rather than pulled down by this.
 * A cut is the loudness figure's business, and letting the peak force one here
 * would quietly turn the headroom check into a second level policy.
 *
 * Zero when there is no peak at all, which refuses the boost. That is the case
 * §4 means by "otherwise a guess": without a peak the station has no idea how
 * close the master already is to clipping, and guessing wrong is audible where
 * leaving a quiet record quiet is not.
 */
function boostCeiling(measured: MeasuredLoudness): number {
    const peak = peakDb(measured);
    if (peak === undefined) return 0;

    return Math.max(0, CEILING_DBTP - peak);
}

/** The true peak where one was measured, the sample peak treated as optimistic otherwise. */
function peakDb({ truePeakDb, samplePeakDb }: MeasuredLoudness): number | undefined {
    if (isFinite(truePeakDb)) return truePeakDb;
    if (isFinite(samplePeakDb)) return samplePeakDb + TRUE_PEAK_ALLOWANCE_DB;

    return undefined;
}

const clamp = (value: number, limit: number): number => Math.min(limit, Math.max(-limit, value));

/** A tenth of a decibel, which is finer than anything here is audible at. */
const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * A number that is actually a number.
 *
 * These arrive from a jsonb blob a plugin wrote, so `undefined`, a string and a
 * `NaN` are all reachable and all mean the same thing here: no measurement.
 */
function isFinite(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
