// The estimate the spacing rules count with. Unlike `air.clock.ts` it is allowed to be wrong in
// either direction, so what matters here is that it is roughly right: an unmeasured record is an
// average one rather than nothing, a measured one counts what actually plays, and a segment is free.

import { describe, expect, it } from 'vitest';

import { NOMINAL_TRACK_MS, estimateStartOffsets, recordSpacingLength, spacingLengthOf } from '../../../src/modules/director/air.estimate.js';
import type { StationLineupItem } from '../../../src/modules/director/station.lineup.js';

let next = 0;
const id = (): string => `item-${++next}`;

const track = (durationMs?: number, cues?: { cueInMs?: number; cueOutMs?: number }): StationLineupItem => ({
    id: id(),
    kind: 'track',
    state: 'planned',
    track: {
        pluginId: 'test',
        externalId: id(),
        title: 'A record',
        artists: ['Somebody'],
        artist: 'Somebody',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...cues,
    },
});

const segment = (): StationLineupItem => ({ id: id(), kind: 'segment', state: 'planned', segmentId: id() });

describe('recordSpacingLength', () => {
    it('counts a record nobody measured as an average one, not as nothing', () => {
        expect(recordSpacingLength({})).toBe(NOMINAL_TRACK_MS);
    });

    it('counts what plays between the cue points when the record was measured', () => {
        expect(recordSpacingLength({ durationMs: 300_000, cueInMs: 2_000, cueOutMs: 290_000 })).toBe(288_000);
    });

    it('trims the lead-in from the whole file when only the start was measured', () => {
        expect(recordSpacingLength({ durationMs: 200_000, cueInMs: 5_000 })).toBe(195_000);
    });
});

describe('spacingLengthOf', () => {
    it('counts a segment as nothing', () => {
        expect(spacingLengthOf(segment())).toBe(0);
    });

    it('counts a record by its spacing length', () => {
        expect(spacingLengthOf(track(180_000))).toBe(180_000);
    });
});

describe('estimateStartOffsets', () => {
    it('starts the first item now when nothing is said about what is playing', () => {
        expect(estimateStartOffsets([track(180_000), track(240_000)])).toEqual([0, 180_000, 420_000]);
    });

    it('starts the first item once what is playing has finished', () => {
        expect(estimateStartOffsets([track(180_000), track(240_000)], 60_000)).toEqual([60_000, 240_000, 480_000]);
    });

    it('treats a negative lead as nothing left, rather than starting the queue in the past', () => {
        expect(estimateStartOffsets([track(180_000)], -5_000)).toEqual([0, 180_000]);
    });

    it('counts an unmeasured record as an average one and a segment as nothing', () => {
        expect(estimateStartOffsets([track(), segment(), track(100_000)])).toEqual([
            0,
            NOMINAL_TRACK_MS,
            NOMINAL_TRACK_MS,
            NOMINAL_TRACK_MS + 100_000,
        ]);
    });

    it('answers where the next thing appended would start, even for an empty queue', () => {
        expect(estimateStartOffsets([], 30_000)).toEqual([30_000]);
    });
});
