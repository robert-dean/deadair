import { describe, expect, it } from 'vitest';

import { claimedHomeIn, homeClaimsIn, homeNames, homeRule, LOCATION_MAX, stationLocation } from '../../../src/modules/shared/station.home.js';

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

describe('homeNames', () => {
    it('is the whole location and each of its parts, normalised', () => {
        expect(homeNames('Atlanta, GA')).toEqual(['atlanta ga', 'atlanta', 'ga']);
        expect(homeNames('São Paulo')).toEqual(['sao paulo']);
    });

    it('is empty for a station with no location', () => {
        expect(homeNames(undefined)).toEqual([]);
    });
});

describe('homeClaimsIn', () => {
    it('finds each explicit shape and the place it named', () => {
        expect(homeClaimsIn('Here in Glasgow tonight.').map(claim => claim.place)).toEqual(['Glasgow']);
        expect(homeClaimsIn('all of you right here in Rio de Janeiro').map(claim => claim.place)).toEqual(['Rio de Janeiro']);
        expect(homeClaimsIn('our hometown, Leeds, is asleep').map(claim => claim.place)).toEqual(['Leeds']);
        expect(homeClaimsIn('this city of New York never sleeps').map(claim => claim.place)).toEqual(['New York']);
        expect(homeClaimsIn('on the air from St. Louis').map(claim => claim.place)).toEqual(['St. Louis']);
    });

    it('stops the place at the end of a sentence', () => {
        expect(homeClaimsIn('Here in Glasgow. Next up, Curtis.').map(claim => claim.place)).toEqual(['Glasgow']);
    });

    it('reads nothing into a lowercase word, a time or a room after the frame', () => {
        for (const script of ['here in the studio', 'here in my head', 'Here in December', 'here in Studio B', "here in Ray's kitchen"]) {
            expect(homeClaimsIn(script), script).toEqual([]);
        }
    });

    it('does not read "back home in" as a claim, since it says the place is not here', () => {
        expect(homeClaimsIn('my mum back home in Glasgow')).toEqual([]);
    });
});

describe('claimedHomeIn', () => {
    it('passes the station location and refuses anywhere else', () => {
        const homes = homeNames('Atlanta, GA');

        expect(claimedHomeIn('Here in Atlanta tonight', homes)).toBeUndefined();
        expect(claimedHomeIn('here in Atlanta, Georgia', homes)).toBeUndefined();
        expect(claimedHomeIn('Here in Glasgow tonight', homes)?.said).toBe('Here in Glasgow');
    });

    it('refuses every claim when there is no location', () => {
        expect(claimedHomeIn('here in Atlanta', [])?.place).toBe('Atlanta');
    });
});
