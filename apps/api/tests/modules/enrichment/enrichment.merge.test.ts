// The host's merge policy, which is a different question from the one a plugin
// answers about its own contributions: here several plugins describe the same
// track and `priority` decides who is believed.

import { describe, expect, it } from 'vitest';

import { mergeEnrichment, sanitizeEnrichment } from '../../../src/modules/enrichment/enrichment.merge.js';

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

    it('drops anything that is not a field of an enrichment', () => {
        expect(sanitizeEnrichment({ artist: 'Portishead', __proto__: { polluted: true }, whatever: 'no' })).toEqual({ artist: 'Portishead' });
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

    it('is empty when nobody contributed', () => {
        expect(mergeEnrichment([])).toEqual({});
        expect(mergeEnrichment([{}, {}])).toEqual({});
    });
});
