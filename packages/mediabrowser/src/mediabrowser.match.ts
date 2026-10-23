import { baseForm, normalize } from '@deadair/plugin-sdk';

import { providerId } from './mediabrowser.enrichment.js';
import type { MediaBrowserItem } from './mediabrowser.types.js';

/**
 * Deciding whether a result is the track, artist or record that was asked
 * about, for enrichment.
 *
 * Deliberately conservative: a near miss is no answer, which the host asks
 * about again later, where a confident mismatch is stored and read out on air.
 * A MusicBrainz id, when both sides have one, outranks every name: equal ids
 * settle it, and different ids rule a candidate out however well it is named.
 * Neither server can be asked for an id directly, so the id is checked here, on
 * candidates found by name. Measured: Jellyfin 10.11.0 ignores
 * `AnyProviderIdEquals` and answers the whole library, and Emby 4.10.1 answers
 * nothing even for an id a track carried.
 */

type Agreement = 'exact' | 'base' | 'none';

function agree(candidate: string | null | undefined, reference: string): Agreement {
    if (!candidate) return 'none';
    if (normalize(candidate) === normalize(reference)) return 'exact';
    if (baseForm(candidate) === baseForm(reference)) return 'base';
    return 'none';
}

/** Whether a candidate's id rules it out: both sides have one and they differ. */
const otherId = (candidate: string | undefined, wanted: string | undefined): boolean =>
    wanted !== undefined && candidate !== undefined && candidate !== wanted.toLowerCase();

/** What the caller knows about the track it is asking about. */
export interface MatchRef {
    artist: string;
    title: string;
    album?: string;
    /** A MusicBrainz recording id. */
    mbid?: string;
}

/**
 * The best track for `ref`, or nothing when none is convincing. Artist and
 * title must both agree, exactly or in base form, against any credited artist;
 * an album match only breaks a tie.
 */
export function selectTrack(items: readonly MediaBrowserItem[], ref: MatchRef): MediaBrowserItem | undefined {
    let best: { item: MediaBrowserItem; score: number } | undefined;

    for (const item of items) {
        if (!item.Id || item.Type !== 'Audio') continue;
        const recording = providerId(item, 'MusicBrainzRecording');
        if (otherId(recording, ref.mbid)) continue;

        const title = agree(item.Name, ref.title);
        const credits = [...(item.Artists ?? []), item.AlbumArtist].map(name => agree(name, ref.artist));
        const artist = credits.includes('exact') ? 'exact' : credits.includes('base') ? 'base' : 'none';
        if (title === 'none' || artist === 'none') continue;

        const score =
            (ref.mbid !== undefined && recording !== undefined ? 8 : 0) +
            (title === 'exact' ? 4 : 0) +
            (artist === 'exact' ? 2 : 0) +
            (ref.album && agree(item.Album, ref.album) !== 'none' ? 1 : 0);
        if (!best || score > best.score) best = { item, score };
    }

    return best?.item;
}

/**
 * The artist the name and id describe. An id match wins outright; a namesake
 * with a different id is somebody else; two namesakes with no id to tell them
 * apart are both refused.
 */
export function selectArtist(items: readonly MediaBrowserItem[], name: string, mbid: string | undefined): MediaBrowserItem | undefined {
    const artists = items.filter(item => item.Id && item.Type === 'MusicArtist');
    if (mbid) {
        const byId = artists.find(item => providerId(item, 'MusicBrainzArtist') === mbid.toLowerCase());
        if (byId) return byId;
    }
    const wanted = normalize(name);
    const named = artists.filter(item => normalize(item.Name ?? '') === wanted && !otherId(providerId(item, 'MusicBrainzArtist'), mbid));
    return named.length === 1 ? named[0] : undefined;
}

/**
 * The record with that title, decorations aside, among one artist's records.
 * A release-group id, when both sides have one, settles it the same way.
 */
export function selectAlbum(items: readonly MediaBrowserItem[], name: string, mbid: string | undefined): MediaBrowserItem | undefined {
    const albums = items.filter(item => item.Id && item.Type === 'MusicAlbum' && !otherId(providerId(item, 'MusicBrainzReleaseGroup'), mbid));
    if (mbid) {
        const byId = albums.find(item => providerId(item, 'MusicBrainzReleaseGroup') === mbid.toLowerCase());
        if (byId) return byId;
    }
    const matches = albums.filter(item => baseForm(item.Name ?? '') === baseForm(name));
    return matches.find(item => normalize(item.Name ?? '') === normalize(name)) ?? matches[0];
}
