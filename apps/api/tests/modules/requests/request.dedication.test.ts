// A listener's dedication is stored and handed to a writer, so it is tidied first: nothing a screen
// or a log would show differently from what was typed, and nothing longer than the contract allows.

import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE, dedicationOf } from '../../../src/modules/requests/request.dedication.js';

describe('dedicationOf', () => {
    it('takes out control, zero-width and bidi-override characters', () => {
        expect(dedicationOf('Da​ni‮elle', 'happy\u0007 birthday')).toEqual({ to: 'Da ni elle', message: 'happy birthday' });
    });

    it('holds the message to its length', () => {
        expect(dedicationOf(undefined, 'x'.repeat(MAX_MESSAGE + 50))?.message).toHaveLength(MAX_MESSAGE);
    });

    it('is nothing when both parts are empty', () => {
        expect(dedicationOf('  ', '​')).toBeUndefined();
    });
});
