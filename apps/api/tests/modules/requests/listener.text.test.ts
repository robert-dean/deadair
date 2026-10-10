// Listener text is tidied the same way on every path, and a name is screened before the station says
// it. What is pinned: nothing invisible survives (and a zero-width character joins rather than splits
// a word), a clamp never halves a character, and a name that is not a name, or that passes for one of
// the station's own, is refused rather than repaired.

import { describe, expect, it } from 'vitest';

import { nameSkeleton, screenName, tidyListenerText } from '../../../src/modules/requests/listener.text.js';

describe('tidyListenerText', () => {
    it('deletes format characters, so a zero-width space or a bidi override inside a name leaves the name', () => {
        expect(tidyListenerText('Da​ni‮elle', 60)).toBe('Danielle');
    });

    it('turns control characters into a space and collapses the runs', () => {
        expect(tidyListenerText('  happy\u0007birthday\n\n  Sam\t', 60)).toBe('happy birthday Sam');
    });

    it('folds fullwidth and stylised letters to the letters they look like', () => {
        expect(tidyListenerText('Ｓａｍ', 60)).toBe('Sam');
        expect(tidyListenerText('\u{1D412}\u{1D41A}\u{1D426}', 60)).toBe('Sam');
    });

    it('clamps by code points, never splitting a surrogate pair', () => {
        const clamped = tidyListenerText('ab\u{1F600}\u{1F600}', 3);
        expect(clamped).toBe('ab\u{1F600}');
        // No lone surrogate: a high one not followed by a low one, or a low one not preceded by a high one.
        expect(clamped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    it('is nothing when nothing printable is left, and nothing for nothing', () => {
        expect(tidyListenerText(' ​\u0007 ', 60)).toBeUndefined();
        expect(tidyListenerText(undefined, 60)).toBeUndefined();
    });
});

describe('nameSkeleton', () => {
    it('takes out accents and case, and keeps letters only, a space between words', () => {
        expect(nameSkeleton('  Zoë-Ánn  O’Brien ')).toBe('zoe ann o brien');
    });

    it('folds Cyrillic and Greek look-alikes to the Latin letter they pass for', () => {
        // Cyrillic М, а, х; then Greek Μ, Α, Χ.
        expect(nameSkeleton('Мах')).toBe('max');
        expect(nameSkeleton('ΜΑΧ')).toBe('max');
    });
});

describe('screenName', () => {
    const reserved = ['Max Riley', 'Deadair', 'Night Owl'];

    it('passes an ordinary name, tidied', () => {
        expect(screenName('  Sam​ ', reserved)).toBe('Sam');
        expect(screenName('Mary-Jane O’Neill', reserved)).toBe('Mary-Jane O’Neill');
    });

    it('refuses a name with no letters in it', () => {
        expect(screenName('12345', reserved)).toBeUndefined();
        expect(screenName('\u{1F389}\u{1F389}', reserved)).toBeUndefined();
        expect(screenName('​', reserved)).toBeUndefined();
    });

    it('refuses a sentence typed into the name box rather than cutting it short', () => {
        expect(screenName('this is definitely not a name at all', reserved)).toBeUndefined();
        expect(screenName('x'.repeat(41), reserved)).toBeUndefined();
        expect(screenName('x'.repeat(40), reserved)).toBe('x'.repeat(40));
    });

    it('refuses an address or a handle', () => {
        expect(screenName('example.com', reserved)).toBeUndefined();
        expect(screenName('https://x', reserved)).toBeUndefined();
        expect(screenName('@someone', reserved)).toBeUndefined();
        expect(screenName('St. John', reserved)).toBe('St. John');
    });

    it('refuses a name that contains one of the station’s own, as whole words', () => {
        expect(screenName('Max Riley', reserved)).toBeUndefined();
        expect(screenName('the real max riley', reserved)).toBeUndefined();
        expect(screenName('DEADAIR', reserved)).toBeUndefined();
        expect(screenName('Dead Air', reserved)).toBeUndefined();
    });

    it('sees through zero-width characters, accents and look-alike letters', () => {
        expect(screenName('Max​ Riley', reserved)).toBeUndefined();
        expect(screenName('Máx Rïley', reserved)).toBeUndefined();
        expect(screenName('Мах Riley', reserved)).toBeUndefined();
    });

    it('lets a name through that only shares letters with one of the station’s, not words', () => {
        expect(screenName('Maxine Riley', reserved)).toBe('Maxine Riley');
        expect(screenName('Owlish', reserved)).toBe('Owlish');
    });

    it('ignores a reserved name with no letters, which could otherwise match everything', () => {
        expect(screenName('Sam', ['', '  ', '123'])).toBe('Sam');
    });
});
