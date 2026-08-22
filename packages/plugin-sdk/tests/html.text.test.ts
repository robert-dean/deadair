import { describe, expect, it } from 'vitest';
import { decodeEntities, firstSentence, plainText, sentencesWithin, truncateSentences, truncateWords } from '../src/html.text.js';

describe('plainText', () => {
    it('takes the tags out and the entities down', () => {
        expect(plainText('<p>The crossing reopened <b>this morning</b> &amp; traffic is moving.</p>')).toBe(
            'The crossing reopened this morning & traffic is moving.',
        );
    });

    it('decodes the typography a publisher actually writes', () => {
        expect(plainText('It &rsquo;s here &mdash; and &hellip; gone')).toBe('It ’s here — and … gone');
    });

    // The decode runs after the strip, so an escaped tag inside CDATA cannot be turned into a real
    // one and then survive.
    it('never lets an escaped tag become a tag', () => {
        expect(plainText('a &lt;script&gt;alert(1)&lt;/script&gt; b')).toBe('a <script>alert(1)</script> b');
    });

    it('answers with nothing for markup that carried no words', () => {
        expect(plainText('<div><img src="x"/></div>')).toBeUndefined();
        expect(plainText('   ')).toBeUndefined();
    });

    it('leaves an entity it does not know exactly as the publisher wrote it', () => {
        expect(plainText('Caf&eacute; owners')).toBe('Caf&eacute; owners');
    });
});

describe('decodeEntities', () => {
    it('reads numeric escapes in both bases', () => {
        expect(decodeEntities('&#8217;&#x2014;')).toBe('’—');
    });

    it('leaves an out-of-range escape alone rather than throwing', () => {
        expect(decodeEntities('&#1114112;')).toBe('&#1114112;');
    });
});

/**
 * Where a sentence ends is not a question about full stops, and getting it wrong was measured on
 * air rather than reasoned about: a bulletin read "Saturday, Aug." and stopped.
 */
describe('firstSentence', () => {
    it('ends at the first real terminator', () => {
        expect(firstSentence('The storm weakened on Sunday. Rain continued into the evening.')).toBe('The storm weakened on Sunday.');
    });

    it('does not end at a date', () => {
        expect(firstSentence('A view of the bridge in Hilo, Saturday, Aug. 15, 2026. Elsewhere, the rain eased.')).toBe(
            'A view of the bridge in Hilo, Saturday, Aug. 15, 2026.',
        );
    });

    it('does not end at a title, even though a capitalised name follows it', () => {
        expect(firstSentence('Gov. Green declared an emergency. Crews worked overnight.')).toBe('Gov. Green declared an emergency.');
    });

    it('does not end at a decimal', () => {
        expect(firstSentence('Rainfall reached 3.5 feet overnight. Rivers rose.')).toBe('Rainfall reached 3.5 feet overnight.');
    });

    it('takes an unterminated passage whole', () => {
        expect(firstSentence('A single line with no full stop on it')).toBe('A single line with no full stop on it');
    });

    it('keeps a closing quote with the sentence it belongs to', () => {
        expect(firstSentence('"We are not done," she said. The council adjourned.')).toBe('"We are not done," she said.');
    });
});

describe('truncateSentences', () => {
    it('leaves anything inside the cap alone', () => {
        expect(truncateSentences('Short enough.', 100)).toBe('Short enough.');
    });

    it('cuts at the last whole sentence that fits', () => {
        const text = 'One sentence here. Two sentences here. Three sentences here.';

        expect(truncateSentences(text, 40)).toBe('One sentence here. Two sentences here.');
    });

    // A hard stop mid-clause is worse than a long quote, but a model handed half a sentence
    // finishes it out of its own head, so the fallback is still a marked truncation.
    it('falls back to a word cut when the first sentence is already over the cap', () => {
        expect(truncateSentences('A single very long sentence that runs well past the limit it was given', 30)).toMatch(/…$/);
    });

    it('does not cut at a date inside the window', () => {
        const text = 'Filed Saturday, Aug. 15, 2026, from Hilo, where the river rose overnight. A second sentence follows.';

        expect(truncateSentences(text, 80)).toBe('Filed Saturday, Aug. 15, 2026, from Hilo, where the river rose overnight.');
    });
});

/**
 * The cut a station makes on its own words rather than on a publisher's, so the fallback is nothing
 * at all: the caller is choosing between this script and a sentence it wrote itself.
 */
describe('sentencesWithin', () => {
    it('leaves anything inside the count alone', () => {
        expect(sentencesWithin('Four words, near enough.', 40)).toBe('Four words, near enough.');
    });

    it('keeps whole sentences and drops the rest', () => {
        const text = 'The record still holds up. The single after it did not. Make of that what you will.';

        expect(sentencesWithin(text, 14)).toBe('The record still holds up. The single after it did not.');
    });

    // The case the ceiling's original comment describes, and the only one still worth declining: a
    // cut here could only be mid-clause, which is the one thing a voice must not read.
    it('answers with nothing when the first sentence is already over', () => {
        expect(sentencesWithin('A single sentence that runs a good deal longer than it was ever given room for', 8)).toBeUndefined();
    });

    // Measured on a captured break: the naive split left the closing quote at the head of the half
    // that was thrown away, so the station would have aired an unbalanced one.
    it('keeps a closing quote with the sentence it ends', () => {
        const text = 'A guitar lesson masquerading as “love.” The track reminds me of a tired choir. Ambitious in name only.';

        expect(sentencesWithin(text, 12)).toBe('A guitar lesson masquerading as “love.”');
    });

    it('does not cut at an abbreviation or a decimal', () => {
        const text = 'It sat at 3.5 million copies by Aug. 15, 2026, which nobody expected. The follow-up sold nothing.';

        expect(sentencesWithin(text, 15)).toBe('It sat at 3.5 million copies by Aug. 15, 2026, which nobody expected.');
    });
});

describe('truncateWords', () => {
    it('cuts on a word boundary and marks it', () => {
        expect(truncateWords('The council voted to reopen the crossing this morning', 20)).toBe('The council voted…');
    });
});
