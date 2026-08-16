import { describe, expect, it } from 'vitest';
import { decodeEntities, firstSentence, plainText, truncateSentences, truncateWords } from '../src/html.text.js';

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

describe('truncateWords', () => {
    it('cuts on a word boundary and marks it', () => {
        expect(truncateWords('The council voted to reopen the crossing this morning', 20)).toBe('The council voted…');
    });
});
