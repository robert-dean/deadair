// The host's merge policy, which is a different question from the one a plugin
// answers about its own contributions: here several plugins describe the same
// track and `priority` decides who is believed.

import { describe, expect, it } from 'vitest';

import {
    forTheWire,
    mergeAlbumEnrichment,
    mergeArtistEnrichment,
    mergeEnrichment,
    sanitizeAlbumEnrichment,
    sanitizeArtistEnrichment,
    sanitizeEnrichment,
} from '../../../src/modules/enrichment/enrichment.merge.js';

describe('sanitizeEnrichment', () => {
    it('keeps the fields the host understands, in the types they were promised in', () => {
        expect(
            sanitizeEnrichment({
                artist: 'Portishead',
                year: 1994,
                genres: ['trip hop'],
                links: [{ label: 'MusicBrainz', url: 'https://musicbrainz.org/recording/rec-1' }],
                externalIds: [{ source: 'musicbrainz', id: 'rec-1' }],
            }),
        ).toEqual({
            artist: 'Portishead',
            year: 1994,
            genres: ['trip hop'],
            links: [{ label: 'MusicBrainz', url: 'https://musicbrainz.org/recording/rec-1' }],
            externalIds: [{ source: 'musicbrainz', id: 'rec-1' }],
        });
    });

    it('drops a field of the wrong type instead of coercing it', () => {
        expect(sanitizeEnrichment({ artist: 42, year: 'nineteen ninety four', genres: 'trip hop' })).toEqual({});
    });

    it('keeps a field the host has no name for, rather than dropping what a plugin knows', () => {
        expect(sanitizeEnrichment({ artist: 'Portishead', listeners: 412_000, pressing: { country: 'UK', matrix: 'GO!BEAT 3' } })).toEqual({
            artist: 'Portishead',
            extra: { listeners: 412_000, pressing: { country: 'UK', matrix: 'GO!BEAT 3' } },
        });
    });

    it('folds a plugin that filled `extra` itself into the same place', () => {
        expect(sanitizeEnrichment({ extra: { listeners: 1 }, pressing: 'UK' }).extra).toEqual({ listeners: 1, pressing: 'UK' });
    });

    it('refuses a value that would not survive the trip to jsonb', () => {
        const dropped: string[] = [];
        const enrichment = sanitizeEnrichment(
            { artist: 'Portishead', fetchedAt: new Date(), depth: { a: { b: { c: { d: { e: { f: 1 } } } } } } },
            reason => dropped.push(reason),
        );

        expect(enrichment).toEqual({ artist: 'Portishead' });
        expect(dropped).toHaveLength(2);
    });

    it('refuses an oversized extra whole rather than storing half of it', () => {
        const dropped: string[] = [];
        const enrichment = sanitizeEnrichment({ artist: 'Portishead', dump: 'x'.repeat(20_000) }, reason => dropped.push(reason));

        expect(enrichment).toEqual({ artist: 'Portishead' });
        expect(dropped[0]).toContain('exceed');
    });

    it('never lets a key from an upstream reach the prototype', () => {
        const raw = JSON.parse('{"artist":"Portishead","__proto__":{"polluted":true}}') as unknown;
        const enrichment = sanitizeEnrichment(raw);

        expect(enrichment).toEqual({ artist: 'Portishead' });
        expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('refuses a link the console would render as something clickable', () => {
        const enrichment = sanitizeEnrichment({
            links: [
                { label: 'Bad', url: 'javascript:alert(1)' },
                { label: 'Also bad', url: 'not a url' },
                { label: 'Good', url: 'https://example.test/' },
            ],
        });
        expect(enrichment.links).toEqual([{ label: 'Good', url: 'https://example.test/' }]);
    });

    it('trims and drops the empty strings an upstream pads its fields with', () => {
        expect(sanitizeEnrichment({ artist: '  Portishead  ', album: '   ' })).toEqual({ artist: 'Portishead' });
    });

    it('caps a runaway string and a runaway list', () => {
        const enrichment = sanitizeEnrichment({
            artist: 'x'.repeat(5_000),
            genres: Array.from({ length: 200 }, (_, index) => `genre-${index}`),
        });
        expect(enrichment.artist).toHaveLength(2_000);
        expect(enrichment.genres).toHaveLength(50);
    });

    it('has nothing to say about something that is not an object', () => {
        expect(sanitizeEnrichment(undefined)).toEqual({});
        expect(sanitizeEnrichment('nope')).toEqual({});
        expect(sanitizeEnrichment([{ artist: 'Portishead' }])).toEqual({});
    });
});

describe('providerRef', () => {
    it('survives sanitizing as a known field rather than falling into extra', () => {
        // It used to land in `extra`, where nothing read it, which is why the host
        // was left inferring the ref from `externalIds` instead.
        expect(sanitizeEnrichment({ providerRef: 'mb-1', artist: 'Portishead' })).toEqual({ providerRef: 'mb-1', artist: 'Portishead' });
        expect(sanitizeArtistEnrichment({ providerRef: 'mb-1' })).toEqual({ providerRef: 'mb-1' });
        expect(sanitizeAlbumEnrichment({ providerRef: 'rg-1' })).toEqual({ providerRef: 'rg-1' });
    });

    it('is capped like an identifier rather than like prose', () => {
        expect(sanitizeEnrichment({ providerRef: 'x'.repeat(500) }).providerRef).toHaveLength(200);
    });

    it('never reaches the merged view, whichever plugin said it', () => {
        // One source's private id for this thing. The merged view is promoted onto
        // canonical rows and read as a single answer, so carrying a ref there would
        // attribute the first plugin's id to everybody.
        expect(mergeEnrichment([{ providerRef: 'mb-1', artist: 'Portishead' }, { providerRef: 'local-42' }])).toEqual({ artist: 'Portishead' });
        expect(mergeArtistEnrichment([{ providerRef: 'mb-1', name: 'Portishead' }])).toEqual({ name: 'Portishead' });
        expect(mergeAlbumEnrichment([{ providerRef: 'rg-1', name: 'Dummy' }])).toEqual({ name: 'Dummy' });
    });
});

describe('source documents', () => {
    const article = {
        url: 'https://en.wikipedia.org/wiki/Glory_Box',
        title: 'Glory Box',
        text: 'Glory Box is a song by the English band Portishead.',
        retrievedAt: '2026-08-15T09:00:00.000Z',
    };

    it('survives sanitizing on all three levels, since prose is a fact about any of them', () => {
        expect(sanitizeEnrichment({ documents: [article] }).documents).toEqual([article]);
        expect(sanitizeArtistEnrichment({ documents: [article] }).documents).toEqual([article]);
        expect(sanitizeAlbumEnrichment({ documents: [article] }).documents).toEqual([article]);
    });

    it('drops an entry that is missing any part of itself, rather than storing half of one', () => {
        // Each of the four is load-bearing: no url is a claim nobody can check, no text is nothing
        // to extract from, and a document with neither title nor timestamp cannot be reported.
        for (const missing of ['url', 'title', 'text', 'retrievedAt']) {
            expect(sanitizeEnrichment({ documents: [{ ...article, [missing]: undefined }] }).documents).toBeUndefined();
        }
    });

    it('refuses a url that is not http(s), because this one becomes a citation', () => {
        expect(sanitizeEnrichment({ documents: [{ ...article, url: 'javascript:alert(1)' }] }).documents).toBeUndefined();
        expect(sanitizeEnrichment({ documents: [{ ...article, url: 'not a url' }] }).documents).toBeUndefined();
    });

    it('refuses a retrievedAt that is not a date, and keeps the string rather than converting it', () => {
        expect(sanitizeEnrichment({ documents: [{ ...article, retrievedAt: 'last tuesday' }] }).documents).toBeUndefined();
        expect(sanitizeEnrichment({ documents: [article] }).documents?.[0]?.retrievedAt).toBe(article.retrievedAt);
    });

    it('trims a very long article rather than refusing it, since the long ones carry the trivia', () => {
        const long = sanitizeEnrichment({ documents: [{ ...article, text: 'x'.repeat(100_000) }] });

        expect(long.documents?.[0]?.text).toHaveLength(60_000);
    });

    it('caps how many one plugin may contribute about one thing', () => {
        const many = sanitizeEnrichment({ documents: Array.from({ length: 9 }, (_, at) => ({ ...article, url: `${article.url}?${at}` })) });

        expect(many.documents).toHaveLength(4);
    });

    it('accumulates across plugins and deduplicates by url, the way links do', () => {
        const other = { ...article, url: 'https://en.wikipedia.org/wiki/Dummy_(album)' };

        expect(mergeEnrichment([{ documents: [article] }, { documents: [article, other] }]).documents).toEqual([article, other]);
    });

    it('is stored and then deliberately not sent, because nothing on the wire renders an article', () => {
        const stored = sanitizeEnrichment({ artist: 'Portishead', providerRef: 'mb-1', documents: [article] });

        expect(forTheWire(stored)).toEqual({ artist: 'Portishead' });
    });
});

describe('the artist spec', () => {
    it('keeps what belongs to an artist and treats a track field as just another unnamed one', () => {
        expect(sanitizeArtistEnrichment({ name: 'Portishead', biography: 'Bristol.', bpm: 90 })).toEqual({
            name: 'Portishead',
            biography: 'Bristol.',
            extra: { bpm: 90 },
        });
    });

    it('applies the same link and cap rules as a track does', () => {
        const enrichment = sanitizeArtistEnrichment({
            links: [{ label: 'Bad', url: 'javascript:alert(1)' }],
            facts: Array.from({ length: 200 }, (_, index) => `fact-${index}`),
        });

        expect(enrichment.links).toBeUndefined();
        expect(enrichment.facts).toHaveLength(50);
    });

    it('accumulates artist lists and gives a scalar to the first plugin that knew it', () => {
        expect(mergeArtistEnrichment([{ facts: ['a'] }, { facts: ['b'], name: 'Portishead' }])).toEqual({
            facts: ['a', 'b'],
            name: 'Portishead',
        });
    });
});

describe('the album spec', () => {
    it('keeps what belongs to a record and treats the rest as unnamed', () => {
        expect(sanitizeAlbumEnrichment({ name: 'Dummy', artist: 'Portishead', year: 1994, label: 'Go! Beat', bpm: 90 })).toEqual({
            name: 'Dummy',
            artist: 'Portishead',
            year: 1994,
            label: 'Go! Beat',
            extra: { bpm: 90 },
        });
    });
});

describe('mergeEnrichment', () => {
    it('gives a scalar to the first plugin that had an opinion', () => {
        expect(mergeEnrichment([{ artist: 'Portishead' }, { artist: 'PORTISHEAD' }]).artist).toBe('Portishead');
    });

    it('lets a later plugin fill in what the earlier one never knew', () => {
        expect(mergeEnrichment([{ artist: 'Portishead' }, { bpm: 90 }])).toEqual({ artist: 'Portishead', bpm: 90 });
    });

    it('accumulates the lists, because two sources naming different genres is more knowledge', () => {
        expect(mergeEnrichment([{ genres: ['trip hop'] }, { genres: ['downtempo'] }]).genres).toEqual(['trip hop', 'downtempo']);
    });

    it('keeps one entry per link, per external id and per genre', () => {
        const merged = mergeEnrichment([
            { genres: ['Trip Hop'], links: [{ label: 'A', url: 'https://example.test/' }], externalIds: [{ source: 'musicbrainz', id: 'rec-1' }] },
            { genres: ['trip hop'], links: [{ label: 'B', url: 'https://example.test/' }], externalIds: [{ source: 'musicbrainz', id: 'rec-1' }] },
        ]);

        expect(merged.genres).toEqual(['Trip Hop']);
        expect(merged.links).toEqual([{ label: 'A', url: 'https://example.test/' }]);
        expect(merged.externalIds).toHaveLength(1);
    });

    it('leaves `extra` out of the view that gets promoted and read as one answer', () => {
        expect(mergeEnrichment([{ artist: 'Portishead', extra: { listeners: 1 } }, { extra: { listeners: 2 } }])).toEqual({ artist: 'Portishead' });
    });

    it('is empty when nobody contributed', () => {
        expect(mergeEnrichment([])).toEqual({});
        expect(mergeEnrichment([{}, {}])).toEqual({});
    });
});
