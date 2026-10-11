// Two upstream shapes, one contract, and the differences between them are what these assert. The one
// that matters most is the advisory: `track_sources.advisory` reads null as "the provider did not say,
// never consent", so a word mapped generously here is an unedited record on a station that asked for
// clean copies only.

import { describe, expect, it } from 'vitest';

import {
    advisoryOf,
    applePlaylistIdFromUrl,
    artworkAt,
    matchesFilters,
    playlistFromApple,
    trackFromApple,
    trackFromItunes,
    yearOf,
} from '../src/applemusic.mapping.js';

describe('trackFromApple', () => {
    const song = {
        id: '1440653203',
        attributes: {
            name: 'Roads',
            artistName: 'Portishead',
            albumName: 'Dummy',
            durationInMillis: 306_000,
            isrc: 'GBAAA9400050',
            releaseDate: '1994-08-22',
            contentRating: 'clean',
            artwork: { url: 'https://is1.mzstatic.com/image/thumb/abc/{w}x{h}bb.jpg' },
        },
    };

    it('reads the record, the ISRC included', () => {
        // The ISRC is the reason to configure a developer key at all: it is how this row joins to the
        // same recording from Navidrome or Spotify instead of sitting beside it as a near duplicate.
        expect(trackFromApple(song)).toMatchObject({
            id: '1440653203',
            title: 'Roads',
            artists: ['Portishead'],
            album: 'Dummy',
            durationMs: 306_000,
            isrc: 'GBAAA9400050',
            year: 1994,
            advisory: 'clean',
        });
    });

    it('pins one artwork size, so the same cover is one URL forever', () => {
        // The art cache is keyed by the string, so a varying size means re-downloading the same cover.
        expect(trackFromApple(song)?.artworkUrl).toBe('https://is1.mzstatic.com/image/thumb/abc/600x600bb.jpg');
    });

    it('refuses a row with no id, title or artist rather than inventing one', () => {
        expect(trackFromApple({ id: '1', attributes: { name: 'Roads' } })).toBeUndefined();
        expect(trackFromApple({ attributes: { name: 'Roads', artistName: 'Portishead' } })).toBeUndefined();
    });
});

describe('trackFromItunes', () => {
    const row = {
        wrapperType: 'track',
        kind: 'song',
        trackId: 1_440_653_203,
        trackName: 'Roads',
        artistName: 'Portishead',
        collectionName: 'Dummy',
        trackTimeMillis: 306_000,
        releaseDate: '1994-08-22T07:00:00Z',
        trackExplicitness: 'notExplicit',
        artworkUrl100: 'https://is1.mzstatic.com/image/thumb/abc/100x100bb.jpg',
    };

    it('uses the numeric trackId as the catalog id, because that is what plays', () => {
        // Verified end to end: this id came out of the Search API and `stream/apple-player` played it and
        // reported the right title. It is the whole reason the keyless mode is viable.
        expect(trackFromItunes(row)).toMatchObject({ id: '1440653203', title: 'Roads', artists: ['Portishead'], year: 1994 });
    });

    it('carries no ISRC, because this upstream has none to give', () => {
        expect(trackFromItunes(row).isrc).toBeUndefined();
    });

    it('asks for a bigger crop of the same artwork asset', () => {
        expect(trackFromItunes(row)?.artworkUrl).toBe('https://is1.mzstatic.com/image/thumb/abc/600x600bb.jpg');
    });

    it('drops anything that is not a song', () => {
        // The same endpoint answers with music videos, podcasts and audiobooks, and a music video's id
        // does not play. A row that slipped through would be a catalog entry that is skipped on air.
        expect(trackFromItunes({ ...row, kind: 'music-video' })).toBeUndefined();
        expect(trackFromItunes({ ...row, wrapperType: 'collection' })).toBeUndefined();
    });
});

describe('advisoryOf', () => {
    it('maps the words both upstreams use', () => {
        expect(advisoryOf('explicit')).toBe('explicit');
        expect(advisoryOf('clean')).toBe('clean');
        expect(advisoryOf('cleaned')).toBe('clean');
    });

    it('does NOT read notExplicit as clean', () => {
        // The one that matters. `notExplicit` means "this release has no explicit version to be the clean
        // edit of", which is a different statement from "this is the clean edit" — and reading it as
        // consent would put an unedited record on a station that asked for clean copies only.
        expect(advisoryOf('notExplicit')).toBeUndefined();
        expect(advisoryOf(undefined)).toBeUndefined();
        expect(advisoryOf('')).toBeUndefined();
    });
});

