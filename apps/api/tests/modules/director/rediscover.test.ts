import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    ARTIST_RETURN_DAYS_RANGE,
    DEFAULT_ARTIST_RETURN_DAYS,
    REDISCOVER_KEYS,
    clampArtistReturnDays,
    historyDaysForLeans,
    isDeepCut,
    quietMinutesFor,
    resolveArtistReturn,
} from '../../../src/modules/director/rediscover.js';
import { PLAY_HISTORY_RETENTION_DAYS } from '../../../src/modules/director/play.history.repository.js';

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

describe('a deep cut', () => {
    const liked = new Set(['album']);

    it('is an unaired record with a place on an album the operator likes', () => {
        expect(isDeepCut({ albumId: 'album', trackNumber: 9 }, liked, false)).toBe(true);
    });

    it('is not one that aired, one liked for itself, one with no place, or one on an album nobody liked', () => {
        expect(isDeepCut({ albumId: 'album', trackNumber: 9 }, liked, true)).toBe(false);
        expect(isDeepCut({ albumId: 'album', trackNumber: 9, trackLiked: true }, liked, false)).toBe(false);
        expect(isDeepCut({ albumId: 'album' }, liked, false)).toBe(false);
        expect(isDeepCut({ albumId: 'other', trackNumber: 9 }, liked, false)).toBe(false);
        expect(isDeepCut({ trackNumber: 9 }, liked, false)).toBe(false);
    });

    it('reads the whole retention when on, and only the smart shuffle horizon when off', () => {
        expect(historyDaysForLeans(14, true)).toBe(PLAY_HISTORY_RETENTION_DAYS);
        expect(historyDaysForLeans(14, false)).toBe(14);
        expect(historyDaysForLeans(0, false)).toBe(0);
    });
});
