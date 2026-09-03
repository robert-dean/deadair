// The table is the whole of what this file does, so what is worth pinning is its three arms rather
// than any one entry in it: a job the table knows, a request nothing in the table needs to know
// about, and a job it does not — which must still say SOMETHING, since a blank cell reads as broken
// rather than as "not translated yet".

import { describe, expect, it } from 'vitest';

import { describeDecision } from '../../../src/components/station/decision.words';

describe('describeDecision', () => {
    it('reads a registered job by its own sentence', () => {
        expect(describeDecision('schedule.tick')).toEqual({
            sentence: 'Checked whether the schedule changed',
            source: 'job',
        });
    });

    it('reads a request as itself, since it already names what it asked for', () => {
        expect(describeDecision('GET /voices')).toEqual({
            sentence: 'Request · GET /voices',
            source: 'request',
        });
    });

    // Every method the middleware actually mints one for, so a future job named after an HTTP verb
    // (there are none today) does not get mistaken for a request by this branch running first.
    it('recognises every method the console itself makes', () => {
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
            expect(describeDecision(`${method} /catalog`).source).toBe('request');
        }
    });

    it('still says something for a job this table has never heard of, rather than nothing', () => {
        expect(describeDecision('a.job.this.table.does.not.know')).toEqual({
            sentence: 'a job this table does not know',
            source: 'unknown',
        });
    });
});
