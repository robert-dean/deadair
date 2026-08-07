import { describe, expect, it } from 'vitest';

import { durationMs, genreNames, mapPlaylist, mapTrack, mapTracks } from '../src/navidrome.mapping.js';

describe('mapTrack', () => {
    const song = { id: 'song-1', title: 'Sour Times', artist: 'Portishead', album: 'Dummy', duration: 254, coverArt: 'art-1' };

    it('reads the fields deadair asks a provider for', () => {
        expect(mapTrack(song)).toEqual({
            id: 'song-1',
            title: 'Sour Times',
            artists: ['Portishead'],
            album: 'Dummy',
            // Seconds on the wire, integer milliseconds across the boundary.
            durationMs: 254_000,
        });
    });

    it('refuses a song with no id, since nothing could ever be fetched by it', () => {
        expect(mapTrack({ title: 'Nameless' })).toBeUndefined();
    });

    it('keeps a comma-bearing artist whole rather than inventing a duo', () => {
        // Subsonic has one artist string. Splitting it would turn "Tyler, The
        // Creator" into two people who do not exist.
        expect(mapTrack({ id: 's', artist: 'Tyler, The Creator' })?.artists).toEqual(['Tyler, The Creator']);
    });

    it('reports no artists rather than an empty-string one', () => {
        expect(mapTrack({ id: 's', artist: '   ' })?.artists).toEqual([]);
    });

    it('titles an untitled song rather than handing back an empty string', () => {
        expect(mapTrack({ id: 's' })?.title).toBe('Untitled');
    });

    it('omits what the server had no value for, instead of emptying it', () => {
        expect(Object.keys(mapTrack({ id: 's', album: '', duration: 0 }) ?? {}).sort()).toEqual(['artists', 'id', 'title']);
    });

    it('takes the artwork URL from the caller, which is the only thing holding credentials', () => {
        expect(mapTrack(song, 'http://navidrome.test/rest/getCoverArt.view?id=art-1')?.artworkUrl).toBe(
            'http://navidrome.test/rest/getCoverArt.view?id=art-1',
        );
    });

    it('never claims an ISRC, because Subsonic has no field for one', () => {
        expect(mapTrack(song)).not.toHaveProperty('isrc');
    });
});

describe('mapTracks', () => {
    it('drops the unusable and keeps the order', () => {
        const tracks = mapTracks([{ id: 'a', title: 'A' }, { title: 'no id' }, { id: 'b', title: 'B' }]);
        expect(tracks.map(track => track.id)).toEqual(['a', 'b']);
    });

    it('mints artwork per song', () => {
        const tracks = mapTracks([{ id: 'a', coverArt: 'art-a' }], song => `url:${song.coverArt}`);
        expect(tracks[0]?.artworkUrl).toBe('url:art-a');
    });
});

describe('genreNames', () => {
    it('prefers the OpenSubsonic list, which can hold more than one', () => {
        expect(genreNames({ genre: 'trip hop', genres: [{ name: 'trip hop' }, { name: 'downtempo' }] })).toEqual(['trip hop', 'downtempo']);
    });

    it('falls back to the legacy single field for a server that sends only that', () => {
        expect(genreNames({ genre: 'trip hop' })).toEqual(['trip hop']);
    });

    it('has nothing to say about an untagged track', () => {
        expect(genreNames({ genres: [{ name: '' }] })).toEqual([]);
        expect(genreNames({})).toEqual([]);
    });
});

describe('mapPlaylist', () => {
    it('reads the name, the description and the count', () => {
        expect(mapPlaylist({ id: 'pl-1', name: 'Late night', comment: 'For the small hours', songCount: 42 })).toEqual({
            id: 'pl-1',
            name: 'Late night',
            description: 'For the small hours',
            trackCount: 42,
        });
    });

    it('leaves permissions unset, because Subsonic never said', () => {
        // Absent and empty mean different things to the host: `[]` would claim the
        // source was asked and permits nothing, which would hide the playlist.
        expect(mapPlaylist({ id: 'pl-1', name: 'Late night' })).not.toHaveProperty('permissions');
    });

    it('counts an empty playlist as empty rather than as unknown', () => {
        expect(mapPlaylist({ id: 'pl-1', name: 'New', songCount: 0 })?.trackCount).toBe(0);
    });
});

describe('durationMs', () => {
    it('rounds to whole milliseconds, since the boundary takes integers', () => {
        expect(durationMs(254.4)).toBe(254_400);
        expect(durationMs(0.0004)).toBe(0);
    });

    it('treats a missing or zero duration as unknown', () => {
        expect(durationMs(undefined)).toBeUndefined();
        expect(durationMs(0)).toBeUndefined();
    });
});
