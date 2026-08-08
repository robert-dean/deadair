// The one thing that must never happen here is a station refusing to air because a
// settings row holds a typo. Every unreadable value has to resolve to a mode, and the
// mode it resolves to has to be the one an install with nothing stored gets.

import { describe, expect, it } from 'vitest';

import { DEFAULT_AIR_MODE, parseAirMode } from '../../../src/modules/playout/air.mode.js';

describe('parseAirMode', () => {
    it('reads the two modes', () => {
        expect(parseAirMode('audience')).toBe('audience');
        expect(parseAirMode('always')).toBe('always');
    });

    it('falls back to the default for an unset key', () => {
        expect(parseAirMode(undefined)).toBe(DEFAULT_AIR_MODE);
    });

    it('falls back to the default rather than throwing on a value nobody recognises', () => {
        expect(parseAirMode('sometimes')).toBe(DEFAULT_AIR_MODE);
        expect(parseAirMode('')).toBe(DEFAULT_AIR_MODE);
    });

    it('defaults to airing only for an audience', () => {
        // Including for a station upgrading into this: a mount airing to nobody is what
        // is being fixed, so the fix is what happens without anyone opting in.
        expect(DEFAULT_AIR_MODE).toBe('audience');
    });
});
