// The two settings that bound how long a record may be before the station will air it, and the
// predicate every one of the three enforcement points shares. Both default off, so an upgrade
// changes nothing until an operator sets one, and a record of unknown length always passes: that
// is a fact nobody measured rather than a fact that says the record is too long.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    DEFAULT_MAX_TRACK_SECONDS,
    DEFAULT_MIN_TRACK_SECONDS,
    fitsLength,
    TRACK_LENGTH_KEYS,
    trackLengthBounds,
} from '../../../src/modules/director/track.length.js';

/**
 * A config that hands back STRINGS, on the same rule `break.words.test.ts` tests against: every
 * layer of `AppConfig` holds text, and a double that coerces on the way out would pass whether or
 * not the resolver actually parses anything.
 */
const configOf = (values: Record<string, string>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

describe('trackLengthBounds', () => {
    it('is off by default, which is what makes an upgrade a no-op', () => {
        expect(DEFAULT_MIN_TRACK_SECONDS).toBe(0);
        expect(DEFAULT_MAX_TRACK_SECONDS).toBe(0);
        expect(trackLengthBounds(configOf({}))).toEqual({});
    });

    it('reads a stored row, in milliseconds', () => {
        expect(trackLengthBounds(configOf({ [TRACK_LENGTH_KEYS.minTrackSeconds]: '60' }))).toEqual({ minMs: 60_000 });
        expect(trackLengthBounds(configOf({ [TRACK_LENGTH_KEYS.maxTrackSeconds]: '900' }))).toEqual({ maxMs: 900_000 });
    });

    it('reads both ends independently', () => {
        const bounds = trackLengthBounds(configOf({ [TRACK_LENGTH_KEYS.minTrackSeconds]: '60', [TRACK_LENGTH_KEYS.maxTrackSeconds]: '900' }));
        expect(bounds).toEqual({ minMs: 60_000, maxMs: 900_000 });
    });

    it('is off for a stored zero, explicitly', () => {
        expect(trackLengthBounds(configOf({ [TRACK_LENGTH_KEYS.minTrackSeconds]: '0' }))).toEqual({});
    });

    it('takes the default (off) for a value nobody can parse', () => {
        expect(trackLengthBounds(configOf({ [TRACK_LENGTH_KEYS.maxTrackSeconds]: 'plenty' }))).toEqual({});
    });
});

describe('fitsLength', () => {
    it('lets an unmeasured record through, whatever the bounds', () => {
        expect(fitsLength(undefined, { minMs: 60_000, maxMs: 900_000 })).toBe(true);
    });

    it('drops a record below the floor', () => {
        expect(fitsLength(30_000, { minMs: 60_000 })).toBe(false);
    });

    it('drops a record above the ceiling', () => {
        expect(fitsLength(1_000_000, { maxMs: 900_000 })).toBe(false);
    });

    it('keeps a record inside both bounds', () => {
        expect(fitsLength(200_000, { minMs: 60_000, maxMs: 900_000 })).toBe(true);
    });

    it('keeps anything at all when the bounds are off', () => {
        expect(fitsLength(1, {})).toBe(true);
    });
});
