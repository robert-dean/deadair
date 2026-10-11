import { describe, expect, it } from 'vitest';

import { mapAlbumEnrichment, mapArtistEnrichment, mapTrackEnrichment, providerId } from '../src/jellyfin.enrichment.js';
import { selectAlbum, selectArtist, selectTrack } from '../src/jellyfin.match.js';

const RECORDING = 'ebce4b79-3a33-43b7-96c4-1eda0820c06e';
const TRACK_ID = '6715e4cf-f5ad-35e1-8aa4-c7180c64ee78';
const RELEASE = '2a506b3c-02a5-4274-beb5-278abf6c3ae9';
const RELEASE_GROUP = '760fa108-57ae-39b9-b5be-2f3b3c61d92b';
const ARTIST = 'bd496eba-155e-49ba-9a92-56e3fdfd1ea2';
const OTHER = '00000000-0000-0000-0000-000000000000';
const ID = '536ba60c06de566572687cc1cda4b787';

describe('providerId', () => {
    it('answers a well-formed MusicBrainz id, lowercased, and nothing else', () => {
        expect(providerId({ ProviderIds: { MusicBrainzRecording: RECORDING.toUpperCase() } }, 'MusicBrainzRecording')).toBe(RECORDING);
        expect(providerId({ ProviderIds: { MusicBrainzRecording: 'not-an-id' } }, 'MusicBrainzRecording')).toBeUndefined();
        expect(providerId({ ProviderIds: { MusicBrainzRecording: null } }, 'MusicBrainzRecording')).toBeUndefined();
        expect(providerId({}, 'MusicBrainzRecording')).toBeUndefined();
    });
});

describe('mapTrackEnrichment', () => {
    it('files the recording under the source the host promotes, and the release track apart from it', () => {
        expect(
            mapTrackEnrichment(
                {
                    Id: ID,
                    Type: 'Audio',
                    Name: 'Crimson Rider',
                    Artists: ['Masterplan'],
                    Album: 'Aeronautics',
                    ProductionYear: 2005,
                    PremiereDate: '2005-01-24T00:00:00.0000000Z',
                    Genres: ['Power Metal', 'power metal', ' '],
                    ProviderIds: { MusicBrainzRecording: RECORDING, MusicBrainzTrack: TRACK_ID, MusicBrainzAlbum: RELEASE },
                },
                'http://jf.test/art',
            ),
        ).toEqual({
            providerRef: ID,
            title: 'Crimson Rider',
            artist: 'Masterplan',
            album: 'Aeronautics',
            year: 2005,
            releaseDate: '2005-01-24',
            genres: ['Power Metal'],
            artworkUrl: 'http://jf.test/art',
            externalIds: [
                { source: 'jellyfin', id: ID },
                { source: 'musicbrainz', id: RECORDING },
                { source: 'musicbrainz-track', id: TRACK_ID },
            ],
        });
    });

    it('drops the placeholder date Jellyfin gives an untagged file', () => {
        expect(mapTrackEnrichment({ Id: ID, PremiereDate: '0001-01-01T00:00:00.0000000Z' }).releaseDate).toBeUndefined();
    });
});

describe('mapArtistEnrichment', () => {
    it('carries the biography, a picture and an artist id the host promotes', () => {
        expect(
            mapArtistEnrichment(
                { Id: ID, Name: 'Masterplan', Overview: 'German power metal.', ProviderIds: { MusicBrainzArtist: ARTIST } },
                'http://img',
            ),
        ).toEqual({
            providerRef: ID,
            name: 'Masterplan',
            biography: 'German power metal.',
            imageUrl: 'http://img',
            externalIds: [
                { source: 'jellyfin', id: ID },
                { source: 'musicbrainz-artist', id: ARTIST },
            ],
        });
    });
});

describe('mapAlbumEnrichment', () => {
    it('files the release group where the host promotes it, the release beside it, and the label when read', () => {
        const enrichment = mapAlbumEnrichment({
            Id: ID,
            Name: 'Aeronautics',
            AlbumArtist: 'Masterplan',
            ProductionYear: 2005,
            Studios: [{ Name: 'AFM Records' }],
            ProviderIds: { MusicBrainzReleaseGroup: RELEASE_GROUP, MusicBrainzAlbum: RELEASE },
        });

        expect(enrichment).toMatchObject({ name: 'Aeronautics', artist: 'Masterplan', year: 2005, label: 'AFM Records' });
        expect(enrichment.externalIds).toEqual([
            { source: 'jellyfin', id: ID },
            { source: 'musicbrainz-release-group', id: RELEASE_GROUP },
            { source: 'musicbrainz-release', id: RELEASE },
        ]);
    });
});

