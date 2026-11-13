import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ASSUMED_BED_LUFS, BED_LEVEL_BOUNDS, bedGainDb, bedLevelDb } from '../../../src/modules/render/bed.settings.js';
import { ASSUMED_SPEECH_LUFS, MAX_GAIN_DB } from '../../../src/modules/playout/gain.js';

/** Every layer of AppConfig holds strings, so the double does too. */
const config = (values: Record<string, string>): AppConfig =>
    ({ get: (key: string, fallback?: unknown) => values[key] ?? fallback }) as unknown as AppConfig;

describe('bedLevelDb', () => {
    it('is eighteen under the words when nobody set it', () => {
        expect(bedLevelDb(config({}))).toBe(-18);
        expect(bedLevelDb(config({ 'render.bedLevelDb': '' }))).toBe(-18);
    });

    it('reads a stored string and clamps it into the range', () => {
        expect(bedLevelDb(config({ 'render.bedLevelDb': '-24' }))).toBe(-24);
        expect(bedLevelDb(config({ 'render.bedLevelDb': '0' }))).toBe(BED_LEVEL_BOUNDS.max);
        expect(bedLevelDb(config({ 'render.bedLevelDb': '-90' }))).toBe(BED_LEVEL_BOUNDS.min);
    });
});

describe('bedGainDb', () => {
    it('puts a measured bed the asked distance under the assumed speech level', () => {
        expect(bedGainDb(-14, -18)).toBeCloseTo(ASSUMED_SPEECH_LUFS - 18 + 14, 1);
    });

    it('turns a bed down further than a pad could ever be, because eighteen under is the ordinary case', () => {
        expect(bedGainDb(-8, -18)).toBeLessThan(-MAX_GAIN_DB);
    });

    it('assumes a streaming master for a bed nobody measured, rather than leaving it at full level', () => {
        expect(bedGainDb(undefined, -18)).toBe(bedGainDb(ASSUMED_BED_LUFS, -18));
        expect(bedGainDb(Number.NaN, -18)).toBe(bedGainDb(ASSUMED_BED_LUFS, -18));
        expect(bedGainDb(undefined, -18)).toBeLessThan(0);
    });

    it('never lifts a quiet bed by more than the station lifts anything', () => {
        expect(bedGainDb(-70, -6)).toBe(MAX_GAIN_DB);
    });
});
