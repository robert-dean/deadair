import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    ARTIST_RETURN_DAYS_RANGE,
    DEFAULT_ARTIST_RETURN_DAYS,
    REDISCOVER_KEYS,
    clampArtistReturnDays,
    quietMinutesFor,
    resolveArtistReturn,
} from '../../../src/modules/director/rediscover.js';

const configWith = (settings: Record<string, unknown>) =>
    ({ get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback) }) as unknown as AppConfig;

describe('the artist-return lean', () => {
    it('is on, over three weeks, for a station that never set it', () => {
        expect(resolveArtistReturn(configWith({}))).toEqual({ enabled: true, days: DEFAULT_ARTIST_RETURN_DAYS });
    });

    it('is off when the row holds the string false', () => {
        // A setting is a string, and the string 'false' is truthy.
        expect(resolveArtistReturn(configWith({ [REDISCOVER_KEYS.artistReturn]: 'false' })).enabled).toBe(false);
    });

    it('clamps a stored window into range rather than refusing it', () => {
        expect(clampArtistReturnDays('1')).toBe(ARTIST_RETURN_DAYS_RANGE.min);
        expect(clampArtistReturnDays('400')).toBe(ARTIST_RETURN_DAYS_RANGE.max);
        expect(clampArtistReturnDays('30.7')).toBe(30);
        expect(clampArtistReturnDays('soon')).toBe(DEFAULT_ARTIST_RETURN_DAYS);
    });

    it('asks for the window in minutes when on, and for nothing when off', () => {
        expect(quietMinutesFor({ enabled: true, days: 21 })).toBe(21 * 24 * 60);
        expect(quietMinutesFor({ enabled: false, days: 21 })).toBe(0);
    });
});
