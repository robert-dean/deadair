import { describe, expect, it } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { mapRecording, selectRelease, tagNames, yearOf } from '../src/musicbrainz.mapping.js';
import type { MusicBrainzRecording } from '../src/musicbrainz.types.js';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy' };

const dummy: MusicBrainzRecording = {
    id: 'rec-1',
    title: 'Glory Box',
    length: 301_000,
    'first-release-date': '1994-08-22',
    'artist-credit': [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }],
    releases: [{ id: 'rel-1', title: 'Dummy', date: '1994-08-22', 'release-group': { 'primary-type': 'Album' } }],
    isrcs: ['GBAAA9400123'],
    genres: [
        { name: 'trip hop', count: 12 },
        { name: 'downtempo', count: 4 },
    ],
    tags: [{ name: 'bristol', count: 2 }],
};

describe('yearOf', () => {
    it('reads the year at every precision MusicBrainz publishes', () => {
        expect(yearOf('1994')).toBe(1994);
        expect(yearOf('1994-08')).toBe(1994);
        expect(yearOf('1994-08-22')).toBe(1994);
        expect(yearOf(undefined)).toBeUndefined();
        expect(yearOf('')).toBeUndefined();
    });
});

describe('tagNames', () => {
    it('orders by count and drops the ones voted down to zero', () => {
        expect(
            tagNames([
                { name: 'downtempo', count: 4 },
                { name: 'polka', count: 0 },
                { name: 'trip hop', count: 12 },
            ]),
        ).toEqual(['trip hop', 'downtempo']);
    });

    it('caps the list at something speakable', () => {
        const many = Array.from({ length: 9 }, (_, index) => ({ name: `genre-${index}`, count: 9 - index }));
        expect(tagNames(many)).toHaveLength(5);
    });
});

describe('selectRelease', () => {
    it('prefers the release the provider named', () => {
        const recording: MusicBrainzRecording = {
            releases: [
                { id: 'early', title: 'Glory Box', date: '1994-01-01' },
                { id: 'named', title: 'Dummy', date: '1997-01-01' },
            ],
        };
        expect(selectRelease(recording, ref)?.id).toBe('named');
    });

    it('falls back to the earliest album rather than an earlier compilation', () => {
        const recording: MusicBrainzRecording = {
            releases: [
                { id: 'comp', title: 'Trip Hop Classics', date: '1995-01-01', 'release-group': { 'primary-type': 'Compilation' } },
                { id: 'album', title: 'Dummy', date: '1996-01-01', 'release-group': { 'primary-type': 'Album' } },
            ],
        };
        expect(selectRelease(recording, { artist: 'Portishead', title: 'Glory Box' })?.id).toBe('album');
    });

    it('returns nothing when the recording carries no releases', () => {
        expect(selectRelease({ id: 'rec' }, ref)).toBeUndefined();
    });
});

describe('mapRecording', () => {
    it('maps everything one recording lookup can answer', () => {
        const enrichment = mapRecording(dummy, selectRelease(dummy, ref), ref);

        expect(enrichment).toMatchObject({
            artist: 'Portishead',
            title: 'Glory Box',
            album: 'Dummy',
            year: 1994,
            releaseDate: '1994-08-22',
            genres: ['trip hop', 'downtempo'],
            isrc: 'GBAAA9400123',
        });
        expect(enrichment.externalIds).toEqual([
            { source: 'musicbrainz', id: 'rec-1' },
            { source: 'musicbrainz-artist', id: 'art-1' },
            { source: 'musicbrainz-release', id: 'rel-1' },
        ]);
        expect(enrichment.links).toEqual([
            { label: 'MusicBrainz recording', url: 'https://musicbrainz.org/recording/rec-1' },
            { label: 'MusicBrainz artist', url: 'https://musicbrainz.org/artist/art-1' },
        ]);
    });

    it('never claims a field MusicBrainz has no opinion about', () => {
        const enrichment = mapRecording(dummy, selectRelease(dummy, ref), ref);
        expect(enrichment.biography).toBeUndefined();
        expect(enrichment.bpm).toBeUndefined();
        expect(enrichment.musicalKey).toBeUndefined();
        expect(enrichment.moods).toBeUndefined();
    });

    it('falls back to tags when the recording has no curated genres', () => {
        const enrichment = mapRecording({ ...dummy, genres: undefined }, undefined, ref);
        expect(enrichment.genres).toEqual(['bristol']);
    });

    it('echoes the reference ISRC when MusicBrainz lists none', () => {
        const enrichment = mapRecording({ ...dummy, isrcs: undefined }, undefined, { ...ref, isrc: 'GBAAA0000001' });
        expect(enrichment.isrc).toBe('GBAAA0000001');
    });

    it('omits the fields it could not resolve rather than emptying them', () => {
        const enrichment = mapRecording({ id: 'bare' }, undefined, ref);
        expect(Object.keys(enrichment).sort()).toEqual(['externalIds', 'links', 'providerRef']);
    });

    it('stays JSON-safe, because the payload crosses the plugin boundary', () => {
        const enrichment = mapRecording(dummy, selectRelease(dummy, ref), ref);
        expect(structuredClone(enrichment)).toEqual(enrichment);
        expect(JSON.parse(JSON.stringify(enrichment))).toEqual(enrichment);
    });
});
