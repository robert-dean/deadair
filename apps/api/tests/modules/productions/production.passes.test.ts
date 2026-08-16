// The pass chain, which is the operator's choice of how much of the model's time a production is
// worth. It is a table rather than branches, so what is worth testing is that the chain walks it
// correctly at the edges — the last pass, and a mode changed under a production already being made.

import { describe, expect, it } from 'vitest';

import { firstPass, isWritingMode, nextPass, PASSES, runsPass, WRITING_MODES } from '../../../src/modules/productions/production.passes.js';

describe('PASSES', () => {
    it('gives every mode at least one pass, so firstPass can never fail', () => {
        for (const mode of WRITING_MODES) expect(PASSES[mode].length).toBeGreaterThan(0);
    });

    it('ends every mode with a draft or a check, never with an outline', () => {
        // An outline with nothing after it is a production that planned a programme and wrote none
        // of it.
        for (const mode of WRITING_MODES) expect(PASSES[mode].at(-1)).not.toBe('outline');
    });

    it('spends more on each mode than the one before it', () => {
        expect(PASSES.quick.length).toBeLessThan(PASSES.outlined.length);
        expect(PASSES.outlined.length).toBeLessThan(PASSES.polished.length);
    });

    // The check is arithmetic rather than a model judging its own draft, so `polished` costs a second
    // model call only for the beats that actually failed something.
    it('never adds a model pass to judge the work, only the deterministic check', () => {
        expect(PASSES.polished).toEqual(['outline', 'draft', 'check']);
    });
});

describe('nextPass', () => {
    it('walks the chain in order', () => {
        expect(nextPass('polished', 'outline')).toBe('draft');
        expect(nextPass('polished', 'draft')).toBe('check');
    });

    it('answers nothing after the last pass, which is how the chain stops', () => {
        expect(nextPass('polished', 'check')).toBeUndefined();
        expect(nextPass('outlined', 'draft')).toBeUndefined();
        expect(nextPass('quick', 'draft')).toBeUndefined();
    });

    // Happens when an operator changes the mode under a production that is already being made.
    // Stopping is the honest outcome: the passes that ran ran, and the alternative is guessing where
    // a production sits in a chain it was never started on.
    it('answers nothing for a pass this mode does not run', () => {
        expect(nextPass('quick', 'outline')).toBeUndefined();
        expect(nextPass('outlined', 'check')).toBeUndefined();
    });
});

describe('firstPass', () => {
    it('starts a quick production at the draft, because it plans no content', () => {
        expect(firstPass('quick')).toBe('draft');
    });

    it('starts the other two at the outline, which is what makes them a programme', () => {
        expect(firstPass('outlined')).toBe('outline');
        expect(firstPass('polished')).toBe('outline');
    });
});

describe('runsPass', () => {
    it('says whether a mode wants this pass at all', () => {
        expect(runsPass('quick', 'draft')).toBe(true);
        expect(runsPass('quick', 'outline')).toBe(false);
        expect(runsPass('polished', 'check')).toBe(true);
        expect(runsPass('outlined', 'check')).toBe(false);
    });
});

describe('isWritingMode', () => {
    it('accepts the modes the station can run', () => {
        for (const mode of WRITING_MODES) expect(isWritingMode(mode)).toBe(true);
    });

    it('refuses anything else, so a hand-edited row cannot reach the chain', () => {
        expect(isWritingMode('thorough')).toBe(false);
        expect(isWritingMode('')).toBe(false);
        expect(isWritingMode('QUICK')).toBe(false);
    });
});