describe('selectTrack', () => {
    const track = (Id: string, Name: string, artist: string, extra: Record<string, unknown> = {}) => ({
        Id,
        Type: 'Audio',
        Name,
        Artists: [artist],
        ...extra,
    });

    it('needs the artist and the title both to agree, against any credited artist', () => {
        expect(selectTrack([track('1', 'Roads', 'Someone')], { artist: 'Portishead', title: 'Roads' })).toBeUndefined();
        expect(selectTrack([track('1', 'Roads', 'Guest', { AlbumArtist: 'Portishead' })], { artist: 'Portishead', title: 'Roads' })?.Id).toBe('1');
        expect(selectTrack([track('1', 'Mr. Brightside', 'The Killers')], { artist: 'The Killers', title: 'Mr Brightside' })?.Id).toBe('1');
    });

    it('lets a matching recording id outrank a better-named candidate, and rules out a different one', () => {
        const items = [
            track('1', 'Roads', 'Portishead', { ProviderIds: { MusicBrainzRecording: OTHER } }),
            track('2', 'Roads (Live)', 'Portishead', { ProviderIds: { MusicBrainzRecording: RECORDING } }),
        ];
        expect(selectTrack(items, { artist: 'Portishead', title: 'Roads', mbid: RECORDING })?.Id).toBe('2');
        expect(selectTrack(items.slice(0, 1), { artist: 'Portishead', title: 'Roads', mbid: RECORDING })).toBeUndefined();
    });

    it('breaks a tie on the album', () => {
        const items = [track('1', 'Roads', 'Portishead', { Album: 'Greatest Hits' }), track('2', 'Roads', 'Portishead', { Album: 'Dummy' })];
        expect(selectTrack(items, { artist: 'Portishead', title: 'Roads', album: 'Dummy' })?.Id).toBe('2');
    });
});

describe('selectArtist', () => {
    const artist = (Id: string, Name: string, mbid?: string) => ({
        Id,
        Type: 'MusicArtist',
        Name,
        ...(mbid ? { ProviderIds: { MusicBrainzArtist: mbid } } : {}),
    });

    it('takes the id over the name, refuses a namesake with another id, and refuses two it cannot tell apart', () => {
        expect(selectArtist([artist('1', 'Nirvana', OTHER), artist('2', 'Nirvana', ARTIST)], 'Nirvana', ARTIST)?.Id).toBe('2');
        expect(selectArtist([artist('1', 'Nirvana', OTHER)], 'Nirvana', ARTIST)).toBeUndefined();
        expect(selectArtist([artist('1', 'Nirvana'), artist('2', 'Nirvana')], 'Nirvana', undefined)).toBeUndefined();
        expect(selectArtist([artist('1', 'Nirvana')], 'nirvana', undefined)?.Id).toBe('1');
    });
});

describe('selectAlbum', () => {
    const album = (Id: string, Name: string, mbid?: string) => ({
        Id,
        Type: 'MusicAlbum',
        Name,
        ...(mbid ? { ProviderIds: { MusicBrainzReleaseGroup: mbid } } : {}),
    });

    it('matches the title decorations aside, exact first, and lets a release-group id settle it', () => {
        expect(selectAlbum([album('1', 'Dummy (Deluxe)'), album('2', 'Dummy')], 'Dummy', undefined)?.Id).toBe('2');
        expect(selectAlbum([album('1', 'Dummy (Deluxe)')], 'Dummy', undefined)?.Id).toBe('1');
        expect(selectAlbum([album('1', 'Something Else', RELEASE_GROUP)], 'Dummy', RELEASE_GROUP)?.Id).toBe('1');
        expect(selectAlbum([album('1', 'Dummy', OTHER)], 'Dummy', RELEASE_GROUP)).toBeUndefined();
    });
});
