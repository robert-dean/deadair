import { describe, expect, it } from 'vitest';

import { ARTWORK_SIZE } from '../src/ytmusic.manifest.js';
import { advisoryOf, artworkUrl, mapPlaylist, mapPlaylists, mapTrack, mapTracks } from '../src/ytmusic.mapping.js';
import type { UpstreamItem } from '../src/ytmusic.mapping.js';

/**
 * Captured from a live search, trimmed to the fields the mapping reads.
 *
 * A collaboration on purpose: the source names only the LEAD and leaves the feature in the title,
 * which is the property `artists[0]` being an identity rather than a credit line depends on.
 */
const COLLABORATION: UpstreamItem = {
    id: 'RnkShwdXfyc',
    item_type: 'song',
    title: 'Love The Way You Lie (feat. Rihanna)',
    artists: [{ name: 'Eminem', channel_id: 'UCedvOgsKFzcK3hA5taf3KoQ' }],
    album: { name: 'Recovery' },
    duration: { seconds: 264, text: '4:24' },
    badges: [{ icon_type: 'MUSIC_EXPLICIT_BADGE', label: 'Explicit' }],
    thumbnails: [
        { url: 'https://lh3.googleusercontent.com/IUuZFSUqFLM=w120-h120-l90-rj', width: 120, height: 120 },
        { url: 'https://lh3.googleusercontent.com/IUuZFSUqFLM=w60-h60-l90-rj', width: 60, height: 60 },
    ],
};

/** The same search, an unbadged row. */
const UNBADGED: UpstreamItem = {
    id: '1CozRvwZEAs',
    item_type: 'song',
    title: 'Love The Way You Lie (Part II) (Pt. 2) (feat. Eminem)',
    artists: [{ name: 'Rihanna', channel_id: 'UCvWtix2TtWGe9kffqnwdaMw' }],
    album: { name: 'Loud (Japan Version)' },
    duration: { seconds: 297, text: '4:57' },
    badges: [],
    thumbnails: [{ url: 'https://lh3.googleusercontent.com/5qKDXKo8Hmm=w120-h120-l90-rj', width: 120, height: 120 }],
};

describe('mapTrack', () => {
    it('keeps the lead artist alone in slot 0, with the feature left in the title', () => {
        const track = mapTrack(COLLABORATION)!;

        // The rule this protects: PickResolver.identify compares normalizeKey(track.artists[0]), so
        // a joined credit line here is how a run names every duet correctly and then drops them all.
        expect(track.artists).toEqual(['Eminem']);
        expect(track.title).toBe('Love The Way You Lie (feat. Rihanna)');
    });

    it('carries duration as integer milliseconds', () => {
        expect(mapTrack(COLLABORATION)!.durationMs).toBe(264_000);
    });

    it('reads the album out of its object', () => {
        expect(mapTrack(COLLABORATION)!.album).toBe('Recovery');
    });

    it('leaves isrc, year and popularity absent rather than inventing them', () => {
        const track = mapTrack(COLLABORATION)!;

        // Absent has to read as "the provider did not say": an absent year is ELIGIBLE for a period
        // filter, and an absent popularity is "no opinion" rather than "unpopular".
        expect(track.isrc).toBeUndefined();
        expect(track.year).toBeUndefined();
        expect(track.popularity).toBeUndefined();
    });

    it('drops a row with no id, which is not a record', () => {
        expect(mapTrack({ ...COLLABORATION, id: undefined })).toBeUndefined();
    });

    it('keeps the provider order and drops the unmappable', () => {
        expect(mapTracks([COLLABORATION, undefined, { id: 'x' }, UNBADGED]).map(t => t.id)).toEqual(['RnkShwdXfyc', '1CozRvwZEAs']);
    });
});

describe('advisory', () => {
    it("marks a badged row 'explicit'", () => {
        expect(mapTrack(COLLABORATION)!.advisory).toBe('explicit');
    });

    it("leaves an unbadged row absent rather than 'clean'", () => {
        // Silence is not consent: rotation.advisory set to clean-only demands a positive 'clean',
        // and answering it here would have the station promise something it cannot deliver.
        expect(mapTrack(UNBADGED)!.advisory).toBeUndefined();
    });

    it('keys off icon_type, so a localized label still resolves', () => {
        // The label is translated per account. Matching it would leave the badge silently never
        // firing on a non-English account -- and a clean-only station would then air this record.
        expect(advisoryOf({ badges: [{ icon_type: 'MUSIC_EXPLICIT_BADGE', label: 'Explicite' }] })).toBe('explicit');
    });

    it('ignores a label that says Explicit under a different icon', () => {
        expect(advisoryOf({ badges: [{ icon_type: 'MUSIC_NEW_BADGE', label: 'Explicit' }] })).toBeUndefined();
    });
});

describe('artworkUrl', () => {
    it('pins one size, so the same record always yields the same URL', () => {
        // Rule 7: the host STORES this and the art cache is keyed by the string, so a part that
        // varies means the same cover is downloaded forever.
        expect(artworkUrl(COLLABORATION)).toBe(`https://lh3.googleusercontent.com/IUuZFSUqFLM=${ARTWORK_SIZE}`);
    });

    it('answers the same URL whichever sizes the response happened to carry', () => {
        const wide = { ...COLLABORATION, thumbnails: [{ url: 'https://lh3.googleusercontent.com/IUuZFSUqFLM=w544-h544-l90-rj' }] };
        expect(artworkUrl(wide)).toBe(artworkUrl(COLLABORATION));
    });

    it('refuses a url that is not http(s)', () => {
        expect(artworkUrl({ thumbnails: [{ url: 'data:image/png;base64,AAAA' }] })).toBeUndefined();
    });

    it('is absent when the row carries no thumbnail', () => {
        expect(mapTrack({ ...COLLABORATION, thumbnails: undefined })!.artworkUrl).toBeUndefined();
    });
});

describe('mapPlaylist', () => {
    const playlist: UpstreamItem = {
        id: 'VLPLabc',
        item_type: 'playlist',
        title: 'Late night',
        subtitle: 'Playlist',
        item_count: '42 songs',
        thumbnails: [{ url: 'https://lh3.googleusercontent.com/abc=w226-h226-l90-rj' }],
    };

    it('maps a playlist row', () => {
        expect(mapPlaylist(playlist)).toMatchObject({ id: 'VLPLabc', name: 'Late night', trackCount: 42 });
    });

    it('drops the "New playlist" button, which is not a playlist', () => {
        // Observed live in the library's Playlists view: it parses as an item with no id. Mapped
        // blindly it becomes a ProviderPlaylist whose id is undefined, which the host then stores
        // and later asks this plugin to read.
        expect(mapPlaylist({ item_type: 'endpoint', title: 'New playlist' })).toBeUndefined();
    });

    it('keeps every real playlist in a page', () => {
        // Dropping a real one is what the SDK forbids: the host reads a short page as the end of
        // the list, so one omitted takes every playlist after it too.
        const rows = [{ item_type: 'endpoint', title: 'New playlist' }, playlist, { ...playlist, id: 'VLPLdef', title: 'Mornings' }];
        expect(mapPlaylists(rows).map(p => p.id)).toEqual(['VLPLabc', 'VLPLdef']);
    });
});
