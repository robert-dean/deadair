// The floor under fact extraction, which is deterministic and therefore actually testable. The
// openings here are real ones, including the awkward shapes that cost a claim when they are missed:
// a pronunciation gloss, a parenthetical date, an abbreviation that ends in a full stop.

import { describe, expect, it } from 'vitest';

import { leadClaims, leadParagraph, MAX_CLAIM_CHARS, sentences, speakable, tidy } from '../../../src/modules/enrichment/fact.lead.js';

const RUSTY_CAGE = [
    '"Rusty Cage" is a song by the American rock band Soundgarden. Written by frontman Chris Cornell, "Rusty Cage" was released in 1992 as the third single from the band\'s third studio album, Badmotorfinger (1991).',
    '',
    'The song was covered by Johnny Cash in 1996 on his album Unchained.',
].join('\n');

describe('finding the lead', () => {
    it('takes the first real paragraph, which is the only part written as a summary', () => {
        expect(leadParagraph(RUSTY_CAGE)).toMatch(/^"Rusty Cage" is a song/);
        expect(leadParagraph(RUSTY_CAGE)).not.toContain('Johnny Cash');
    });

    it('steps over a section heading rather than stopping at one', () => {
        // A heading survives a plaintext extract as a short line of its own, and an article whose
        // extract opens with one still has a lead worth reading.
        expect(leadParagraph(`Overview\n\n${RUSTY_CAGE}`)).toMatch(/^"Rusty Cage" is a song/);
    });

    it('has nothing to say about an empty article', () => {
        expect(leadParagraph('')).toBe('');
        expect(leadParagraph('Stub.')).toBe('');
    });
});

describe('splitting sentences', () => {
    it('splits where a sentence really ends', () => {
        expect(sentences('One thing happened. Another thing happened.')).toEqual(['One thing happened.', 'Another thing happened.']);
    });

    it('does not split on an abbreviation, which would cut a claim in half', () => {
        // Half a sentence is worse than no sentence when the thing on the other end is a mouth.
        expect(sentences('Produced by Dr. Dre in 1992. It sold well.')).toEqual(['Produced by Dr. Dre in 1992.', 'It sold well.']);
        expect(sentences('Released as No. 4 on the label. It charted.')).toHaveLength(2);
    });

    it('does not split on a decimal or an initial', () => {
        expect(sentences('It ran to 4.5 minutes on the single.')).toEqual(['It ran to 4.5 minutes on the single.']);
        expect(sentences('Written by J. J. Cale for the album.')).toEqual(['Written by J. J. Cale for the album.']);
    });

    it('keeps a trailing fragment rather than dropping it', () => {
        expect(sentences('One thing. And then')).toEqual(['One thing.', 'And then']);
    });
});

describe('tidying a sentence', () => {
    it('drops the reference markers, which a voice engine reads out loud', () => {
        expect(tidy('It was released in 1992.[3] ')).toBe('It was released in 1992.');
        expect(tidy('It charted[citation needed] that year.')).toBe('It charted that year.');
    });

    it('drops a pronunciation gloss, which is phonetics in the middle of the clean sentence', () => {
        expect(tidy('Bjork (pronounced BYURK) released it in 1993.')).toBe('Bjork released it in 1993.');
    });

    // Every one of these is a span taken off a real stored article, and every one
    // of them was being spoken on air: the respelling key renders with no keyword
    // for the gloss pattern to find, so nine claims in the store held one.
    it('drops a respelling key that announces itself with nothing but its own shape', () => {
        expect(tidy('Lynyrd Skynyrd ( LEH-nerd SKIN-nerd) is an American rock band.')).toBe('Lynyrd Skynyrd is an American rock band.');
        expect(tidy('Slipknot ( SLIP-not) is an American heavy metal band.')).toBe('Slipknot is an American heavy metal band.');
        expect(tidy('Ænima ( AH-ni-mə) is the second studio album by Tool.')).toBe('Ænima is the second studio album by Tool.');
    });

    it('takes the whole parenthetical, because a respelling shares it with whatever else the lead crams in', () => {
        expect(tidy('Aretha Franklin ( ə-REE-thə; March 25, 1942 – August 16, 2018) was an American singer.')).toBe(
            'Aretha Franklin was an American singer.',
        );
        expect(tidy('Blue Öyster Cult ( OY-ster; sometimes abbreviated BÖC or BOC) is an American rock band.')).toBe(
            'Blue Öyster Cult is an American rock band.',
        );
    });

    it('leaves an ordinary parenthetical alone, because that is content', () => {
        expect(tidy('It appeared on Badmotorfinger (1991).')).toBe('It appeared on Badmotorfinger (1991).');
    });

    // The pattern is two signals and needs both. A parenthetical of prose opens on
    // a letter, and one that happens to open on a space is still not a respelling
    // unless what follows is letters and a stressed syllable.
    it('leaves a bare parenthetical alone when it is prose rather than a respelling', () => {
        expect(tidy('The band signed to Bad Boy Records ( an imprint of Arista) in 1996.')).toBe(
            'The band signed to Bad Boy Records ( an imprint of Arista) in 1996.',
        );
        expect(tidy('It reached the chart ( 12 weeks) that summer.')).toBe('It reached the chart ( 12 weeks) that summer.');
    });
});

describe('deciding whether a sentence can be said', () => {
    const long = `It is a song. ${'x'.repeat(MAX_CLAIM_CHARS)}`;

    it('refuses a fragment, which is a heading or a splitter mistake', () => {
        expect(speakable('Track listing.')).toBe(false);
    });

    it('refuses a paragraph that was never punctuated', () => {
        expect(speakable(long)).toBe(false);
    });

    it('refuses an unbalanced bracket, which means the text was mangled on the way here', () => {
        // Stripping a gloss out of the middle can orphan a bracket. The answer is to drop the claim,
        // not to patch it and hope.
        expect(speakable('It was released in 1992 (on A&M.')).toBe(false);
    });

    it('refuses a sentence cut off by the extract itself', () => {
        expect(speakable('It was released in 1992 and went on to become one of the most')).toBe(false);
    });

    it('accepts an ordinary opening sentence', () => {
        expect(speakable('"Rusty Cage" is a song by the American rock band Soundgarden.')).toBe(true);
    });
});

describe('the claims an article yields', () => {
    it('takes the opening sentences and quotes itself as the evidence', () => {
        const claims = leadClaims({ text: RUSTY_CAGE });

        expect(claims).toHaveLength(2);
        expect(claims[0]?.claim).toBe('"Rusty Cage" is a song by the American rock band Soundgarden.');
        expect(claims[1]?.claim).toContain('third single');
    });

    it('quotes the text as it appears in the document, not as it was tidied', () => {
        // The claim is what gets spoken; the quote has to be findable in the article a reader is
        // sent to, or the one rule holding this table up stops being true.
        const text = 'It was released as a single in 1992.[3] It sold two million copies worldwide.';
        const claims = leadClaims({ text });

        expect(claims[0]?.claim).toBe('It was released as a single in 1992.');
        expect(claims[0]?.sourceQuote).toBe('It was released as a single in 1992.[3]');
        // The rule the whole table rests on: a quote has to be findable in the document it cites.
        expect(text).toContain(claims[0]?.sourceQuote);
    });

    it('answers with nothing for an article too thin to have a lead', () => {
        expect(leadClaims({ text: 'A song.' })).toEqual([]);
        expect(leadClaims({ text: '' })).toEqual([]);
    });

    it('takes no more than it was asked for', () => {
        expect(leadClaims({ text: RUSTY_CAGE }, 1)).toHaveLength(1);
    });
});
