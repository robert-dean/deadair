// The switch is read on the hand-over path, so the only interesting question is what an unclear
// value does: it has to fall back to the default rather than throw, because the caller's alternative
// to a cached URL is a provider URL and its alternative to both is silence on the mount.

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { DEFAULT_TRACK_CACHE, TRACK_CACHE_KEY, trackCacheEnabled } from '../../../../src/modules/playout/audio/track.cache.settings.js';

const config = (values: Record<string, unknown>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

describe('trackCacheEnabled', () => {
    it('is on for a station that has never said otherwise', () => {
        expect(trackCacheEnabled(config({}))).toBe(DEFAULT_TRACK_CACHE);
        expect(trackCacheEnabled(config({}))).toBe(true);
    });

    it('is off when the operator turned it off', () => {
        expect(trackCacheEnabled(config({ [TRACK_CACHE_KEY]: 'false' }))).toBe(false);
    });

    // What the console writes is a string; what a hand-edited row or a test holds may be a boolean.
    it('reads either shape a settings row arrives in', () => {
        expect(trackCacheEnabled(config({ [TRACK_CACHE_KEY]: false }))).toBe(false);
        expect(trackCacheEnabled(config({ [TRACK_CACHE_KEY]: true }))).toBe(true);
        expect(trackCacheEnabled(config({ [TRACK_CACHE_KEY]: 'true' }))).toBe(true);
    });

    it.each(['off', 'OFF', 'no', '0', ' false '])('takes %s as off, because that is what somebody typing it meant', value => {
        expect(trackCacheEnabled(config({ [TRACK_CACHE_KEY]: value }))).toBe(false);
    });

    it.each([
        ['an empty row', ''],
        ['a row somebody typed a word into', 'sometimes'],
    ])('falls back to the default for %s rather than throwing on a hand-over', (_, value) => {
        expect(trackCacheEnabled(config({ [TRACK_CACHE_KEY]: value }))).toBe(DEFAULT_TRACK_CACHE);
    });
});
