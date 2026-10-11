import { describe, expect, it } from 'vitest';

import { mapAlbumEnrichment, mapArtistEnrichment, mapTrackEnrichment, musicBrainzId } from '../src/plex.enrichment.js';
import { selectAlbum, selectArtist, selectTrack } from '../src/plex.match.js';

const MBID = '6715e4cf-f5ad-35e1-8aa4-c7180c64ee78';

describe('musicBrainzId', () => {
    it('reads the id out of an mbid:// GUID and ignores the others', () => {
        expect(musicBrainzId({ Guid: [{ id: 'plex://track/abc' }, { id: `mbid://${MBID.toUpperCase()}` }] })).toBe(MBID);
        expect(musicBrainzId({ Guid: [{ id: 'mbid://not-a-uuid' }] })).toBeUndefined();
        expect(musicBrainzId({})).toBeUndefined();
    });
});

describe('mapTrackEnrichment', () => {
    it("files Plex's MusicBrainz id as a TRACK id, never as the recording the host promotes", () => {
        const enrichment = mapTrackEnrichment(
            {
                ratingKey: '6971',
                guid: 'plex://track/5d07',
                type: 'track',
                title: 'Crimson Rider',
                grandparentTitle: 'Masterplan',
                parentTitle: 'Aeronautics',
                parentYear: 2005,
                parentStudio: 'AFM Records',
                Genre: [{ tag: 'Pop/Rock' }],
                Mood: [{ tag: 'Strong' }, { tag: ' ' }],
                Guid: [{ id: `mbid://${MBID}` }],
            },
            'http://plex.test/art',
        );

        expect(enrichment).toEqual({
            providerRef: '6971',
            title: 'Crimson Rider',
            artist: 'Masterplan',
            album: 'Aeronautics',
            year: 2005,
            genres: ['Pop/Rock'],
            moods: ['Strong'],
            label: 'AFM Records',
            artworkUrl: 'http://plex.test/art',
            externalIds: [
                { source: 'plex', id: '6971' },
                { source: 'plex-guid', id: 'plex://track/5d07' },
                { source: 'musicbrainz-track', id: MBID },
            ],
        });
        expect(enrichment.externalIds!.some(id => id.source === 'musicbrainz')).toBe(false);
    });

    it('answers nothing for an item with no rating key', () => {
        expect(mapTrackEnrichment({ title: 'x' })).toEqual({});
    });
});

describe('mapArtistEnrichment', () => {
    it('carries the biography, styles before the broad genre, and an artist id the host promotes', () => {
        expect(
            mapArtistEnrichment(
                {
                    ratingKey: '6928',
                    type: 'artist',
                    title: 'Masterplan',
                    summary: 'German power metal band.',
                    Genre: [{ tag: 'Pop/Rock' }],
                    Style: [{ tag: 'Power Metal' }, { tag: 'pop/rock' }],
                    Guid: [{ id: `mbid://${MBID}` }],
                },
                'http://plex.test/img',
            ),
        ).toEqual({
            providerRef: '6928',
            name: 'Masterplan',
            biography: 'German power metal band.',
            genres: ['Power Metal', 'pop/rock'],
            imageUrl: 'http://plex.test/img',
            externalIds: [
                { source: 'plex', id: '6928' },
                { source: 'musicbrainz-artist', id: MBID },
            ],
        });
    });
});

describe('mapAlbumEnrichment', () => {
    it('files the MusicBrainz id as a RELEASE, which is not the release group the host promotes', () => {
        const enrichment = mapAlbumEnrichment({
            ratingKey: '6970',
            type: 'album',
            title: 'Aeronautics',
            parentTitle: 'Masterplan',
            year: 2005,
            originallyAvailableAt: '2005-01-21',
            studio: 'AFM Records',
            Style: [{ tag: 'Heavy Metal' }],
            Guid: [{ id: `mbid://${MBID}` }],
        });

        expect(enrichment).toMatchObject({ name: 'Aeronautics', artist: 'Masterplan', year: 2005, releaseDate: '2005-01-21', label: 'AFM Records' });
        expect(enrichment.externalIds).toContainEqual({ source: 'musicbrainz-release', id: MBID });
        expect(enrichment.externalIds!.some(id => id.source === 'musicbrainz-release-group')).toBe(false);
    });

    it('drops a release date that is not a whole date', () => {
        expect(mapAlbumEnrichment({ ratingKey: '1', originallyAvailableAt: '2005' }).releaseDate).toBeUndefined();
    });
});

