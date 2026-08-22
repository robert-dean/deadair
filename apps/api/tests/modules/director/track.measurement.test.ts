// A measurement is a blob a plugin wrote, read here for the first time, and the two
// ways of being wrong are not symmetrical. Refusing a measurement leaves a record
// playing raw, which is what every record did before any of this existed. Accepting a
// bad one trims a record to the wrong length or levels it to the wrong place, and
// nothing downstream can tell that it was guessed.

import { describe, expect, it } from 'vitest';

import { awaitsMeasurement, measurementOf, MEASUREMENT_FIELDS } from '../../../src/modules/director/track.measurement.js';
import type { StoredAnalysis } from '../../../src/modules/analysis/analysis.repository.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';

const analysis = (data: Record<string, unknown>): StoredAnalysis => ({ trackId: 'track-1', schemaVersion: 1, data }) as unknown as StoredAnalysis;

/** A well-formed cue span, so a case about loudness does not accidentally test the points. */
const CUES = { cueIn: 100, introEnd: 8_000, outroStart: 200_000, cueOut: 210_000 };

const track = (extra: Partial<RundownTrack> = {}): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId: 'x',
    title: 'A Record',
    artists: ['An Artist'],
    artist: 'An Artist',
    trackId: 'track-1',
    ...extra,
});

describe('measurementOf', () => {
    it('reads both halves of one analysis', () => {
        expect(measurementOf(analysis({ ...CUES, integratedLufs: -9.4, truePeakDb: 0.4, samplePeakDb: -0.1 }))).toEqual({
            cueInMs: 100,
            introEndMs: 8_000,
            outroStartMs: 200_000,
            cueOutMs: 210_000,
            loudnessLufs: -9.4,
            truePeakDb: 0.4,
            samplePeakDb: -0.1,
        });
    });

    it('answers nothing at all for a track nothing has measured', () => {
        // The ordinary state, and the whole reason nothing downstream may read absence
        // as a fault.
        expect(measurementOf(undefined)).toEqual({});
    });

    it('keeps the halves independent, because they fail differently', () => {
        // A cue span that is half measured describes nothing, so it is all-or-none. A
        // loudness with no peak is a real answer that `gainFor` handles, so it stands.
        expect(measurementOf(analysis({ cueIn: 0, introEnd: 5, integratedLufs: -12 }))).toEqual({ loudnessLufs: -12 });
        expect(measurementOf(analysis({ ...CUES })).cueOutMs).toBe(210_000);
    });

    it('refuses a cue span that contradicts itself', () => {
        // Not a detector being imprecise -- `measure.py` clamps into this order before it
        // answers -- so a violation here is a blob from something else.
        expect(measurementOf(analysis({ cueIn: 500, introEnd: 100, outroStart: 200_000, cueOut: 210_000 })).cueOutMs).toBeUndefined();
        expect(measurementOf(analysis({ cueIn: 5_000, introEnd: 8_000, outroStart: 200_000, cueOut: 4_000 })).cueOutMs).toBeUndefined();
        expect(measurementOf(analysis({ ...CUES, cueIn: -1 })).cueOutMs).toBeUndefined();
    });

    it('takes a record with no intro and one that ends as its outro begins', () => {
        // Non-strict between the inner points: both are real records rather than bad blobs.
        expect(measurementOf(analysis({ cueIn: 0, introEnd: 0, outroStart: 0, cueOut: 1_000 })).cueOutMs).toBe(1_000);
    });

    it('drops a bad loudness field without costing the others', () => {
        const measured = measurementOf(analysis({ integratedLufs: Number.NaN, truePeakDb: -1.2, samplePeakDb: 'loud' }));

        expect(measured).toEqual({ truePeakDb: -1.2 });
    });

    it("prefers what the FILE says about its level over the station's own guess", () => {
        // A tag is what the label decided and the measurement is what this station guessed.
        // Where they disagree the station is not the authority.
        expect(measurementOf(analysis({ integratedLufs: -9, tagGainDb: -5, tagReferenceLufs: -18 })).loudnessLufs).toBe(-13);
    });

    it('falls back to the measurement when the tag pair is incomplete', () => {
        // A gain with no reference is not a weaker claim, it is no claim at all: the two
        // conventions in the wild are five decibels apart.
        expect(measurementOf(analysis({ integratedLufs: -9, tagGainDb: -5 })).loudnessLufs).toBe(-9);
        expect(measurementOf(analysis({ integratedLufs: -9, tagReferenceLufs: -18 })).loudnessLufs).toBe(-9);
    });

    it('names every field it can write', () => {
        // MEASUREMENT_FIELDS is what `StationLineup.remeasure` clears before it writes, so a
        // field this can produce and that cannot name is one that would survive a retake.
        const produced = Object.keys(measurementOf(analysis({ ...CUES, integratedLufs: -9, truePeakDb: 0.4, samplePeakDb: -0.1 })));

        expect([...MEASUREMENT_FIELDS].sort()).toEqual(produced.sort());
    });
});

describe('awaitsMeasurement', () => {
    it('is true for a record carrying neither half', () => {
        expect(awaitsMeasurement(track())).toBe(true);
    });

    it('is true when only one half arrived', () => {
        // Both come from one analysis, so half of one is a record resolved before it was
        // measured -- and a record levelled but untrimmed still blends wrong.
        expect(awaitsMeasurement(track({ loudnessLufs: -9 }))).toBe(true);
        expect(awaitsMeasurement(track({ cueInMs: 0, cueOutMs: 1_000 }))).toBe(true);
    });

    it('is false once both halves are on the item', () => {
        expect(awaitsMeasurement(track({ loudnessLufs: -9, cueInMs: 0, cueOutMs: 1_000 }))).toBe(false);
    });

    it('is false for a record the catalog has never seen', () => {
        // No `trackId` is nothing to look up, so asking would be a row per pass for the
        // whole time a provider pick sits in the order.
        expect(awaitsMeasurement(track({ trackId: undefined }))).toBe(false);
    });
});
