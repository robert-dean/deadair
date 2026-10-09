// Cutting a chart to its slot. Pure arithmetic, so a table: what is kept is always the TOP of the
// chart, and the first record is kept whatever it costs.

import { describe, expect, it } from 'vitest';

import { NOMINAL_TRACK_MS } from '../../../src/modules/director/air.estimate.js';
import { CHART_TALK_SHARE, fitAirtime, lookupsFor, recordBudget } from '../../../src/modules/director/chart.airtime.js';

const MINUTE = 60_000;
const record = (rank: number, minutes?: number) => ({ rank, ...(minutes === undefined ? {} : { durationMs: minutes * MINUTE }) });
const ranks = (tracks: readonly { rank: number }[]) => tracks.map(track => track.rank);

describe('fitAirtime', () => {
    it('keeps the top of the chart that fits, and drops the lowest ranks', () => {
        const chart = [record(1, 4), record(2, 4), record(3, 4), record(4, 4)];

        expect(ranks(fitAirtime(chart, 12 * MINUTE))).toEqual([1, 2, 3]);
    });

    it('stops at the first record that would overrun rather than skipping to a shorter one below it', () => {
        // Skipping 2 for 3 would air a countdown with a hole in it.
        const chart = [record(1, 4), record(2, 10), record(3, 2)];

        expect(ranks(fitAirtime(chart, 8 * MINUTE))).toEqual([1]);
    });

    it('counts an unmeasured record as an average one', () => {
        const chart = [record(1), record(2), record(3)];

        expect(ranks(fitAirtime(chart, 2 * NOMINAL_TRACK_MS))).toEqual([1, 2]);
    });

    it('counts a measured record by its trimmed length', () => {
        const trimmed = { rank: 1, durationMs: 6 * MINUTE, cueInMs: 0, cueOutMs: 3 * MINUTE };

        expect(ranks(fitAirtime([trimmed, record(2, 3)], 6 * MINUTE))).toEqual([1, 2]);
    });

    it('keeps number one even when nothing fits', () => {
        expect(ranks(fitAirtime([record(1, 5), record(2, 3)], MINUTE))).toEqual([1]);
    });

    it('fits more of the same chart into a longer slot', () => {
        const chart = Array.from({ length: 100 }, (_, index) => record(index + 1, 4));

        expect(fitAirtime(chart, recordBudget(60 * MINUTE, true))).toHaveLength(14);
        expect(fitAirtime(chart, recordBudget(300 * MINUTE, true))).toHaveLength(71);
    });
});

describe('recordBudget', () => {
    it('holds a share back for talk only when the broadcast talks', () => {
        expect(recordBudget(100 * MINUTE, true)).toBe(100 * MINUTE * (1 - CHART_TALK_SHARE));
        expect(recordBudget(100 * MINUTE, false)).toBe(100 * MINUTE);
    });
});

describe('lookupsFor', () => {
    it('asks for more than would fit, for the names that resolve to nothing', () => {
        expect(lookupsFor(10 * NOMINAL_TRACK_MS)).toBe(15);
    });

    it('asks for at least one', () => {
        expect(lookupsFor(0)).toBe(1);
    });
});