describe('yearOf', () => {
    it('reads a year out of either date format, without dragging in a timezone', () => {
        expect(yearOf('1994-08-22')).toBe(1994);
        expect(yearOf('1994-08-22T07:00:00Z')).toBe(1994);
    });

    it('answers undefined for anything that is not a year', () => {
        expect(yearOf(undefined)).toBeUndefined();
        expect(yearOf('')).toBeUndefined();
        expect(yearOf('soon')).toBeUndefined();
    });
});

describe('artworkAt', () => {
    it('leaves a URL it does not recognise alone rather than corrupting it', () => {
        expect(artworkAt('https://example.test/cover.jpg')).toBe('https://example.test/cover.jpg');
        expect(artworkAt(undefined)).toBeUndefined();
        expect(artworkAt('')).toBeUndefined();
    });
});

describe('matchesFilters', () => {
    const track = { id: '1', title: 'Roads', artists: ['Portishead'], year: 1994 };

    it('honours a year window', () => {
        expect(matchesFilters(track, { yearFrom: 1990, yearTo: 1999 })).toBe(true);
        expect(matchesFilters(track, { yearFrom: 2000 })).toBe(false);
        expect(matchesFilters(track, { yearTo: 1980 })).toBe(false);
    });

    it('drops a record whose year is unknown when a year was asked for', () => {
        // The SDK's rule: a filter you cannot apply means you have nothing to offer for that search.
        // Keeping an undated row would answer as though the filter had not been asked for, and the caller
        // merges several providers into one list with nothing marking which rows honoured it.
        expect(matchesFilters({ id: '1', title: 'x', artists: ['y'] }, { yearFrom: 1990 })).toBe(false);
    });

    it('keeps everything when nothing was asked for', () => {
        expect(matchesFilters(track, {})).toBe(true);
    });
});

describe('playlistFromApple', () => {
    it('marks every playlist as the provider own, because it is', () => {
        // Everything reachable with a developer token alone is Apple's editorial, never the operator's:
        // a personal library needs a Music User Token this plugin does not hold. Saying so is what lets
        // the console fold them away from what the operator actually chose.
        expect(playlistFromApple({ id: 'pl.1', attributes: { name: 'Today at Apple', trackCount: 25 } })).toEqual({
            id: 'pl.1',
            name: 'Today at Apple',
            trackCount: 25,
            madeByProvider: true,
        });
    });

    it('refuses a row with no name', () => {
        expect(playlistFromApple({ id: 'pl.1', attributes: {} })).toBeUndefined();
    });
});

describe('applePlaylistIdFromUrl', () => {
    const id = 'pl.f4d106fed2bd41149aaacabb233eb5eb';

    it.each([
        ['the share button', `https://music.apple.com/us/playlist/todays-hits/${id}`],
        ['a language query', `https://music.apple.com/gb/playlist/todays-hits/${id}?l=en-GB`],
        ['no name segment', `https://music.apple.com/us/playlist/${id}`],
        ['a trailing slash', `https://music.apple.com/us/playlist/todays-hits/${id}/`],
        ['an embed', `https://embed.music.apple.com/us/playlist/todays-hits/${id}`],
        ['an old iTunes link', `https://itunes.apple.com/us/playlist/todays-hits/id${id}`],
        ['surrounding whitespace', `  https://music.apple.com/us/playlist/todays-hits/${id}\n`],
    ])('reads %s', (_, url) => {
        expect(applePlaylistIdFromUrl(url)).toBe(id);
    });

    it("reads a listener's shared playlist", () => {
        expect(applePlaylistIdFromUrl('https://music.apple.com/us/playlist/road-trip/pl.u-AkAmPlyUxqZ6Wo')).toBe('pl.u-AkAmPlyUxqZ6Wo');
    });

    it('drops the storefront, because the plugin reads its own', () => {
        // An id carrying `gb` would be one `listPlaylists` never answers, which the SDK forbids.
        expect(applePlaylistIdFromUrl(`https://music.apple.com/gb/playlist/x/${id}`)).toBe(
            applePlaylistIdFromUrl(`https://music.apple.com/us/playlist/x/${id}`),
        );
    });

    it.each([
        ['an album', 'https://music.apple.com/us/album/dummy/1440653171'],
        ['a song inside an album', 'https://music.apple.com/us/album/dummy/1440653171?i=1440653203'],
        ['an artist', 'https://music.apple.com/us/artist/portishead/50254'],
        ["another service's playlist", 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'],
        ['a lookalike host', `https://music.apple.com.example.org/us/playlist/x/${id}`],
        ['something that is not a playlist id', 'https://music.apple.com/us/playlist/x/1440653171'],
        ['text that is not a link', 'todays hits'],
        ['the empty string', ''],
    ])('leaves %s alone, because the first provider to claim a link wins it', (_, url) => {
        expect(applePlaylistIdFromUrl(url)).toBeUndefined();
    });
});