describe('selectTrack', () => {
    const track = (ratingKey: string, title: string, artist: string, extra: Record<string, unknown> = {}) => ({
        ratingKey,
        type: 'track',
        title,
        grandparentTitle: artist,
        ...extra,
    });

    it('needs the artist and the title both to agree', () => {
        expect(selectTrack([track('1', 'Roads', 'Someone Else')], { artist: 'Portishead', title: 'Roads' })).toBeUndefined();
        expect(selectTrack([track('1', 'Glory Box', 'Portishead')], { artist: 'Portishead', title: 'Roads' })).toBeUndefined();
    });

    it("credits a compilation track to its own artist, not the album's", () => {
        const found = selectTrack([track('1', 'Roads', 'Various Artists', { originalTitle: 'Portishead' })], {
            artist: 'Portishead',
            title: 'Roads',
        });
        expect(found?.ratingKey).toBe('1');
    });

    it('prefers the exact title, then the matching album', () => {
        const items = [
            track('1', 'Roads (Live)', 'Portishead', { parentTitle: 'Roseland NYC Live' }),
            track('2', 'Roads', 'Portishead', { parentTitle: 'Greatest Hits' }),
            track('3', 'Roads', 'Portishead', { parentTitle: 'Dummy' }),
        ];
        expect(selectTrack(items, { artist: 'Portishead', title: 'Roads', album: 'Dummy' })?.ratingKey).toBe('3');
    });
});

describe('selectArtist', () => {
    const artist = (ratingKey: string, title: string, mbid?: string) => ({
        ratingKey,
        type: 'artist',
        title,
        ...(mbid ? { Guid: [{ id: `mbid://${mbid}` }] } : {}),
    });
    const A = '00000000-0000-0000-0000-00000000000a';
    const B = '00000000-0000-0000-0000-00000000000b';

    it('takes the MusicBrainz id over the name', () => {
        expect(selectArtist([artist('1', 'Nirvana', A), artist('2', 'Nirvana', B)], 'Nirvana', B, musicBrainzId)?.ratingKey).toBe('2');
    });

    it('refuses a namesake whose id says it is somebody else', () => {
        expect(selectArtist([artist('1', 'Nirvana', A)], 'Nirvana', B, musicBrainzId)).toBeUndefined();
    });

    it('refuses two namesakes with nothing to tell them apart', () => {
        expect(selectArtist([artist('1', 'Nirvana'), artist('2', 'Nirvana')], 'Nirvana', undefined, musicBrainzId)).toBeUndefined();
        expect(selectArtist([artist('1', 'Nirvana')], 'nirvana', undefined, musicBrainzId)?.ratingKey).toBe('1');
    });
});

describe('selectAlbum', () => {
    it('matches the title, decorations aside, and the artist', () => {
        const items = [
            { ratingKey: '1', type: 'album', title: 'Dummy', parentTitle: 'Someone Else' },
            { ratingKey: '2', type: 'album', title: 'Dummy (Deluxe Edition)', parentTitle: 'Portishead' },
            { ratingKey: '3', type: 'album', title: 'Dummy', parentTitle: 'Portishead' },
        ];
        expect(selectAlbum(items, 'Dummy', 'Portishead')?.ratingKey).toBe('3');
        expect(selectAlbum(items.slice(0, 2), 'Dummy', 'Portishead')?.ratingKey).toBe('2');
        expect(selectAlbum(items.slice(0, 1), 'Dummy', 'Portishead')).toBeUndefined();
    });
});
