import { describe, expect, it } from 'vitest';

import { mapAlbumEnrichment, mapArtistEnrichment, mapTrackEnrichment, releaseDate } from '../src/navidrome.enrichment.js';

describe('mapTrackEnrichment', () => {
    const song = {
        id: 'song-1',
        title: 'Roads',
        artist: 'Portishead',
        album: 'Dummy',
        year: 1994,
        genres: [{ name: 'trip hop' }, { name: 'downtempo' }],
    };

    it('reads what the file tags say', () => {
        expect(mapTrackEnrichment(song)).toMatchObject({
            title: 'Roads',
            artist: 'Portishead',
            album: 'Dummy',
            year: 1994,
            genres: ['trip hop', 'downtempo'],
        });
    });

    it('states its own id as the ref, even when the tags carry a foreign one', () => {
        // The exact case the host used to get wrong by reading `externalIds[0]`:
        // this plugin routinely knows a MusicBrainz id and should report it, and
        // doing so must not cost it its own ref.
        const enrichment = mapTrackEnrichment({ ...song, musicBrainzId: 'mb-recording-1' });

        expect(enrichment.providerRef).toBe('song-1');
        expect(enrichment.externalIds).toEqual([
            { source: 'navidrome', id: 'song-1' },
            { source: 'musicbrainz', id: 'mb-recording-1' },
        ]);
    });

    it('falls back to the legacy genre field for a server that sends only that', () => {
        expect(mapTrackEnrichment({ ...song, genres: undefined, genre: 'trip hop' }).genres).toEqual(['trip hop']);
    });

    it('treats an untagged year as unknown rather than as the year zero', () => {
        expect(mapTrackEnrichment({ ...song, year: 0 })).not.toHaveProperty('year');
    });

    it('has nothing to say about a song with no id', () => {
        expect(mapTrackEnrichment({ title: 'Roads' })).toEqual({});
    });
});

describe('mapArtistEnrichment', () => {
    const artist = { id: 'artist-1', name: 'Portishead' };

    it('reads the biography and the largest image the agents found', () => {
        const enrichment = mapArtistEnrichment(artist, {
            biography: 'Formed in Bristol in 1991.',
            smallImageUrl: 'http://small',
            largeImageUrl: 'http://large',
            lastFmUrl: 'https://last.fm/music/Portishead',
        });

        expect(enrichment).toMatchObject({
            providerRef: 'artist-1',
            name: 'Portishead',
            biography: 'Formed in Bristol in 1991.',
            imageUrl: 'http://large',
            links: [{ label: 'Last.fm', url: 'https://last.fm/music/Portishead' }],
        });
    });

    it('settles for a smaller image when there is no large one', () => {
        expect(mapArtistEnrichment(artist, { smallImageUrl: 'http://small' }).imageUrl).toBe('http://small');
    });

    it('says only what it knows when the agents found nothing', () => {
        // Navidrome fills these from external agents that may be off or offline.
        // A name and an id is a thin answer, not a failure.
        expect(mapArtistEnrichment(artist, {})).toEqual({
            providerRef: 'artist-1',
            name: 'Portishead',
            externalIds: [{ source: 'navidrome', id: 'artist-1' }],
        });
    });

    it('carries an mbid second, behind its own id', () => {
        expect(mapArtistEnrichment(artist, { musicBrainzId: 'mb-artist-1' }).externalIds).toEqual([
            { source: 'navidrome', id: 'artist-1' },
            { source: 'musicbrainz-artist', id: 'mb-artist-1' },
        ]);
    });
});

describe('mapAlbumEnrichment', () => {
    it('reads the record, and takes the artwork the caller minted', () => {
        const enrichment = mapAlbumEnrichment(
            {
                id: 'album-1',
                name: 'Dummy',
                artist: 'Portishead',
                year: 1994,
                genre: 'trip hop',
                originalReleaseDate: { year: 1994, month: 8, day: 22 },
                musicBrainzId: 'mb-rg-1',
            },
            'http://navidrome.test/art',
        );

        expect(enrichment).toEqual({
            providerRef: 'album-1',
            name: 'Dummy',
            artist: 'Portishead',
            year: 1994,
            releaseDate: '1994-08-22',
            genres: ['trip hop'],
            artworkUrl: 'http://navidrome.test/art',
            externalIds: [
                { source: 'navidrome', id: 'album-1' },
                { source: 'musicbrainz-release-group', id: 'mb-rg-1' },
            ],
        });
    });

    it('has nothing to say about a record that was not there', () => {
        expect(mapAlbumEnrichment(undefined)).toEqual({});
    });
});

describe('releaseDate', () => {
    it('keeps a partial date partial rather than inventing the missing parts', () => {
        // A record tagged with only a year is `1994`. Padding it to 1994-01-01
        // would be a claim the tags never made.
        expect(releaseDate({ year: 1994 })).toBe('1994');
        expect(releaseDate({ year: 1994, month: 8 })).toBe('1994-08');
        expect(releaseDate({ year: 1994, month: 8, day: 22 })).toBe('1994-08-22');
    });

    it('is nothing without a year', () => {
        expect(releaseDate({ month: 8, day: 22 })).toBeUndefined();
        expect(releaseDate(undefined)).toBeUndefined();
    });
});
