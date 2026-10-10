// How many records follow a request: none off a request show, the default when nobody said, and a
// stored value outside the bounds clamped rather than refused, since a running order that will not
// load stops the station.

import { describe, expect, it } from 'vitest';
import { followOnFor, REQUEST_FOLLOW_ON_DEFAULT, REQUEST_FOLLOW_ON_MAX } from '../../../src/modules/director/request.show.js';

describe('followOnFor', () => {
    it('is none unless this is a request show', () => {
        expect(followOnFor(undefined)).toBe(0);
        expect(followOnFor({})).toBe(0);
        expect(followOnFor({ requestShow: false, requestFollowOn: 5 })).toBe(0);
    });

    it('takes the default when the show did not say', () => {
        expect(followOnFor({ requestShow: true })).toBe(REQUEST_FOLLOW_ON_DEFAULT);
    });

    it('takes what the show asked for, clamped to the bounds', () => {
        expect(followOnFor({ requestShow: true, requestFollowOn: 2 })).toBe(2);
        expect(followOnFor({ requestShow: true, requestFollowOn: 0 })).toBe(0);
        expect(followOnFor({ requestShow: true, requestFollowOn: 99 })).toBe(REQUEST_FOLLOW_ON_MAX);
        expect(followOnFor({ requestShow: true, requestFollowOn: -3 })).toBe(0);
        expect(followOnFor({ requestShow: true, requestFollowOn: Number.NaN })).toBe(REQUEST_FOLLOW_ON_DEFAULT);
    });
});
