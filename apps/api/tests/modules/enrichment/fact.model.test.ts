// What the station will accept back from a model. The prompts are pure, so what is tested here is
// the acceptance: which answers survive and, more to the point, which are dropped without comment.

import { describe, expect, it } from 'vitest';

import {
    describeSubject,
    extractPrompt,
    MAX_ARTICLE_CHARS,
    occurs,
    readable,
    readClaims,
    verified,
    verifyPrompt,
} from '../../../src/modules/enrichment/fact.model.js';

const ARTICLE = [
    '"Rusty Cage" is a song by the American rock band Soundgarden.',
    'Johnny Cash covered the song in 1996 for his album Unchained, produced by Rick Rubin.',
    'The song appeared in the 1994 film Ace Ventura: Pet Detective.',
].join(' ');

const answer = (facts: unknown): string => JSON.stringify({ facts });

describe('what the model is told', () => {
    it('names the subject at the level it is being asked about', () => {
        expect(describeSubject({ kind: 'song', name: 'Rusty Cage', artist: 'Soundgarden' })).toBe('the song "Rusty Cage" by Soundgarden');
        expect(describeSubject({ kind: 'record', name: 'Badmotorfinger', artist: 'Soundgarden' })).toBe('the record "Badmotorfinger" by Soundgarden');
        expect(describeSubject({ kind: 'artist', name: 'Soundgarden' })).toBe('the artist Soundgarden');
    });

    it('asks it to copy the words rather than to summarise them', () => {
        // The one instruction the whole design rests on: a paraphrase cannot be checked, and a model
        // asked for interesting sentences writes them whether or not the article said so.
        const system = extractPrompt({ kind: 'song', name: 'Rusty Cage' }, ARTICLE)[0]?.content ?? '';

        expect(system).toMatch(/character for character/i);
        expect(system).toMatch(/never add anything you know from elsewhere/i);
        expect(system).toMatch(/empty list/i);
    });

    it('offers only categories the column will accept', () => {
        const system = String(extractPrompt({ kind: 'song', name: 'Rusty Cage' }, ARTICLE)[0]?.content ?? '');

        expect(system).toContain('placement:');
        expect(system).toContain('cover_or_sample:');
        // `summary` is what the floor already writes, and asking for it again would spend a model on
        // the one sentence that needs none.
        expect(system).not.toContain('summary:');
    });

    it('tells the verifier nothing about music, so it answers a narrow question', () => {
        const [system, user] = verifyPrompt('It was in Ace Ventura.', 'The song appeared in the 1994 film Ace Ventura: Pet Detective.');

        expect(String(system?.content)).toMatch(/answer "no"/i);
        expect(String(system?.content)).toMatch(/unsure/i);
        expect(String(user?.content)).not.toMatch(/radio|station|record/i);
    });
});

describe('cutting an article to what will be read', () => {
    it('leaves a short one alone', () => {
        expect(readable(ARTICLE)).toBe(ARTICLE);
    });

    it('cuts a long one at a sentence, never mid-clause', () => {
        // What follows is a quote the model is about to copy, and half a sentence at the end is a
        // quote that can be copied faithfully and will never be found in the real article.
        const long = `${'Something happened in 1992. '.repeat(400)}`;
        const cut = readable(long, 1_000);

        expect(cut.length).toBeLessThanOrEqual(1_000);
        expect(cut.endsWith('.')).toBe(true);
    });

    it('has a default well inside what a local model will read attentively', () => {
        expect(MAX_ARTICLE_CHARS).toBeLessThan(20_000);
    });
});

describe('a quote against its article', () => {
    it('accepts an exact span', () => {
        expect(occurs('Johnny Cash covered the song in 1996', ARTICLE)).toBe(true);
    });

    it('accepts the punctuation a model straightens on the way past', () => {
        expect(occurs('"Rusty Cage" is a song', '“Rusty Cage” is a song by Soundgarden.')).toBe(true);
        expect(occurs('the band’s third album', "the band's third album")).toBe(true);
        expect(occurs('a song\nby the American rock band', 'a song by the American rock band Soundgarden.')).toBe(true);
    });

    it('refuses a paraphrase, which is the thing it exists to catch', () => {
        expect(occurs('Johnny Cash recorded a version in 1996', ARTICLE)).toBe(false);
        expect(occurs('', ARTICLE)).toBe(false);
    });
});

