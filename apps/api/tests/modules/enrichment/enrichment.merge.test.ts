// The host's merge policy, which is a different question from the one a plugin
// answers about its own contributions: here several plugins describe the same
// track and `priority` decides who is believed.

import { describe, expect, it } from 'vitest';

import {
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
