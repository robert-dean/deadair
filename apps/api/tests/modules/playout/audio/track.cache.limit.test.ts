// The cap is read on a job that deletes files, so the direction it fails in is the whole point: a
// value nobody can parse has to mean "keep everything", never "keep nothing".

import { describe, expect, it } from 'vitest';

import { DEFAULT_TRACK_CACHE_MAX_BYTES, resolveTrackCacheMaxBytes } from '../../../../src/modules/playout/audio/track.cache.limit.js';

describe('resolveTrackCacheMaxBytes', () => {
    it('reads a number as itself', () => {
        expect(resolveTrackCacheMaxBytes(20 * 1024 * 1024 * 1024)).toBe(21474836480);
    });

    // Settings arrive from a jsonb column and from dotenv, so the string spelling is the common one.
    it('reads the same number written as a string', () => {
        expect(resolveTrackCacheMaxBytes('21474836480')).toBe(21474836480);
    });

    it('floors a fractional byte count, since half a byte is not a thing', () => {
        expect(resolveTrackCacheMaxBytes(1536.75)).toBe(1536);
    });

    it.each([
        ['unset', undefined],
        ['empty', ''],
        ['not a number at all', 'twenty gigs'],
        ['zero', 0],
        // The one value with no meaning. Reading it as "cap everything" would empty the cache over a
        // stray minus sign.
        ['negative', -5],
        ['infinite', Number.POSITIVE_INFINITY],
    ])('answers no cap for %s', (_, value) => {
        expect(resolveTrackCacheMaxBytes(value)).toBe(DEFAULT_TRACK_CACHE_MAX_BYTES);
    });

    it('has no cap by default, which is what the station has always done', () => {
        expect(DEFAULT_TRACK_CACHE_MAX_BYTES).toBe(0);
    });
});
