// Reading a production's sources for the notes it may state as fact. The property that matters is the
// one `fact.model.ts` is built on: a claim is kept only when the words that state it are really in the
// source, because a model that invents a fact almost always invents the quote with it.

import { describe, expect, it } from 'vitest';

import { chunksOf, gather, MAX_CHUNKS_PER_SOURCE, readNotes, researchPrompt } from '../../../src/modules/productions/production.research.js';

const SOURCE = 'The TR-808 came out in 1980. Roland stopped making it in 1983, after about 12,000 had been built.';

describe('readNotes', () => {
    it('keeps a claim whose quote is in the source', () => {
        const answer = JSON.stringify({ facts: [{ claim: 'The TR-808 was released in 1980.', quote: 'The TR-808 came out in 1980.' }] });

        expect(readNotes(answer, SOURCE)).toEqual(['The TR-808 was released in 1980.']);
    });

    it('drops a claim whose quote the model invented', () => {
        const answer = JSON.stringify({
            facts: [
                { claim: 'It was designed in Tokyo.', quote: 'The TR-808 was designed in Tokyo.' },
                { claim: 'Production ended in 1983.', quote: 'Roland stopped making it in 1983' },
            ],
        });

        expect(readNotes(answer, SOURCE)).toEqual(['Production ended in 1983.']);
    });

    it('reads an answer however a local model wrapped it, and nothing from one that is not JSON', () => {
        const fenced =
            '```json\n' + JSON.stringify({ facts: [{ claim: 'About 12,000 were built.', quote: 'after about 12,000 had been built' }] }) + '\n```';

        expect(readNotes(fenced, SOURCE)).toEqual(['About 12,000 were built.']);
        expect(readNotes('I could not find anything.', SOURCE)).toEqual([]);
    });
});

describe('chunksOf', () => {
    it('leaves a short source whole', () => {
        expect(chunksOf(SOURCE)).toEqual([SOURCE]);
    });

    it('cuts a long one at a sentence boundary, so no quote is split across two chunks', () => {
        const sentence = 'This is a sentence about the machine. ';
        const chunks = chunksOf(sentence.repeat(10), 100);

        for (const chunk of chunks) expect(chunk.endsWith('.')).toBe(true);
    });

    it('reads no more than the most chunks a source is allowed', () => {
        expect(chunksOf('A sentence. '.repeat(10_000))).toHaveLength(MAX_CHUNKS_PER_SOURCE);
    });

    it('is nothing for an empty source', () => {
        expect(chunksOf('   ')).toEqual([]);
    });
});

describe('gather', () => {
    it('adds new notes, drops the ones already held whatever their case, and stops at the bound', () => {
        expect(gather(['One.'], ['one.', 'Two.', 'Three.'], 2)).toEqual(['One.', 'Two.']);
    });
});

describe('researchPrompt', () => {
    it('names the subject and the source, and asks for quotes copied exactly', () => {
        const [system, user] = researchPrompt({
            subject: 'the machine nobody wanted',
            source: { title: 'A history of the 808', url: 'https://example.com/808' },
            text: SOURCE,
        });

        expect(String(system?.content)).toContain('Copy them character for character');
        expect(String(user?.content)).toContain('The programme is about: the machine nobody wanted');
        expect(String(user?.content)).toContain('This is from "A history of the 808" (https://example.com/808).');
        expect(String(user?.content)).toContain(SOURCE);
    });
});
