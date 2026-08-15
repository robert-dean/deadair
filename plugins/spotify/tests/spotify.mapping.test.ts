import { describe, expect, it } from 'vitest';

import {
    buildSearchQuery,
    clampLimit,
    clampSearchLimit,
    clampSearchOffset,
    clampSearchTotal,
    mapPlaybackState,
    mapPlaylist,
    mapTrack,
} from '../src/spotify.mapping.js';

describe('mapTrack', () => {
    it('maps a full track', () => {
        const track = mapTrack({
            id: 'track-1',
            name: 'Song Title',
            artists: [{ name: 'Artist One' }, { name: 'Artist Two' }],
            album: {
                name: 'Album Name',
                images: [{ url: 'https://example.com/big.jpg' }, { url: 'https://example.com/small.jpg' }],
            },
            duration_ms: 123456,
            external_ids: { isrc: 'US1234567890' },
        });

        expect(track).toEqual({
            id: 'track-1',
            title: 'Song Title',
            artists: ['Artist One', 'Artist Two'],
            album: 'Album Name',
            durationMs: 123456,
            isrc: 'US1234567890',
            artworkUrl: 'https://example.com/big.jpg',
        });
    });

    it('carries the popularity, which is what a browse is ordered by', () => {
        const track = mapTrack({ id: 'track-1', name: 'Respect', popularity: 82 });

        expect(track?.popularity).toBe(82);
    });

    it('says nothing when Spotify did not rank it, rather than calling it unpopular', () => {
        // A simplified track object inside an album carries no `popularity`, and "absent" has to
        // stay distinguishable from zero: a caller ordering by it sorts the unranked last rather
        // than beneath everything ranked.
        expect(mapTrack({ id: 'track-1', name: 'Album Cut' })).not.toHaveProperty('popularity');
        expect(mapTrack({ id: 'track-1', name: 'Odd', popularity: 140 })).not.toHaveProperty('popularity');
    });

    it('returns undefined when id is missing', () => {
        expect(mapTrack({ name: 'No Id' })).toBeUndefined();
    });

    it('returns undefined when name is missing', () => {
        expect(mapTrack({ id: 'track-1' })).toBeUndefined();
    });

    it('returns undefined for null input', () => {
        expect(mapTrack(null)).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
        expect(mapTrack(undefined)).toBeUndefined();
    });

    it('defaults artists to an empty array when missing', () => {
        const track = mapTrack({ id: 'track-1', name: 'Song Title' });

        expect(track?.artists).toEqual([]);
    });

    it('filters out artists with a missing or empty name', () => {
        const track = mapTrack({
            id: 'track-1',
            name: 'Song Title',
            artists: [{ name: 'Real Artist' }, {}, { name: '' }],
        });

        expect(track?.artists).toEqual(['Real Artist']);
    });

    it('leaves album, durationMs, isrc, and artworkUrl undefined when absent', () => {
        const track = mapTrack({ id: 'track-1', name: 'Song Title' });

        expect(track).toEqual({
            id: 'track-1',
            title: 'Song Title',
            artists: [],
            album: undefined,
            durationMs: undefined,
            isrc: undefined,
            artworkUrl: undefined,
        });
    });

    it('leaves artworkUrl undefined when there are no album images', () => {
        const track = mapTrack({ id: 'track-1', name: 'Song Title', album: { name: 'Album', images: [] } });

        expect(track?.artworkUrl).toBeUndefined();
    });
});

