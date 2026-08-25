// Two named sets over one vocabulary, and the failure they prevent: widening `SPEECH_CUES` for
// somebody on a telephone must not reach the person being paid to talk into a microphone.

import { describe, expect, it } from 'vitest';
import { SPEECH_CUES } from '@deadair/plugin-sdk';

import { CALLER_CUES, cuesFor } from '../../../src/modules/productions/production.cues.js';
import { PRESENTER_CUES } from '../../../src/modules/director/break.prompt.js';

const engine = SPEECH_CUES;

describe('who may perform what', () => {
    it('gives the presenter the four it always had', () => {
        expect(cuesFor('host', engine)).toEqual(['laugh', 'chuckle', 'sigh', 'gasp']);
    });

    it('never gives the presenter a cough, however capable the engine', () => {
        expect(cuesFor('host', engine)).not.toContain('cough');
        expect(cuesFor(undefined, engine)).not.toContain('cough');
    });

    it('gives a caller the wider set', () => {
        expect(cuesFor('caller', engine)).toEqual(CALLER_CUES);
        expect(cuesFor('caller', engine)).toContain('clear throat');
    });

    it('keeps everything the presenter has, so a caller is never offered LESS', () => {
        for (const cue of PRESENTER_CUES) expect(CALLER_CUES).toContain(cue);
    });

    it('is an intersection with the engine and not a wish', () => {
        // Both halves are vetoes. An engine that performs two things offers two things, whoever is
        // speaking, and one that performs none offers none.
        expect(cuesFor('caller', ['laugh', 'cough'])).toEqual(['laugh', 'cough']);
        expect(cuesFor('caller', [])).toEqual([]);
        expect(cuesFor('host', ['cough'])).toEqual([]);
    });

    it('names nothing the vocabulary does not have', () => {
        for (const cue of CALLER_CUES) expect(SPEECH_CUES).toContain(cue);
    });
});
