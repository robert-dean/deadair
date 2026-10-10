import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    DEFAULT_SKIP_LEAN_DAYS,
    SKIP_FLOOR,
    SKIP_LEAN_DAYS_RANGE,
    SKIP_LEAN_KEYS,
    clampSkipLeanDays,
    resolveSkipLean,
    skipDaysFor,
    skipWeight,
} from '../../../src/modules/director/skip.lean.js';

const configWith = (settings: Record<string, unknown>) =>
    ({ get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback) }) as unknown as AppConfig;

describe('the skip lean', () => {
    it('is on, over a fortnight, for a station that never set it', () => {
        expect(resolveSkipLean(configWith({}))).toEqual({ enabled: true, days: DEFAULT_SKIP_LEAN_DAYS });
    });

    it('is off when the row holds the string false, and then reads nothing', () => {
        const lean = resolveSkipLean(configWith({ [SKIP_LEAN_KEYS.enabled]: 'false' }));
        expect(lean.enabled).toBe(false);
        expect(skipDaysFor(lean)).toBe(0);
    });

    it('clamps a stored window into range rather than refusing it', () => {
        expect(clampSkipLeanDays('0')).toBe(SKIP_LEAN_DAYS_RANGE.min);
        expect(clampSkipLeanDays('400')).toBe(SKIP_LEAN_DAYS_RANGE.max);
        expect(clampSkipLeanDays('nope')).toBe(DEFAULT_SKIP_LEAN_DAYS);
    });

    it('starts at the floor, rises evenly, and never reaches zero', () => {
        expect(skipWeight(0)).toBe(SKIP_FLOOR);
        expect(skipWeight(0.5)).toBeCloseTo(SKIP_FLOOR + (1 - SKIP_FLOOR) / 2);
        expect(skipWeight(1)).toBe(1);
        expect(skipWeight(-3)).toBe(SKIP_FLOOR);
        expect(skipWeight(undefined)).toBe(1);
        expect(skipWeight(Number.NaN)).toBe(1);
    });
});
