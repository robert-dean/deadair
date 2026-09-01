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
    personaDraftExemption,
    personaRehearsalExemption,
    speechPreviewExemption,
    voiceSampleExemption,
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

describe('personaDraftExemption', () => {
    it('exempts drafting a persona', () => {
        // It writes nothing and hands the model's answer back for the operator to save
        // through the ordinary create route, so the transaction bought no atomicity and
        // cost a pooled connection held for a whole generation.
        expect(personaDraftExemption({ method: 'POST', path: '/personas/generate' })).toBe(true);
        expect(exempt('POST', '/personas/generate')).toBe(true);
    });

    it('leaves every persona route that writes alone', () => {
        // The saving routes are what the drafted persona is saved THROUGH, so their
        // transaction is doing the job it exists for.
        expect(exempt('POST', '/personas')).toBe(false);
        expect(exempt('POST', '/personas/import')).toBe(false);
        expect(exempt('PUT', '/personas/some-persona')).toBe(false);
    });

    it('exempts nothing else that merely starts with the same path', () => {
        expect(exempt('GET', '/personas/generate')).toBe(false);
        expect(exempt('POST', '/personas/generate/again')).toBe(false);
    });
});

describe('personaRehearsalExemption', () => {
    it('exempts hearing a persona, whichever one it is', () => {
        // It writes nothing, and the service is built so that it cannot: it holds the
        // reading halves of the notebook and the stories and never the writing ones.
        expect(personaRehearsalExemption({ method: 'POST', path: '/personas/some-persona/rehearse' })).toBe(true);
        expect(exempt('POST', '/personas/2071d88a-998f-4c12-8515-b2ea9c54f245/rehearse')).toBe(true);
    });

    it('leaves the notes and stories routes under the same prefix alone', () => {
        // Both write, and neither holds the model while it does.
        expect(exempt('POST', '/personas/some-persona/notes')).toBe(false);
        expect(exempt('POST', '/personas/some-persona/stories')).toBe(false);
    });

    it('exempts nothing else that merely ends the same way', () => {
        expect(exempt('GET', '/personas/some-persona/rehearse')).toBe(false);
        expect(exempt('POST', '/rehearse')).toBe(false);
    });
});

describe('voiceSampleExemption', () => {
    it('exempts both spellings of a voice sample', () => {
        // The default voice and a named one are one method serving two routes, and
        // `/voices/sample` ends with `/sample` as surely as `/voices/{id}/sample` does.
        expect(voiceSampleExemption({ method: 'GET', path: '/voices/sample' })).toBe(true);
        expect(voiceSampleExemption({ method: 'GET', path: '/voices/af_heart/sample' })).toBe(true);
        expect(exempt('GET', '/voices/sample')).toBe(true);
        expect(exempt('GET', '/voices/af_heart/sample')).toBe(true);
    });

    it('leaves the voice list itself alone', () => {
        // One plugin call and no engine time, so it is an ordinary transactional route.
        expect(exempt('GET', '/voices')).toBe(false);
    });
});

describe('speechPreviewExemption', () => {
    it('exempts speaking the operator’s own words', () => {
        // Same store, same engine, same argument as the samples above: the bytes land on
        // disk, which no transaction was ever going to roll back.
        expect(speechPreviewExemption({ method: 'POST', path: '/voices/preview' })).toBe(true);
        expect(exempt('POST', '/voices/preview')).toBe(true);
    });

    it('exempts nothing else that merely starts with the same path', () => {
        expect(exempt('GET', '/voices/preview')).toBe(false);
        expect(exempt('POST', '/voices/preview/again')).toBe(false);
    });
});