describe('reading a model answer', () => {
    it('takes claims whose quotes are really in the article', () => {
        const claims = readClaims(
            answer([
                {
                    claim: 'It was used in Ace Ventura.',
                    quote: 'The song appeared in the 1994 film Ace Ventura: Pet Detective.',
                    category: 'placement',
                },
            ]),
            ARTICLE,
        );

        expect(claims).toEqual([
            {
                claim: 'It was used in Ace Ventura.',
                quote: 'The song appeared in the 1994 film Ace Ventura: Pet Detective.',
                category: 'placement',
            },
        ]);
    });

    it('drops a claim whose quote is nowhere in the article', () => {
        // A model that invented the fact almost always invents the quote with it, which makes this
        // the cheapest lie detector available and the reason the quote is demanded at all.
        const claims = readClaims(
            answer([{ claim: 'It was banned by the BBC.', quote: 'The BBC banned the song in 1992.', category: 'controversy' }]),
            ARTICLE,
        );

        expect(claims).toEqual([]);
    });

    it('drops a claim with no quote at all', () => {
        expect(readClaims(answer([{ claim: 'It is a good song.' }]), ARTICLE)).toEqual([]);
    });

    it('reads through the fencing and the preamble a local model wraps its JSON in', () => {
        const wrapped = `Sure, here you go:\n\`\`\`json\n${answer([{ claim: 'Rick Rubin produced the cover.', quote: 'produced by Rick Rubin', category: 'recording' }])}\n\`\`\``;

        expect(readClaims(wrapped, ARTICLE)).toHaveLength(1);
    });

    it('answers with nothing for a refusal or for nonsense, rather than throwing', () => {
        // Both are ordinary. The document keeps no mark, so it is simply read again another day.
        expect(readClaims('I cannot help with that.', ARTICLE)).toEqual([]);
        expect(readClaims('{"facts": not json}', ARTICLE)).toEqual([]);
        expect(readClaims('', ARTICLE)).toEqual([]);
    });

    it('falls back to summary for a category it made up', () => {
        const claims = readClaims(
            answer([{ claim: 'Johnny Cash covered it.', quote: 'Johnny Cash covered the song in 1996', category: 'vibes' }]),
            ARTICLE,
        );

        expect(claims[0]?.category).toBe('summary');
    });

    it('keeps one of a claim repeated', () => {
        const twice = answer([
            { claim: 'Johnny Cash covered it.', quote: 'Johnny Cash covered the song in 1996', category: 'cover_or_sample' },
            { claim: 'johnny cash covered it.', quote: 'Johnny Cash covered the song in 1996', category: 'cover_or_sample' },
        ]);

        expect(readClaims(twice, ARTICLE)).toHaveLength(1);
    });

    it('takes no more than it was asked for', () => {
        const many = answer(
            Array.from({ length: 9 }, (_, at) => ({ claim: `Fact number ${at}.`, quote: 'Johnny Cash covered the song in 1996', category: 'chart' })),
        );

        expect(readClaims(many, ARTICLE, 3)).toHaveLength(3);
    });
});

describe('the verifier answer', () => {
    it('accepts a yes, however it is dressed', () => {
        expect(verified('yes')).toBe(true);
        expect(verified(' Yes.')).toBe(true);
        expect(verified('"yes"')).toBe(true);
    });

    it('treats everything else as a no, including nothing at all', () => {
        // The tie has to break towards dropping: a lost fact costs a sentence, a kept false one
        // costs the station's credibility on air.
        expect(verified('no')).toBe(false);
        expect(verified('Not exactly — the text implies it.')).toBe(false);
        expect(verified('')).toBe(false);
        expect(verified('yesterday the song charted')).toBe(false);
    });
});
