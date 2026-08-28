// The three mappings, pinned against saved responses with no host in the way.
// Each engine names almost every field differently and agrees on nothing but the
// shape, so what these guard is the translation: what becomes a title, what
// becomes a snippet, what is dropped, and the one thing all three parsers refuse
// to carry — somebody else's synthesized answer.

import { describe, expect, it } from 'vitest';

import { parseBraveResponse } from '../src/brave.provider.js';
import { parseSearxngResponse } from '../src/searxng.provider.js';
import { parseTavilyResponse } from '../src/tavily.provider.js';
import { SNIPPET_MAX_CHARS } from '../src/websearch.results.js';

describe('parseSearxngResponse', () => {
    const body = {
        query: 'portishead',
        results: [
            {
                title: 'Portishead',
                content: 'A band from Bristol.',
                url: 'https://www.example.com/portishead',
                publishedDate: '2026-08-01T00:00:00.000Z',
            },
            { title: 'Dummy', content: 'Their first record.', url: 'https://records.example.org/dummy' },
        ],
        infoboxes: [{ content: 'Portishead are an English band formed in 1991.' }],
    };

    it('reads the results in the order the instance gave them', () => {
        expect(parseSearxngResponse(body, 10).map(result => result.title)).toEqual(['Portishead', 'Dummy']);
    });

    it('keeps the content as the snippet and the published date as an instant', () => {
        const [first] = parseSearxngResponse(body, 10);

        expect(first?.snippet).toBe('A band from Bristol.');
        expect(first?.publishedAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('stands the hostname in for a publisher, since the shape carries no name', () => {
        expect(parseSearxngResponse(body, 10)[0]?.site).toBe('example.com');
    });

    it('leaves the date off a result that carried none', () => {
        expect(parseSearxngResponse(body, 10)[1]?.publishedAt).toBeUndefined();
    });

    it('does not carry the infobox, which is an answer nothing can check', () => {
        const serialized = JSON.stringify(parseSearxngResponse(body, 10));

        expect(serialized).not.toContain('formed in 1991');
    });

    it('cuts to the limit', () => {
        expect(parseSearxngResponse(body, 1)).toHaveLength(1);
    });

    it('answers with nothing for a shape it does not recognise, rather than throwing', () => {
        expect(parseSearxngResponse({ error: 'no' }, 10)).toEqual([]);
        expect(parseSearxngResponse('not json at all', 10)).toEqual([]);
        expect(parseSearxngResponse(undefined, 10)).toEqual([]);
    });
});

describe('parseBraveResponse', () => {
    const body = {
        infobox: { results: [{ long_desc: 'Portishead are an English band formed in 1991.' }] },
        news: {
            results: [
                {
                    title: 'Band announce dates',
                    description: 'The <strong>band</strong> will play three nights &amp; a matinee.',
                    url: 'https://www.theexample.com/news/dates',
                    profile: { name: 'The Example' },
                    page_age: '2026-08-20T09:00:00Z',
                    age: '8 days ago',
                },
            ],
        },
        web: {
            results: [{ title: 'Portishead', description: 'A band from Bristol.', url: 'https://example.org/portishead' }],
        },
    };

    it('leads with the news and fills in behind it with the web', () => {
        expect(parseBraveResponse(body, 10).map(result => result.title)).toEqual(['Band announce dates', 'Portishead']);
    });

    it('strips the highlighting and decodes the entities out of a snippet', () => {
        expect(parseBraveResponse(body, 10)[0]?.snippet).toBe('The band will play three nights & a matinee.');
    });

    it("takes the profile's own name for the publisher over the hostname", () => {
        expect(parseBraveResponse(body, 10)[0]?.site).toBe('The Example');
    });

    it('reads page_age as the date and never the phrase beside it', () => {
        const [first] = parseBraveResponse(body, 10);

        expect(first?.publishedAt).toBe('2026-08-20T09:00:00.000Z');
        expect(JSON.stringify(first)).not.toContain('8 days ago');
    });

    it('does not carry the infobox description, which is an answer nothing can check', () => {
        expect(JSON.stringify(parseBraveResponse(body, 10))).not.toContain('formed in 1991');
    });

    it('answers with nothing for a shape it does not recognise, rather than throwing', () => {
        expect(parseBraveResponse({ web: 'unexpected' }, 10)).toEqual([]);
        expect(parseBraveResponse(null, 10)).toEqual([]);
    });
});

describe('parseTavilyResponse', () => {
    const body = {
        answer: 'Portishead are an English band formed in 1991.',
        results: [
            {
                title: 'Portishead',
                content: 'A band from Bristol.',
                url: 'https://www.example.com/portishead',
                score: 0.98,
                published_date: 'Mon, 01 Aug 2026 00:00:00 GMT',
            },
        ],
    };

    it('reads the passage as the snippet', () => {
        expect(parseTavilyResponse(body, 10)[0]?.snippet).toBe('A band from Bristol.');
    });

    it('normalises whatever date format arrived into an instant', () => {
        expect(parseTavilyResponse(body, 10)[0]?.publishedAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('does not carry the answer, even though the request asked for none', () => {
        expect(JSON.stringify(parseTavilyResponse(body, 10))).not.toContain('formed in 1991');
    });

    it('answers with nothing for a shape it does not recognise, rather than throwing', () => {
        expect(parseTavilyResponse({ detail: 'unauthorized' }, 10)).toEqual([]);
    });
});

describe('what every parser refuses', () => {
    const withResults = (...results: unknown[]): unknown => ({ results });

    it('drops a hit with no title, since a model has nothing to read', () => {
        expect(parseSearxngResponse(withResults({ content: 'words', url: 'https://example.com/a' }), 10)).toEqual([]);
    });

    it('drops a hit with no address, since nothing could cite or de-duplicate it', () => {
        expect(parseSearxngResponse(withResults({ title: 'Somewhere', content: 'words' }), 10)).toEqual([]);
    });

    it('drops a hit whose address is not one anything could fetch', () => {
        expect(parseSearxngResponse(withResults({ title: 'Nope', url: 'javascript:alert(1)' }), 10)).toEqual([]);
    });

    it('keeps a hit with no snippet, because a title and an address are still a page', () => {
        const results = parseSearxngResponse(withResults({ title: 'Bare', url: 'https://example.com/bare' }), 10);

        expect(results).toHaveLength(1);
        expect(results[0]?.snippet).toBe('');
    });

    it('bounds a snippet that ran long', () => {
        const long = `${'word '.repeat(400)}end`;
        const [result] = parseSearxngResponse(withResults({ title: 'Long', content: long, url: 'https://example.com/long' }), 10);

        expect(result?.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 1);
    });

    it('drops a date it cannot parse rather than inventing one', () => {
        const [result] = parseSearxngResponse(withResults({ title: 'Undated', url: 'https://example.com/u', publishedDate: 'last Tuesday-ish' }), 10);

        expect(result?.publishedAt).toBeUndefined();
    });
});
