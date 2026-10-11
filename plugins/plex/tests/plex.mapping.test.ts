import { describe, expect, it } from 'vitest';

import { mapPlaylist, mapTrack, partKey, plexPlaylistIdFromUrl } from '../src/plex.mapping.js';

const MACHINE = '6381ab74116e43ced5ca2a09c210432e8d254829';

describe('mapTrack', () => {
    it('maps a track, with the album year standing in for the track year Plex rarely fills', () => {
        expect(
            mapTrack(
                {
                    ratingKey: '6',
                    type: 'track',
                    title: 'Song 1',
                    grandparentTitle: 'Test Artist',
                    parentTitle: 'Test Album',
                    duration: 20000,
                    parentYear: 1994,
                    index: 1,
                    parentIndex: 2,
                },
                'http://plex.test/art',
            ),
        ).toEqual({
            id: '6',
            title: 'Song 1',
            artists: ['Test Artist'],
            album: 'Test Album',
            durationMs: 20000,
            artworkUrl: 'http://plex.test/art',
            year: 1994,
            trackNumber: 1,
            discNumber: 2,
        });
    });

    it("credits a compilation track to its own artist rather than the album's", () => {
        expect(
            mapTrack({ ratingKey: '1', type: 'track', title: 'x', grandparentTitle: 'Various Artists', originalTitle: 'Portishead' })?.artists,
        ).toEqual(['Portishead']);
        expect(mapTrack({ ratingKey: '1', type: 'track', title: 'x', grandparentTitle: 'Various Artists' })?.artists).toEqual([]);
    });

    it('refuses anything that is not a track', () => {
        expect(mapTrack({ ratingKey: '1', type: 'artist', title: 'The Killers' })).toBeUndefined();
        expect(mapTrack({ type: 'track', title: 'no key' })).toBeUndefined();
    });
});

describe('partKey', () => {
    it("is the first part of the track's first version", () => {
        expect(partKey({ Media: [{ Part: [{ key: '/library/parts/2/1791728003/file.flac' }] }, { Part: [{ key: '/other' }] }] })).toBe(
            '/library/parts/2/1791728003/file.flac',
        );
        expect(partKey({})).toBeUndefined();
    });
});

describe('mapPlaylist', () => {
    it('carries the count and description, and leaves permissions unsaid', () => {
        expect(mapPlaylist({ ratingKey: '13', title: 'Station Mix', leafCount: 5, summary: 'Late night' })).toEqual({
            id: '13',
            name: 'Station Mix',
            description: 'Late night',
            trackCount: 5,
        });
    });
});

describe('plexPlaylistIdFromUrl', () => {
    const key = encodeURIComponent('/playlists/13');

    it('reads the playlist out of a Plex Web link to this server, from app.plex.tv or the server itself', () => {
        expect(plexPlaylistIdFromUrl(`https://app.plex.tv/desktop/#!/server/${MACHINE}/playlist?key=${key}`, MACHINE)).toBe('13');
        expect(plexPlaylistIdFromUrl(`http://plex.local:32400/web/index.html#!/server/${MACHINE}/playlist?key=${key}`, MACHINE)).toBe('13');
    });

    it("claims nothing on another server, nothing that is not a playlist, and nothing before the server's id is known", () => {
        expect(plexPlaylistIdFromUrl(`https://app.plex.tv/desktop/#!/server/other/playlist?key=${key}`, MACHINE)).toBeUndefined();
        expect(
            plexPlaylistIdFromUrl(
                `https://app.plex.tv/desktop/#!/server/${MACHINE}/details?key=${encodeURIComponent('/library/metadata/6')}`,
                MACHINE,
            ),
        ).toBeUndefined();
        expect(plexPlaylistIdFromUrl(`https://app.plex.tv/desktop/#!/server/${MACHINE}/playlist?key=${key}`, undefined)).toBeUndefined();
        expect(plexPlaylistIdFromUrl('not a url', MACHINE)).toBeUndefined();
    });
});
