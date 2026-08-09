// An exempt request runs with no transaction, so it also runs without the org
// isolation GUC surviving past a single statement. Getting this set wrong is
// quiet in both directions: too broad and a route silently loses its RLS, too
// narrow and a hot public poll spends a pooled connection per call.

import { describe, expect, it } from 'vitest';

import { DEFAULT_TRANSACTION_EXEMPTIONS, isTransactionExempt, nowPlayingExemption } from '../../../src/server/middleware/transaction.exemptions.js';

const exempt = (method: string, path: string) => isTransactionExempt({ method, path }, DEFAULT_TRANSACTION_EXEMPTIONS);

describe('nowPlayingExemption', () => {
    it('exempts the public now-playing poll', () => {
        // It is served out of memory: the rundown holds what is on air and the
        // station name was pushed in at boot.
        expect(nowPlayingExemption({ method: 'GET', path: '/nowplaying' })).toBe(true);
        expect(exempt('GET', '/nowplaying')).toBe(true);
    });

    it('exempts nothing else that merely starts with the same path', () => {
        expect(exempt('GET', '/nowplaying/history')).toBe(false);
        expect(exempt('POST', '/nowplaying')).toBe(false);
    });

    it('leaves the operator transport alone', () => {
        // `/playout/status` reads the same rundown but is gated and sits with the
        // rest of the API's transactional routes.
        expect(exempt('GET', '/playout/status')).toBe(false);
    });
});