describe('mapPlaylist', () => {
    it('maps a full playlist', () => {
        const playlist = mapPlaylist({
            id: 'playlist-1',
            name: 'My Playlist',
            description: 'A great mix',
            images: [{ url: 'https://example.com/cover.jpg' }],
            tracks: { total: 42 },
        });

        expect(playlist).toEqual({
            id: 'playlist-1',
            name: 'My Playlist',
            description: 'A great mix',
            trackCount: 42,
            artworkUrl: 'https://example.com/cover.jpg',
        });
    });

    it('prefers the 2026 `items` total over the deprecated `tracks` total', () => {
        const playlist = mapPlaylist({ id: 'playlist-1', name: 'My Playlist', items: { total: 42 }, tracks: { total: 7 } });

        expect(playlist?.trackCount).toBe(42);
    });

    it('grants read and edit on a playlist the user owns, and nothing on one they only follow', () => {
        const owned = mapPlaylist({ id: 'pl-1', name: 'Mine', owner: { id: 'me-1' } }, 'me-1');
        const followed = mapPlaylist({ id: 'pl-2', name: 'Discover Weekly', owner: { id: 'spotify' } }, 'me-1');

        expect(owned?.permissions).toEqual(['read', 'edit']);
        expect(followed?.permissions).toEqual([]);
    });

    it('treats a collaborative playlist as usable even when someone else owns it', () => {
        const playlist = mapPlaylist({ id: 'pl-1', name: 'Shared', owner: { id: 'friend' }, collaborative: true }, 'me-1');

        expect(playlist?.permissions).toEqual(['read', 'edit']);
    });

    it('has no opinion when the owner or the current user is unknown', () => {
        expect(mapPlaylist({ id: 'pl-1', name: 'Mystery', owner: { id: 'someone' } })?.permissions).toBeUndefined();
        expect(mapPlaylist({ id: 'pl-1', name: 'Mystery' }, 'me-1')?.permissions).toBeUndefined();
    });

    it('distinguishes "the source permits nothing" from "the source did not say"', () => {
        const refused = mapPlaylist({ id: 'pl-1', name: 'Theirs', owner: { id: 'spotify' } }, 'me-1');
        const unknown = mapPlaylist({ id: 'pl-2', name: 'Theirs', owner: { id: 'spotify' } });

        // Collapsing these is the regression this shape exists to prevent: a
        // host that reads `undefined` as "permits nothing" hides the entire
        // library the first time the profile call fails.
        expect(refused?.permissions).toEqual([]);
        expect(unknown?.permissions).toBeUndefined();
    });

    it('carries the popularity, which is what a browse is ordered by', () => {
        const track = mapTrack({ id: 'track-1', name: 'Respect', popularity: 82 });

        expect(track?.popularity).toBe(82);
    });

    it('says nothing when Spotify did not rank it, rather than calling it unpopular', () => {
        // A simplified track object inside an album carries no `popularity`, and "absent" has to
        // stay distinguishable from zero: a caller ordering by it sorts the unranked last rather
        // than beneath everything ranked.
        expect(mapTrack({ id: 'track-1', name: 'Album Cut' })).not.toHaveProperty('popularity');
        expect(mapTrack({ id: 'track-1', name: 'Odd', popularity: 140 })).not.toHaveProperty('popularity');
    });

    it('returns undefined when id is missing', () => {
        expect(mapPlaylist({ name: 'No Id' })).toBeUndefined();
    });

    it('returns undefined when name is missing', () => {
        expect(mapPlaylist({ id: 'playlist-1' })).toBeUndefined();
    });

    it('returns undefined for null input', () => {
        expect(mapPlaylist(null)).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
        expect(mapPlaylist(undefined)).toBeUndefined();
    });

    it('maps an empty description to undefined', () => {
        const playlist = mapPlaylist({ id: 'playlist-1', name: 'My Playlist', description: '' });

        expect(playlist?.description).toBeUndefined();
    });

    it('leaves description, trackCount, and artworkUrl undefined when absent', () => {
        const playlist = mapPlaylist({ id: 'playlist-1', name: 'My Playlist' });

        expect(playlist).toEqual({
            id: 'playlist-1',
            name: 'My Playlist',
            description: undefined,
            trackCount: undefined,
            artworkUrl: undefined,
        });
    });
});

describe('mapPlaybackState', () => {
    it('maps a fully populated playing state', () => {
        const state = mapPlaybackState({
            is_playing: true,
            progress_ms: 5000,
            item: { id: 'track-1', duration_ms: 200000 },
        });

        expect(state).toEqual({
            status: 'playing',
            trackId: 'track-1',
            positionMs: 5000,
            durationMs: 200000,
        });
    });

    it('maps is_playing: false to paused', () => {
        const state = mapPlaybackState({ is_playing: false });

        expect(state.status).toBe('paused');
    });

    it('maps a missing is_playing to paused', () => {
        const state = mapPlaybackState({});

        expect(state.status).toBe('paused');
    });

    it('leaves trackId and durationMs undefined when item is missing', () => {
        const state = mapPlaybackState({ is_playing: true, progress_ms: 1000 });

        expect(state).toEqual({
            status: 'playing',
            trackId: undefined,
            positionMs: 1000,
            durationMs: undefined,
        });
    });
});

describe('clampLimit', () => {
    it('returns undefined for undefined input', () => {
        expect(clampLimit(undefined)).toBeUndefined();
    });

    it('passes through a value already in range', () => {
        expect(clampLimit(25)).toBe(25);
    });

    it('clamps a value above 50 down to 50', () => {
        expect(clampLimit(100)).toBe(50);
    });

    it('clamps a value below 1 up to 1', () => {
        expect(clampLimit(0)).toBe(1);
    });

    it('clamps a negative value up to 1', () => {
        expect(clampLimit(-10)).toBe(1);
    });

    it('truncates a fractional value', () => {
        expect(clampLimit(10.9)).toBe(10);
    });

    it('passes through the boundary values 1 and 50 unchanged', () => {
        expect(clampLimit(1)).toBe(1);
        expect(clampLimit(50)).toBe(50);
    });
});

