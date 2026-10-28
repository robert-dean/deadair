// A model's reason, made safe to keep under a line in the as-run log.

import { describe, expect, it } from 'vitest';

import { PICK_REASON_MAX, pickReason } from '../../../src/modules/director/pick.reason.js';

describe('pickReason', () => {
    it('keeps one sentence as it was written', () => {
        expect(pickReason('The brief asked for something slower here.')).toBe('The brief asked for something slower here.');
    });

    it('folds line breaks, tabs and control characters into single spaces', () => {
        expect(pickReason('  A slow\n\tone,\u0007 to breathe.  ')).toBe('A slow one, to breathe.');
    });

    it('cuts a long reason on a word, with an ellipsis, rather than refusing it', () => {
        const long = 'word '.repeat(60);
        const cut = pickReason(long)!;

        expect(cut.length).toBeLessThanOrEqual(PICK_REASON_MAX);
        expect(cut.endsWith('word…')).toBe(true);
    });

    it('answers nothing for anything that is not text, or is empty', () => {
        for (const value of [undefined, null, 4, {}, ['a'], '', '   \n ']) expect(pickReason(value), JSON.stringify(value)).toBeUndefined();
    });
});
