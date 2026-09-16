import { describe, expect, it } from 'vitest';

import { packParts, sentencesIn } from '#modules/render/pack.parts.js';

/** Parts as a caller hands them over: one per paragraph. */
const parts = (...texts: string[]) => texts.map(text => ({ text }));

/** Every packed call is within the ceiling, which is the one property that must never fail. */
const within = (packed: readonly string[], ceiling: number): boolean => packed.every(call => call.length <= ceiling);

describe('packParts', () => {
    it('puts several short paragraphs into one call', () => {
        const packed = packParts(parts('One.', 'Two.', 'Three.'), 100);

        expect(packed).toEqual(['One.\n\nTwo.\n\nThree.']);
    });

    // A blank line is what the parts MEAN, and an engine reads it as the pause a paragraph gets.
    // Joined with a space they pack identically and read as one undivided passage.
    it('keeps the paragraph break between them rather than running them together', () => {
        expect(packParts(parts('One.', 'Two.'), 100)[0]).toBe('One.\n\nTwo.');
    });

    it('starts a new call rather than going over the ceiling', () => {
        const packed = packParts(parts('a'.repeat(30), 'b'.repeat(30)), 50);

        expect(packed).toHaveLength(2);
        expect(within(packed, 50)).toBe(true);
    });

    it('drops an empty paragraph instead of packing a silence nobody asked for', () => {
        expect(packParts(parts('One.', '   ', '', 'Two.'), 100)).toEqual(['One.\n\nTwo.']);
    });

    it('answers nothing at all for text that is entirely blank', () => {
        // Not one empty call: a caller has to be able to tell "nothing to say" from "say nothing",
        // because the first is a piece it should decline and the second is a render that produces
        // an empty file.
        expect(packParts(parts('', '   ', '\n'), 100)).toEqual([]);
    });

    it('answers nothing for no parts at all', () => {
        expect(packParts([], 100)).toEqual([]);
    });
});

describe('packParts cutting something too long to say at once', () => {
    it('cuts a long paragraph at its sentence boundaries', () => {
        const packed = packParts(parts('One sentence here. Two sentence here. Three sentence here.'), 40);

        expect(within(packed, 40)).toBe(true);
        // Every call begins a sentence and ends one: no call starts mid-clause, which is the whole
        // reason this is not a cut every N characters.
        for (const call of packed) expect(call).toMatch(/^[A-Z].*\.$/);
    });

    it('loses none of the words', () => {
        const prose = 'Alpha beta gamma. Delta epsilon zeta. Eta theta iota. Kappa lambda mu. Nu xi omicron.';
        const packed = packParts(parts(prose), 30);

        expect(within(packed, 30)).toBe(true);
        expect(packed.join(' ').split(/\s+/)).toEqual(prose.split(/\s+/));
    });

    it('falls back to word boundaries for a sentence longer than the whole ceiling', () => {
        const sentence = `${'word '.repeat(40).trim()}.`;
        const packed = packParts(parts(sentence), 50);

        expect(within(packed, 50)).toBe(true);
        // Cut between words, never through one.
        for (const call of packed) expect(call).not.toMatch(/^\s|\s$/);
        expect(packed.join(' ')).toBe(sentence);
    });

    it('cuts a single token longer than the ceiling rather than losing the piece over it', () => {
        // A URL, or a run of a corrupt file. Refusing here would cost the listener the chapter.
        const packed = packParts(parts(`x${'y'.repeat(120)}`), 40);

        expect(within(packed, 40)).toBe(true);
        expect(packed.join('')).toBe(`x${'y'.repeat(120)}`);
    });

    it('terminates on a nonsense ceiling instead of packing nothing forever', () => {
        for (const ceiling of [0, -5, 0.5]) {
            const packed = packParts(parts('Some words here.'), ceiling);
            expect(packed.length).toBeGreaterThan(0);
            expect(within(packed, 1)).toBe(true);
        }
    });

    it('keeps a long paragraph off the end of the one before it', () => {
        // The paragraph boundary in front of something that has to be cut is the one place a seam
        // was going to be anyway, so it is spent there rather than inside the prose.
        const packed = packParts(parts('Short.', `${'Long sentence here. '.repeat(10).trim()}`), 60);

        expect(packed[0]).toBe('Short.');
        expect(within(packed, 60)).toBe(true);
    });
});

describe('sentencesIn', () => {
    it('keeps a decimal inside its sentence', () => {
        // The period that is not a full stop, which is what the segmenter buys over the fallback:
        // the regex cuts after `$3.` and starts a "sentence" at `50 for it`.
        expect(sentencesIn('He paid $3.50 for it. Then he left.', 'en')).toEqual(['He paid $3.50 for it.', 'Then he left.']);
    });

    it('splits after an abbreviation, which neither splitter knows about', () => {
        // Recorded rather than fixed: `Intl.Segmenter` has no abbreviation dictionary, so `Dr.` is
        // its own sentence. It costs nothing in practice because `packParts` packs a one-word run
        // straight back onto its neighbour, unless the ceiling happens to fall exactly between them.
        expect(sentencesIn('Dr. Frankenstein went north.', 'en')).toEqual(['Dr.', 'Frankenstein went north.']);
        expect(packParts([{ text: 'Dr. Frankenstein went north.' }], 100)).toEqual(['Dr. Frankenstein went north.']);
    });

    it('reads a locale tag it has never heard of as no locale rather than failing', () => {
        // A plugin passes through whatever a file declared, and an unknown tag must cost a worse
        // cut rather than the piece.
        expect(sentencesIn('One. Two.', 'not-a-locale-at-all')).toHaveLength(2);
    });

    it('answers nothing for blank text', () => {
        expect(sentencesIn('   ')).toEqual([]);
    });
});
