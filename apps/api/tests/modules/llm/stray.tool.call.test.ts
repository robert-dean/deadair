// The rescue for a tool call the model wrote as text. What is worth pinning is the BAR rather than
// the parsing: a false positive turns a station's real answer into a search and loses it, so every
// test here is either "this is unmistakably a call" or "this is close and must be left alone".

import { describe, expect, it } from 'vitest';

import type { StationTool } from '../../../src/modules/llm/llm.tools.js';
import { strayToolCall } from '../../../src/modules/llm/stray.tool.call.js';

const declare = (name: string, properties: Record<string, unknown>, required: string[] = []): StationTool => ({
    declaration: { name, description: `does ${name}`, parameters: { type: 'object', properties, required, additionalProperties: false } },
    freshness: 'timeless',
    run: async () => ({}),
});

/** The shape of what a refill is actually offered. */
const offered = new Map<string, StationTool>(
    [
        declare('search_music', { query: { type: 'string' }, yearFrom: { type: 'number' }, yearTo: { type: 'number' }, limit: { type: 'number' } }),
        declare('similar_artists', { artist: { type: 'string' }, limit: { type: 'number' } }, ['artist']),
        declare('station_taste', { limit: { type: 'number' } }),
    ].map(tool => [tool.declaration.name, tool]),
);

const read = (text: string) => strayToolCall(text, offered, 2);

describe('strayToolCall', () => {
    it('reads the arguments that cost a live refill as the call they were', () => {
        // Verbatim from a `artists like mitch murder` refill: the whole final message, which the
        // loop read as an answer and `readPicks` found no record in.
        expect(read('{"artist":"Mitch Murder","limit":12}')).toEqual({
            id: 'stray-2',
            name: 'similar_artists',
            arguments: { artist: 'Mitch Murder', limit: 12 },
        });
    });

    it('reads a named call, however the model spelled the two fields', () => {
        expect(read('{"name":"search_music","arguments":{"query":"lazerhawk"}}')).toEqual({
            id: 'stray-2',
            name: 'search_music',
            arguments: { query: 'lazerhawk' },
        });
        expect(read('{"tool":"search_music","parameters":{"query":"lazerhawk"}}')?.name).toBe('search_music');
        expect(read('{"function":"search_music","args":{"query":"lazerhawk"}}')?.name).toBe('search_music');
    });

    it('takes a named call with no arguments at its word, because several tools need none', () => {
        expect(read('{"name":"station_taste"}')).toEqual({ id: 'stray-2', name: 'station_taste', arguments: {} });
    });

    it('ignores a named call for a tool that is not on offer', () => {
        expect(read('{"name":"launch_the_missiles","arguments":{}}')).toBeUndefined();
    });

    it('takes what follows the thinking, like the pick reader does', () => {
        expect(read('<think>I should widen this</think>\n{"artist":"Mitch Murder"}')?.name).toBe('similar_artists');
    });

    it('leaves an answer alone when the arguments fit more than one tool', () => {
        // `{"limit":20}` fits `search_music` and `station_taste`. Guessing between them is how a
        // rescue starts inventing, and running the wrong search is worse than ending honestly.
        expect(read('{"limit":20}')).toBeUndefined();
    });

    it('refuses a bag of arguments missing what the tool requires', () => {
        // `limit` is one of `similar_artists`' two properties, and the artist is the entire tool.
        // Checked against a lone tool, because with several on offer the ambiguity rule above would
        // refuse this anyway and prove nothing about the required one.
        const lonely = new Map([['similar_artists', declare('similar_artists', { artist: {}, limit: {} }, ['artist'])]]);

        expect(strayToolCall('{"limit":5}', lonely, 0)).toBeUndefined();
        expect(strayToolCall('{"artist":"Mitch Murder"}', lonely, 0)?.name).toBe('similar_artists');
    });

    it('refuses an empty object, which fits everything that requires nothing', () => {
        expect(read('{}')).toBeUndefined();
    });

    it('never mistakes a record for a call, which is what keeps a one-record answer safe', () => {
        // `artist` is a `similar_artists` property; `title` is nobody's, and both directions are
        // checked precisely so this cannot resolve. This is the row shape `search_music` answers
        // with, so it is exactly what a set generator's one-record answer looks like.
        expect(read('{"title":"Prime Operator","artist":"Mitch Murder"}')).toBeUndefined();
    });

    it('leaves an ordinary answer alone', () => {
        expect(read('[{"title":"Prime Operator","artist":"Mitch Murder"}]')).toBeUndefined();
        expect(read('That was Mitch Murder, with Prime Operator.')).toBeUndefined();
        expect(read('')).toBeUndefined();
    });

    it('leaves an object with words around it alone, because the words are something said', () => {
        expect(read('Let me widen this: {"artist":"Mitch Murder","limit":12}')).toBeUndefined();
    });

    it('rescues nothing when no tools were on offer', () => {
        expect(strayToolCall('{"artist":"Mitch Murder","limit":12}', new Map(), 0)).toBeUndefined();
    });
});
