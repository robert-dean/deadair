// Whether a hard marker can land on its time, and the operator's limit on how much it may cut. The walk
// that asks is in `break.planner.test.ts`; this is the rule it asks.

import { describe, expect, it } from 'vitest';

import { canLandOnTime, FILL_SLACK_MS, HARD_MIN_PLAY_MS, resolveHardMarkers, waitBefore } from '../../../src/modules/director/hard.marker.js';
import type { StationLineupItem } from '../../../src/modules/director/station.lineup.js';
import { settingsConfig } from '../../utils/settings.config.js';

const MINUTE = 60_000;
const NINE = Date.UTC(2026, 10, 13, 9, 0);

const record = (id: string): StationLineupItem => ({
    id,
    kind: 'track',
    state: 'planned',
    track: { pluginId: 'test', externalId: id, title: id, artists: ['Somebody'], artist: 'Somebody', durationMs: 4 * MINUTE },
});
const talk = (id: string): StationLineupItem => ({ id, kind: 'segment', state: 'planned', segmentId: id });

describe('canLandOnTime', () => {
    const rules = { maxCutMs: 2 * MINUTE, maxWaitMs: MINUTE };
    // The record in front starts at 08:57 and would end at 09:01, so the boundary is a minute past nine.
    const items = [record('a'), record('b')];
    const projected = [NINE - 3 * MINUTE, NINE + MINUTE];

    it('lands when the record in front can be cut to end on the time', () => {
        expect(canLandOnTime(items, projected, 1, NINE, rules)).toBe(true);
    });

    it('does not when the cut would take more than the limit', () => {
        expect(canLandOnTime(items, projected, 1, NINE, { maxCutMs: 30_000, maxWaitMs: MINUTE })).toBe(false);
    });

    it('does not cut speech', () => {
        expect(canLandOnTime([talk('t'), record('b')], projected, 1, NINE, rules)).toBe(false);
    });

    it('does not start a record only to fade it away almost at once', () => {
        const late = [NINE - HARD_MIN_PLAY_MS + 1_000, NINE + MINUTE];
        expect(canLandOnTime(items, late, 1, NINE, rules)).toBe(false);
    });

    it('does not land where the projection says nothing', () => {
        expect(canLandOnTime(items, [undefined, NINE + MINUTE], 1, NINE, rules)).toBe(false);
        expect(canLandOnTime(items, projected, 0, NINE, rules)).toBe(false);
    });
});

describe('resolveHardMarkers', () => {
    it('takes two minutes of cut and one of wait when nothing is set', () => {
        expect(resolveHardMarkers(settingsConfig().config)).toEqual({ maxCutMs: 120_000, maxWaitMs: 60_000 });
    });

    it('reads the wait on its own', () => {
        expect(resolveHardMarkers(settingsConfig({ 'rotation.hardMarkerMaxWaitSeconds': '90' }).config)).toMatchObject({ maxWaitMs: 90_000 });
        expect(resolveHardMarkers(settingsConfig({ 'rotation.hardMarkerMaxWaitSeconds': '999' }).config)).toMatchObject({ maxWaitMs: 300_000 });
    });

    it('reads the setting as the string it is stored as', () => {
        expect(resolveHardMarkers(settingsConfig({ 'rotation.hardMarkerMaxCutSeconds': '45' }).config)).toMatchObject({ maxCutMs: 45_000 });
    });

    it('clamps a stored figure to its range rather than refusing it', () => {
        expect(resolveHardMarkers(settingsConfig({ 'rotation.hardMarkerMaxCutSeconds': '9000' }).config)).toMatchObject({ maxCutMs: 300_000 });
        expect(resolveHardMarkers(settingsConfig({ 'rotation.hardMarkerMaxCutSeconds': '-5' }).config)).toMatchObject({ maxCutMs: 0 });
    });

    it('takes the default for a value nobody can read', () => {
        expect(resolveHardMarkers(settingsConfig({ 'rotation.hardMarkerMaxCutSeconds': 'soon' }).config)).toMatchObject({ maxCutMs: 120_000 });
    });
});

describe('waitBefore', () => {
    const rules = { maxCutMs: 2 * MINUTE, maxWaitMs: MINUTE };
    // The boundary before nine is at 08:59:20, forty seconds early; the one after is at 09:03.
    const projected = [NINE - 4 * MINUTE, NINE - 40_000, NINE + 3 * MINUTE];
    const long = 40_000 + FILL_SLACK_MS;

    it('is the wait at the boundary before the time, with a bed long enough to fill it', () => {
        expect(waitBefore(projected, 2, NINE, 0, rules, long)).toBe(40_000);
    });

    it('is nothing without a bed long enough, to spare', () => {
        expect(waitBefore(projected, 2, NINE, 0, rules, long - 1)).toBeUndefined();
    });

    it('is nothing when the wait is longer than the station allows', () => {
        expect(waitBefore(projected, 2, NINE, 0, { ...rules, maxWaitMs: 30_000 }, long)).toBeUndefined();
    });

    it('is nothing at a boundary the walk may no longer plant at', () => {
        expect(waitBefore(projected, 2, NINE, 2, rules, long)).toBeUndefined();
    });

    it('is nothing when the boundary before is already on the time, which is a cut of nothing instead', () => {
        expect(waitBefore([NINE - 4 * MINUTE, NINE, NINE + 3 * MINUTE], 2, NINE, 0, rules, long)).toBeUndefined();
    });
});
