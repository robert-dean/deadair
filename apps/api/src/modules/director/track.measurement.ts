/**
 * What a measurement of a record looks like once an item is carrying it.
 *
 * One translation from the jsonb blob in `deadair.track_analysis` to the fields on a
 * `RundownTrack`, with two callers that must not be allowed to disagree: `PickResolver`,
 * which takes the snapshot when a pick becomes an item, and `DirectorService`, which
 * RETAKES it when the measurement lands after that. A record levelled one way on the
 * way into the order and another way on the way out of it would be the worst version
 * of this, so the mapping lives here and neither caller owns it.
 *
 * Everything here is pure and validated, because `data` is a blob a plugin wrote and
 * the host stored without reading. This is the first place anything looks inside it.
 */

import type { StoredAnalysis } from '#modules/analysis/analysis.repository.js';
import type { MeasuredLoudness } from '#modules/playout/gain.js';
import type { RundownTrack } from '#modules/playout/rundown.js';

/** The four cue points as an item carries them: all of them, or none. */
export type CuePointSnapshot = { cueInMs?: number; introEndMs?: number; outroStartMs?: number; cueOutMs?: number };

/** Everything one measurement contributes to an item. */
export type TrackMeasurement = CuePointSnapshot & MeasuredLoudness;

/**
 * The fields a measurement owns, and the whole list of them.
 *
 * Exported because retaking a snapshot has to CLEAR before it writes: merging would
 * leave a field from a measurement this station no longer trusts standing beside the
 * fields of the one that replaced it, which is a record trimmed by one analysis and
 * levelled by another. Kept beside the type it describes so adding a field to one and
 * not the other is a `tsc` error rather than a silent half-update — see the
 * satisfies-check below it.
 */
export const MEASUREMENT_FIELDS = ['cueInMs', 'introEndMs', 'outroStartMs', 'cueOutMs', 'loudnessLufs', 'truePeakDb', 'samplePeakDb'] as const;

// The list above IS the keys of the type, both ways round: a field added to
// `TrackMeasurement` and forgotten here fails the second line, and a name here that is
// not a field fails the first.
type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];
const _fieldsAreMeasurementKeys: readonly (keyof TrackMeasurement)[] = MEASUREMENT_FIELDS;
const _measurementKeysAreFields: Record<keyof TrackMeasurement, true> = Object.fromEntries(MEASUREMENT_FIELDS.map(field => [field, true])) as Record<
    MeasurementField,
    true
>;
void _fieldsAreMeasurementKeys;
void _measurementKeysAreFields;

/**
 * Everything one stored analysis says about a record, as an item carries it.
 *
 * The two halves are combined here and validated separately below, because they fail
 * differently: the cue points are all-or-nothing and the loudness fields are each
 * independent. Absent is an ordinary answer for either half and for both at once, and
 * **nothing downstream may treat absence as a fault** — an unmeasured track plays
 * untrimmed and unlevelled, which is what the station did before any of this existed.
 */
export function measurementOf(analysis: StoredAnalysis | undefined): TrackMeasurement {
    return { ...cuePoints(analysis), ...loudness(analysis) };
}

/**
 * Whether this record is still waiting for a measurement to be taken again.
 *
 * True when EITHER half is missing, because they arrive from one analysis and a record
 * holding one of them is a record whose analysis landed after it was resolved — the
 * case this whole path exists for. It is deliberately not "has no loudness": a record
 * that is levelled but untrimmed still blends wrong, and both halves cost the same one
 * batched read to fix.
 *
 * A record the catalog has never seen has no `trackId` and so nothing to look up,
 * which is the same guard `TrackCachePlanner` and `toPlayerItems` apply for the same
 * reason. It answers false rather than true so a provider pick is not re-asked about
 * on every pass for the whole time it sits in the order.
 *
 * The cost of a false positive is one row in a batched read that comes back empty, so
 * this stays generous: a record whose blob is permanently unreadable is re-asked about
 * once a boundary and costs nothing anybody can measure.
 */
