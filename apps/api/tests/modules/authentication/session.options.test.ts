// A refresh token repeated moments after it was spent must not revoke the whole family: for an app on
// the MCP endpoint that ends the connection until somebody reconnects it by hand.

import { describe, expect, it } from 'vitest';

import { authenticationSessionOptions, REFRESH_REUSE_GRACE } from '../../../src/modules/authentication/session.options.js';

describe('authenticationSessionOptions', () => {
    it('forgives a repeated refresh for thirty seconds', () => {
        expect(authenticationSessionOptions().refreshReuseGrace).toBe(REFRESH_REUSE_GRACE);
        expect(REFRESH_REUSE_GRACE.as('seconds')).toBe(30);
    });

    it('keeps tokens for thirty days', () => {
        const options = authenticationSessionOptions();
        expect(options.expiresIn.as('days')).toBe(30);
        expect(options.refreshExpiresIn.as('days')).toBe(30);
    });
});
