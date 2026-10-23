// Cutting a chart to its slot. Pure arithmetic, so a table: what is kept is always the TOP of the
// chart, and the first record is kept whatever it costs.

import { describe, expect, it } from 'vitest';

import { NOMINAL_TRACK_MS } from '../../../src/modules/director/air.estimate.js';
import { CHART_TALK_SHARE, fitAirtime, lookupsFor, overdueCountdown, recordBudget } from '../../../src/modules/director/chart.airtime.js';
import type { StationLineupItem, StationLineupItemState } from '../../../src/modules/director/station.lineup.js';

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

describe('fitAirtime, running over', () => {
    it('lets a countdown run past the end by its last record, number one', () => {
        // 12 minutes of records against 10: number one starts at 8 and ends 2 minutes over.
        const chart = [record(1, 4), record(2, 4), record(3, 4)];

        expect(ranks(fitAirtime(chart, 10 * MINUTE, { overrunMs: 5 * MINUTE, lastAirs: 'top' }))).toEqual([1, 2, 3]);
    });

    it('never lets number one START after the end, whatever the overrun', () => {
        // Four records end 16 minutes in against 10, inside 10 plus a generous overrun, but number
        // one would start at 12, after the next block has begun, and a changeover drops it.
        const chart = [record(1, 4), record(2, 4), record(3, 4), record(4, 4)];

        expect(ranks(fitAirtime(chart, 10 * MINUTE, { overrunMs: 30 * MINUTE, lastAirs: 'top' }))).toEqual([1, 2, 3]);
    });

    it('keeps number one inside the overrun, so a capped station never fades it', () => {
        // Number one is nine minutes long. After one record it ends 3 over; after two, at 17, it would
        // end 7 over, past the 5 allowed, so the third is dropped.
        const chart = [record(1, 9), record(2, 4), record(3, 4)];

        expect(ranks(fitAirtime(chart, 10 * MINUTE, { overrunMs: 5 * MINUTE, lastAirs: 'top' }))).toEqual([1, 2]);
    });

    it('lets the lowest record run over instead when the chart is walked from the top', () => {
        const chart = [record(1, 4), record(2, 4), record(3, 4)];

        expect(ranks(fitAirtime(chart, 10 * MINUTE, { overrunMs: 5 * MINUTE, lastAirs: 'bottom' }))).toEqual([1, 2, 3]);
        expect(ranks(fitAirtime(chart, 7 * MINUTE, { overrunMs: 5 * MINUTE, lastAirs: 'bottom' }))).toEqual([1, 2]);
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

describe('overdueCountdown', () => {
    // A countdown still to come, in airing order: the lowest rank first, number one last.
    const charted = (rank: number, minutes = 4, state: StationLineupItemState = 'planned'): StationLineupItem => ({
        id: `rank-${rank}`,
        kind: 'track',
        state,
        track: {
            pluginId: 'test',
            externalId: `rank-${rank}`,
            title: `Number ${rank}`,
            artists: ['Somebody'],
            artist: 'Somebody',
            durationMs: minutes * MINUTE,
            chart: { rank, name: 'Top 100' },
        },
    });
    const countdown = (...ranks: number[]) => ranks.map(rank => charted(rank));
    const request: StationLineupItem = {
        id: 'request',
        kind: 'track',
        state: 'planned',
        pinned: true,
        track: { pluginId: 'test', externalId: 'request', title: 'Asked for', artists: ['Listener'], artist: 'Listener', durationMs: 4 * MINUTE },
    };
    const nothingKept = () => false;

    it('removes nothing from a countdown that is on time', () => {
        expect(overdueCountdown(countdown(5, 4, 3, 2, 1), { untilEndMs: 30 * MINUTE, talks: false, keep: nothingKept })).toEqual([]);
    });

    it('takes out the lowest ranks still to come, so number one still starts before the end', () => {
        // Twelve minutes is three records: 3, 2 and 1. The 47 minutes nobody listened to, in miniature.
        expect(overdueCountdown(countdown(5, 4, 3, 2, 1), { untilEndMs: 12 * MINUTE, talks: false, keep: nothingKept })).toEqual([
            'rank-5',
            'rank-4',
        ]);
    });

    it('lets number one run past the end by the overrun, as the fit does', () => {
        // Number one starts at minute eight, inside ten, and ends at twelve, inside ten plus five.
        expect(
            overdueCountdown(countdown(5, 4, 3, 2, 1), { untilEndMs: 10 * MINUTE, overrunMs: 5 * MINUTE, talks: false, keep: nothingKept }),
        ).toEqual(['rank-5', 'rank-4']);
    });

    it('holds back the talk share when the broadcast takes breaks', () => {
        expect(overdueCountdown(countdown(5, 4, 3, 2, 1), { untilEndMs: 20 * MINUTE, talks: false, keep: nothingKept })).toEqual([]);
        expect(overdueCountdown(countdown(5, 4, 3, 2, 1), { untilEndMs: 20 * MINUTE, talks: true, keep: nothingKept })).toEqual(['rank-5']);
    });

    it('charges what is on air, and a request that keeps its turn, to the countdown', () => {
        const order = [charted(4), request, charted(3), charted(2), charted(1)];

        expect(overdueCountdown(order, { untilEndMs: 16 * MINUTE, leadMs: 4 * MINUTE, talks: false, keep: item => item.pinned === true })).toEqual([
            'rank-4',
            'rank-3',
        ]);
    });

    it('never takes out a chart record the station has to keep, and charges its time instead', () => {
        // Number four is the record a held break announced.
        const order = countdown(5, 4, 3, 2, 1);

        expect(overdueCountdown(order, { untilEndMs: 12 * MINUTE, talks: false, keep: item => item.id === 'rank-4' })).toEqual(['rank-5', 'rank-3']);
    });

    it('never takes out a record the player already holds', () => {
        const order = [charted(5, 4, 'handed'), ...countdown(4, 3, 2, 1)];

        expect(overdueCountdown(order, { untilEndMs: 12 * MINUTE, talks: false, keep: nothingKept })).toEqual(['rank-4', 'rank-3']);
    });

    it('keeps number one when the slot has already ended, and cuts everything in front of it', () => {
        expect(overdueCountdown(countdown(3, 2, 1), { untilEndMs: -MINUTE, talks: false, keep: nothingKept })).toEqual(['rank-3', 'rank-2']);
    });

    it('cuts nothing once number one is out of its reach', () => {
        // Nothing left to protect: number one is in the player's hands.
        expect(overdueCountdown([charted(2), charted(1, 4, 'handed')], { untilEndMs: -MINUTE, talks: false, keep: nothingKept })).toEqual([]);
        expect(overdueCountdown([request], { untilEndMs: -MINUTE, talks: false, keep: nothingKept })).toEqual([]);
    });
});