export function awaitsMeasurement(track: RundownTrack): boolean {
    if (track.trackId === undefined) return false;

    return track.loudnessLufs === undefined || track.cueOutMs === undefined;
}

/**
 * The measured cue points as an item carries them, or nothing.
 *
 * **All four or none**, which is stricter than it needs to be for the outer two and is
 * the right call anyway. The trim only needs `cueIn` and `cueOut`, so a blob with a bad
 * `introEnd` could still trim — but the four points describe one shape, and a
 * measurement that contradicts itself about where a record is underway is not one to
 * trust about where it stops either.
 *
 * The ordering check is the whole chain rather than the ends. `measure.py` clamps its
 * output into this order before it answers, so a violation arriving here is not a
 * detector being imprecise: it is a blob from something else.
 */
function cuePoints(analysis: StoredAnalysis | undefined): CuePointSnapshot {
    const cueInMs = analysis?.data.cueIn;
    const introEndMs = analysis?.data.introEnd;
    const outroStartMs = analysis?.data.outroStart;
    const cueOutMs = analysis?.data.cueOut;

    const points = [cueInMs, introEndMs, outroStartMs, cueOutMs];
    if (points.some(point => typeof point !== 'number' || !Number.isFinite(point))) return {};
    if (cueInMs! < 0 || cueOutMs! <= cueInMs!) return {};
    // Non-strict between the inner points: a record with no intro to speak of, or one
    // that ends the instant its outro begins, is a real record rather than a bad blob.
    if (introEndMs! < cueInMs! || outroStartMs! < introEndMs! || cueOutMs! < outroStartMs!) return {};

    return { cueInMs, introEndMs, outroStartMs, cueOutMs };
}

/**
 * The measured loudness as an item carries it, field by field.
 *
 * Unlike {@link cuePoints}, which are all-or-nothing because a cue span that is half
 * measured describes nothing, these are independent: an analyzer may report a loudness
 * and no peak, and `gainFor` has a defined answer for every combination including none
 * of them. So each field is taken on its own and a bad one costs only itself.
 */
function loudness(analysis: StoredAnalysis | undefined): MeasuredLoudness {
    const data = analysis?.data;
    // `integratedLufs` is the analyzer's name for it and `loudnessLufs` is the
    // item's; this line is the whole of that translation.
    const loudnessLufs = taggedLoudness(data) ?? measurement(data?.integratedLufs);
    const truePeakDb = measurement(data?.truePeakDb);
    const samplePeakDb = measurement(data?.samplePeakDb);

    return {
        ...(loudnessLufs === undefined ? {} : { loudnessLufs }),
        ...(truePeakDb === undefined ? {} : { truePeakDb }),
        ...(samplePeakDb === undefined ? {} : { samplePeakDb }),
    };
}

/**
 * How loud the FILE says it is, from its own ReplayGain or R128 tags.
 *
 * Preferred over the measurement where a file carries it, which is the rule
 * `docs/todo/station-intelligence.md` §4 states and the reason for it is not accuracy:
 * a tag is what the mastering engineer or the label decided, and the measurement is
 * what this station guessed. Where they disagree the station is not the authority.
 *
 * **This is the only place the preference is expressed**, so an item carries one
 * loudness and everything downstream is spared knowing where it came from. The blob
 * keeps both.
 *
 * The tagged PEAK is deliberately not preferred anywhere: it is a sample peak by
 * definition, and the measurement has a true one, which is the number a boost is
 * actually capped against.
 */
function taggedLoudness(data: StoredAnalysis['data'] | undefined): number | undefined {
    const gainDb = measurement(data?.tagGainDb);
    const referenceLufs = measurement(data?.tagReferenceLufs);
    // Both or neither. A gain with no reference is not a weaker claim about the
    // record's level, it is no claim at all -- the two conventions in the wild
    // are five decibels apart -- so an incomplete pair falls through to the
    // measurement rather than being read against an assumed reference here.
    if (gainDb === undefined || referenceLufs === undefined) return undefined;

    return referenceLufs - gainDb;
}

const measurement = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
