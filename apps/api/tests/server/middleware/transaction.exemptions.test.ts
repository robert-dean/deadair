// An exempt request runs with no transaction, so it gives up atomicity with
// anything it enqueues and its `AfterCommit` work runs when the handler returns
// rather than when a commit lands. Getting this set wrong is quiet in both
// directions: too broad and a route silently loses those guarantees, too narrow
// and a hot public poll spends a pooled connection per call.

import { describe, expect, it } from 'vitest';

import {
    artExemption,
    DEFAULT_TRANSACTION_EXEMPTIONS,
    infraExemption,
    isTransactionExempt,
    nowPlayingExemption,
} from '../../../src/server/middleware/transaction.exemptions.js';

const exempt = (method: string, path: string) => isTransactionExempt({ method, path }, DEFAULT_TRANSACTION_EXEMPTIONS);

describe('infraExemption', () => {
    it('exempts both spellings of the liveness probe', () => {
        // The API serves both, so both have to be exempt: a probe on a short interval
        // spending a pooled connection is the cost this list exists to avoid.
        expect(infraExemption({ method: 'GET', path: '/health' })).toBe(true);
        expect(infraExemption({ method: 'GET', path: '/healthcheck' })).toBe(true);
        expect(exempt('GET', '/health')).toBe(true);
        expect(exempt('GET', '/healthcheck')).toBe(true);
    });

    it('exempts nothing else that merely starts with the same path', () => {
        expect(exempt('GET', '/health/deep')).toBe(false);
    });
});

describe('artExemption', () => {
    it('exempts a cached cover', () => {
        // One row read and then bytes off the art store: nothing to be atomic WITH, and a pooled
        // connection held until the last byte is on the socket. The console asks for one of these
        // per row of the running order at once.
        expect(artExemption({ method: 'GET', path: '/art/2071d88a-998f-4c12-8515-b2ea9c54f245' })).toBe(true);
        expect(exempt('GET', '/art/2071d88a-998f-4c12-8515-b2ea9c54f245')).toBe(true);
    });

    it('exempts nothing else that merely starts with the same word', () => {
        // The trailing slash in the prefix is the whole guard. No `/artists` or `/artwork` route
        // exists today — artists are under `/catalog/artists` — which is exactly why this is worth
        // pinning: the day one is added, a prefix written without the slash would silently take its
        // transaction away, and an exemption is quiet in both directions.
        expect(exempt('GET', '/artists')).toBe(false);
        expect(exempt('GET', '/artwork/2071d88a-998f-4c12-8515-b2ea9c54f245')).toBe(false);
        expect(exempt('GET', '/art')).toBe(false);
    });

    it('exempts only the read', () => {
        // The exemption is about not pinning a connection to push bytes. Anything that WRITES art
        // is an ordinary transactional route and must stay one.
        expect(exempt('POST', '/art/2071d88a-998f-4c12-8515-b2ea9c54f245')).toBe(false);
        expect(exempt('DELETE', '/art/2071d88a-998f-4c12-8515-b2ea9c54f245')).toBe(false);
    });
});

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
