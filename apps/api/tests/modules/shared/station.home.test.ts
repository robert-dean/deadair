import { describe, expect, it } from 'vitest';

import { homeRule, LOCATION_MAX, stationLocation } from '../../../src/modules/shared/station.home.js';

describe('stationLocation', () => {
    it('trims and collapses what the operator typed', () => {
        expect(stationLocation('  Atlanta,\n  GA ')).toBe('Atlanta, GA');
    });

    it('answers nothing for a blank or missing setting', () => {
        expect(stationLocation(undefined)).toBeUndefined();
        expect(stationLocation('   ')).toBeUndefined();
    });

    it('bounds a pasted paragraph', () => {
        expect(stationLocation('x'.repeat(500))).toHaveLength(LOCATION_MAX);
    });
});

describe('homeRule', () => {
    it('names the location as the only here and says what cannot move it', () => {
        const rule = homeRule('Atlanta, GA');

        expect(rule).toContain('The station broadcasts from Atlanta, GA, and that is the only place you may call here, home, this town or our city.');
        expect(rule).toContain('never moves it: that is background, not where you are now. A place you are given');
    });

    it('claims no here at all when there is no location', () => {
        const rule = homeRule(undefined);

        expect(rule).toContain('You have not been told where the station is');
        expect(rule).toContain('do not tell you. A place you are given');
    });

    it('never names a part of the day, so it cannot argue with the clock rules', () => {
        for (const rule of [homeRule('Atlanta'), homeRule(undefined)]) expect(rule).not.toMatch(/tonight|morning|evening|afternoon/i);
    });
});
