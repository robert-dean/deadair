import { describe, expect, it } from 'vitest';

import { durationMs, embyPlaylistIdFromUrl, mapPlaylist, mapTrack } from '../src/emby.mapping.js';

const ID = '34';

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

    it('refuses anything that is not a track, since Emby answers with whatever an id names', () => {
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

describe('embyPlaylistIdFromUrl', () => {
    const base = 'http://emby.local:8096';

    it("reads the id out of an item link on this server, which is how Emby's web app links a playlist", () => {
        expect(embyPlaylistIdFromUrl(`${base}/web/index.html#!/item?id=${ID}&serverId=abc`, base)).toBe(ID);
    });

    it('honours a base path', () => {
        expect(embyPlaylistIdFromUrl(`https://media.test/emby/web/index.html#!/item?id=${ID}`, 'https://media.test/emby')).toBe(ID);
    });

    it('claims nothing on another server, or that is not an item page, or whose id is not a number', () => {
        expect(embyPlaylistIdFromUrl(`http://other:8096/web/index.html#!/item?id=${ID}`, base)).toBeUndefined();
        expect(embyPlaylistIdFromUrl(`${base}/web/index.html#!/music`, base)).toBeUndefined();
        expect(embyPlaylistIdFromUrl(`${base}/web/index.html#!/item?id=d32748680b298db5650456cbd268da71`, base)).toBeUndefined();
        expect(embyPlaylistIdFromUrl('not a url', base)).toBeUndefined();
    });
});
