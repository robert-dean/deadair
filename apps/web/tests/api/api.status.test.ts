import { describe, expect, it } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { isConnectivityError } from '../../src/api/api.status';

function failure(status: number): SdkError {
    return new SdkError(status, 'Error', {}, new Headers());
}

describe('isConnectivityError', () => {
    it('treats a proxy with nothing behind it as unreachable', () => {
        // What nginx answers while the API restarts, which is the case this whole surface exists
        // for: the operator did not do anything wrong and the console should say so once.
        expect(isConnectivityError(failure(502))).toBe(true);
        expect(isConnectivityError(failure(503))).toBe(true);
        expect(isConnectivityError(failure(504))).toBe(true);
    });

    it('treats a rejection that never became a response as unreachable', () => {
        // `SdkError` is only constructed from a real `Response`, so an offline fetch arrives as a
        // raw TypeError and is the whole of the no-response case.
        expect(isConnectivityError(new TypeError('Failed to fetch'))).toBe(true);
        expect(isConnectivityError(new Error('NetworkError when attempting to fetch resource'))).toBe(true);
        expect(isConnectivityError(new Error('Load failed'))).toBe(true);
    });

    it('does not raise the banner for a server that answered', () => {
        // Each of these is the API alive and holding an opinion. Drawing "can't reach the station"
        // over a 401 would send the operator to check the network over a dead token.
        for (const status of [400, 401, 403, 404, 409, 422, 429]) {
            expect(isConnectivityError(failure(status))).toBe(false);
        }
    });

    it('leaves a plain 500 to the page that provoked it', () => {
        // The distinction the whole module turns on: 500 is the server running and throwing, which
        // is one page's problem, while 502 is nothing listening at all.
        expect(isConnectivityError(failure(500))).toBe(false);
        expect(isConnectivityError(failure(501))).toBe(false);
    });

    it('does not blame the network for a fault in the console', () => {
        // Issue #78: the SDK called `crypto.randomUUID` on a plain-HTTP page, where it does not
        // exist, and the TypeError that threw read as the whole station being down. `fetch`
        // rejecting is a TypeError too, so the class alone says nothing about which it was.
        expect(isConnectivityError(new TypeError('crypto.randomUUID is not a function'))).toBe(false);
        expect(isConnectivityError(new TypeError("Cannot read properties of undefined (reading 'digest')"))).toBe(false);
    });

    it('ignores anything that is not an error', () => {
        expect(isConnectivityError('offline')).toBe(false);
        expect(isConnectivityError(undefined)).toBe(false);
        expect(isConnectivityError({ status: 502 })).toBe(false);
    });
});
