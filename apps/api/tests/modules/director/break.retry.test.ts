// Which refusals are worth a second generation, and which are the floor's business.
//
// The line is not about how bad the answer was: it is about whether the model can act on what it is
// told. A rule it was given and broke is one sentence away from a fix; a break about neither of the
// records it was shown means the model misread the substrate, and asking again invites it to invent
// something that fits. See the note at the top of `break.retry.ts` for the measurement.

import { describe, expect, it } from 'vitest';

import { RETRYABLE_FAULTS, retryNudge, worthRetrying } from '../../../src/modules/director/break.retry.js';
import type { WriteFault } from '../../../src/modules/director/break.prompt.js';

describe('worthRetrying', () => {
    it('asks again about a rule the model was given and broke', () => {
        for (const fault of ['out-of-character', 'avoided-wording', 'spent-catchphrase', 'quoted-sample', 'wrong-daypart'] as WriteFault[]) {
            expect(worthRetrying(fault), fault).toBe(true);
        }
    });

    it('asks again about an empty answer, which is the cheapest failure there is to fix', () => {
        expect(worthRetrying('nothing-said')).toBe(true);
    });

    it('leaves the substrate faults to the floor', () => {
        // A model that wrote about neither record, put one on the wrong side, or stated a year
        // nobody gave it has misunderstood what it was handed rather than how to say it.
        for (const fault of ['named-nothing', 'cued-wrong', 'invented-year'] as WriteFault[]) {
            expect(worthRetrying(fault), fault).toBe(false);
        }
    });

    it('leaves a run-long break alone, because the trim already answered it', () => {
        expect(worthRetrying('ran-long')).toBe(false);
    });

    it('answers nothing for a write that named no fault at all', () => {
        expect(worthRetrying(undefined)).toBe(false);
    });
});

describe('retryNudge', () => {
    it('has something to say about every fault it claims to retry, or the ask is wasted', () => {
        for (const fault of RETRYABLE_FAULTS) {
            expect(retryNudge({ fault, reason: 'because' }), fault).toBeTruthy();
        }
    });

    it('says nothing for a fault it does not retry, so a caller cannot smuggle one through', () => {
        expect(retryNudge({ fault: 'named-nothing', reason: 'because' })).toBeUndefined();
    });

    it('quotes the refused answer under a label rather than trailing it bare', () => {
        const nudge = retryNudge({ fault: 'out-of-character', reason: 'because', refused: 'It was fine, actually.' });

        expect(nudge).toContain('It was fine, actually.');
        expect(nudge).toMatch(/which the station refused/i);
    });

    it('drops the quote when there was nothing to quote', () => {
        const nudge = retryNudge({ fault: 'nothing-said', reason: 'because', refused: '   ' });

        expect(nudge).not.toMatch(/which the station refused/i);
    });
});
