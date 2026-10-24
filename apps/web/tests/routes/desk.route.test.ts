// The Desk's address may ask for the request dialog, which is what the Stream Deck's Request key
// opens. What has to hold is that only an ask opens it and that anything else leaves the address bare.

import { describe, expect, it } from 'vitest';

import { validateDeskSearch } from '../../src/routes/index';

describe('validateDeskSearch', () => {
    it('reads ?request=1 and ?request=true as the ask, however the router parsed them', () => {
        for (const request of [1, true, '1', 'true']) expect(validateDeskSearch({ request })).toEqual({ request: true });
    });

    it('leaves the address bare otherwise', () => {
        for (const request of [undefined, 0, false, 'no', 'yes', {}]) expect(validateDeskSearch({ request })).toEqual({});
        expect(validateDeskSearch({ other: 1 })).toEqual({});
    });
});