describe('clampSearchLimit', () => {
    it('defaults to 10 rather than letting Spotify apply its own default of 5', () => {
        expect(clampSearchLimit(undefined)).toBe(10);
    });

    it('passes through a value already inside the search ceiling', () => {
        expect(clampSearchLimit(3)).toBe(3);
    });

    it('clamps to 10, not to the 50 the other paged endpoints allow', () => {
        expect(clampSearchLimit(50)).toBe(10);
        expect(clampSearchLimit(500)).toBe(10);
    });

    it('clamps a value below 1 up to 1', () => {
        expect(clampSearchLimit(0)).toBe(1);
        expect(clampSearchLimit(-10)).toBe(1);
    });

    it('truncates a fractional value', () => {
        expect(clampSearchLimit(7.9)).toBe(7);
    });

    it('passes through the boundary values 1 and 10 unchanged', () => {
        expect(clampSearchLimit(1)).toBe(1);
        expect(clampSearchLimit(10)).toBe(10);
    });
});

describe('clampSearchOffset', () => {
    it('returns undefined for undefined input', () => {
        expect(clampSearchOffset(undefined)).toBeUndefined();
    });

    it('passes through a value already in range', () => {
        expect(clampSearchOffset(250)).toBe(250);
    });

    it('clamps above the 1000 search paging ceiling', () => {
        expect(clampSearchOffset(5000)).toBe(1000);
    });

    it('clamps a negative offset up to 0, which is a legal first page', () => {
        expect(clampSearchOffset(-1)).toBe(0);
    });

    it('truncates a fractional value', () => {
        expect(clampSearchOffset(12.7)).toBe(12);
    });
});

describe('clampSearchTotal', () => {
    it('defaults to one request when the caller named no limit', () => {
        // The cheapest thing to do for a caller that does not care, and what a caller used to get.
        expect(clampSearchTotal(undefined)).toBe(10);
    });

    it('passes through an ask above the per-request ceiling, which is what paging is for', () => {
        // The whole point: `clampSearchLimit` bounds one REQUEST, this bounds the call. They were
        // the same number while `searchTracks` made one request, and a caller asking for 25 was
        // answered with 10 by a trim nothing downstream could tell from a thin search.
        expect(clampSearchTotal(25)).toBe(25);
    });

    it('bounds how deep one call may page', () => {
        expect(clampSearchTotal(500)).toBe(50);
    });

    it('holds a nonsense ask at one', () => {
        expect(clampSearchTotal(0)).toBe(1);
        expect(clampSearchTotal(-5)).toBe(1);
    });
});

describe('buildSearchQuery', () => {
    it('leaves a plain query alone', () => {
        expect(buildSearchQuery('miles davis', undefined)).toBe('miles davis');
        expect(buildSearchQuery('miles davis', { limit: 10 })).toBe('miles davis');
    });

    it('sends a style as a filter rather than as query text', () => {
        // The failure this exists for: Spotify matches `q` against titles and artist names, so a
        // station's brief handed over as text returns records with those words in the TITLE.
        expect(buildSearchQuery('hits', { genre: 'jazz' })).toBe('hits genre:jazz');
    });

    it('quotes a multi-word style, which would otherwise parse as a stray term', () => {
        expect(buildSearchQuery('best of', { genre: 'new wave' })).toBe('best of genre:"new wave"');
    });

    it('sends a year range', () => {
        expect(buildSearchQuery('jazz', { yearFrom: 1955, yearTo: 1965 })).toBe('jazz year:1955-1965');
    });

    it('closes an open-ended range against the bound rather than leaving it dangling', () => {
        // Spotify reads a bare `year:1955` as that one year, which is not what "from 1955" means.
        expect(buildSearchQuery('jazz', { yearFrom: 1955 })).toBe('jazz year:1955-2100');
        expect(buildSearchQuery('jazz', { yearTo: 1965 })).toBe('jazz year:1900-1965');
    });

    it('orders a reversed range rather than sending one Spotify would reject', () => {
        expect(buildSearchQuery('jazz', { yearFrom: 1965, yearTo: 1955 })).toBe('jazz year:1955-1965');
    });

    it('ignores a filter that is not a usable value', () => {
        expect(buildSearchQuery('jazz', { genre: '   ' })).toBe('jazz');
        expect(buildSearchQuery('jazz', { yearFrom: Number.NaN })).toBe('jazz');
        expect(buildSearchQuery('jazz', { yearFrom: 0 })).toBe('jazz');
    });

    it('combines every filter it was given', () => {
        expect(buildSearchQuery('modal', { genre: 'jazz', yearFrom: 1959, yearTo: 1965 })).toBe('modal genre:jazz year:1959-1965');
    });
});
