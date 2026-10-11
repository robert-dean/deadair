import { describe, expect, it } from 'vitest';

import { durationMs, jellyfinPlaylistIdFromUrl, mapPlaylist, mapTrack } from '../src/jellyfin.mapping.js';

const ID = 'd32748680b298db5650456cbd268da71';

describe('mapTrack', () => {
    it('maps a tagged track', () => {
        expect(
            mapTrack(
                {
                    Id: ID,
                    Type: 'Audio',
                    Name: 'Song 1',
                    Artists: ['Test Artist', 'Guest'],
                    Album: 'Test Album',
                    RunTimeTicks: 200_000_000,
                    ProductionYear: 1994,
                    IndexNumber: 3,
                    ParentIndexNumber: 2,
                },
                'http://jf.test/art',
            ),
        ).toEqual({
            id: ID,
            title: 'Song 1',
            artists: ['Test Artist', 'Guest'],
            album: 'Test Album',
            durationMs: 20_000,
            artworkUrl: 'http://jf.test/art',
            year: 1994,
            trackNumber: 3,
            discNumber: 2,
        });
    });

    it('refuses anything that is not a track, since Jellyfin answers with whatever an id names', () => {
        expect(mapTrack({ Id: ID, Type: 'CollectionFolder', Name: 'Music' })).toBeUndefined();
        expect(mapTrack({ Type: 'Audio', Name: 'No id' })).toBeUndefined();
    });

    it('falls back to the album artist, and drops placeholders and nulls', () => {
        expect(mapTrack({ Id: ID, Type: 'Audio', Name: 'x', Artists: [], AlbumArtist: 'Album Artist' })?.artists).toEqual(['Album Artist']);
        const bare = mapTrack({
            Id: ID,
            Type: 'Audio',
            Name: 'x',
            Artists: ['Unknown Artist'],
            Album: '[Unknown Album]',
            ProductionYear: 0,
            IndexNumber: null,
        });
        expect(bare).toEqual({ id: ID, title: 'x', artists: [] });
    });
});

describe('durationMs', () => {
    it('turns ticks of 100ns into whole milliseconds', () => {
        expect(durationMs(2_345_678)).toBe(235);
        expect(durationMs(null)).toBeUndefined();
        expect(durationMs(0)).toBeUndefined();
    });
});

describe('mapPlaylist', () => {
    it('carries the count and description, and leaves permissions unsaid', () => {
        expect(mapPlaylist({ Id: ID, Name: 'Mix', ChildCount: 5, Overview: 'Late night' })).toEqual({
            id: ID,
            name: 'Mix',
            description: 'Late night',
            trackCount: 5,
        });
    });
});

describe('jellyfinPlaylistIdFromUrl', () => {
    const base = 'http://jellyfin.local:8096';

    it('reads the id out of a details link on this server', () => {
        expect(jellyfinPlaylistIdFromUrl(`${base}/web/#/details?id=${ID}&serverId=abc`, base)).toBe(ID);
    });

    it('reads the pre-10.9 hashbang form too', () => {
        expect(jellyfinPlaylistIdFromUrl(`${base}/web/index.html#!/details?id=${ID}`, base)).toBe(ID);
    });

    it('honours a base path', () => {
        expect(jellyfinPlaylistIdFromUrl(`https://media.test/jellyfin/web/#/details?id=${ID}`, 'https://media.test/jellyfin')).toBe(ID);
    });

    it('claims nothing on another server, or that is not a details page', () => {
        expect(jellyfinPlaylistIdFromUrl(`http://other:8096/web/#/details?id=${ID}`, base)).toBeUndefined();
        expect(jellyfinPlaylistIdFromUrl(`${base}/web/#/music`, base)).toBeUndefined();
        expect(jellyfinPlaylistIdFromUrl(`${base}/web/#/details?id=not-an-id`, base)).toBeUndefined();
        expect(jellyfinPlaylistIdFromUrl('not a url', base)).toBeUndefined();
    });
});
