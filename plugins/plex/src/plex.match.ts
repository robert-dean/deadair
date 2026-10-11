import { baseForm, normalize } from '@deadair/plugin-sdk';

import type { PlexMetadata } from './plex.types.js';

/**
 * Deciding whether a search result is the track, artist or record that was
 * asked about, for enrichment.
 *
 * Deliberately conservative. A wrong answer here is worse than no answer: the
 * host records a miss on a short clock and asks again, whereas a confident
 * mismatch is stored and read out on air.
 */

/** How well a candidate agrees with what was asked for. */
type Agreement = 'exact' | 'base' | 'none';

function agree(candidate: string | undefined, reference: string): Agreement {
    if (!candidate) return 'none';
    if (normalize(candidate) === normalize(reference)) return 'exact';
    if (baseForm(candidate) === baseForm(reference)) return 'base';
    return 'none';
}

/** What the caller knows about the track it is asking about. */
export interface MatchRef {
    artist: string;
    title: string;
    album?: string;
}

/**
 * The best track for `ref`, or nothing when none is convincing.
 *
 * Artist and title must both agree, exactly or in base form. The artist is the
 * track's own (`originalTitle`) or its album's, since a compilation credits the
 * one and an ordinary album only the other. An album match only breaks a tie
 * between candidates that already agree: that is what picks the album track
 * over the greatest-hits copy of it.
 */
export function selectTrack(items: readonly PlexMetadata[], ref: MatchRef): PlexMetadata | undefined {
    let best: { item: PlexMetadata; score: number } | undefined;

    for (const item of items) {
        if (!item.ratingKey || item.type !== 'track') continue;

        const title = agree(item.title, ref.title);
        const own = agree(item.originalTitle, ref.artist);
        const artist = own !== 'none' ? own : agree(item.grandparentTitle, ref.artist);
        if (title === 'none' || artist === 'none') continue;

        const score =
            (title === 'exact' ? 4 : 0) + (artist === 'exact' ? 2 : 0) + (ref.album && agree(item.parentTitle, ref.album) !== 'none' ? 1 : 0);
        if (!best || score > best.score) best = { item, score };
    }

    return best?.item;
}

/**
 * The artist by that name, or by that MusicBrainz id when one is known. An id
 * match wins outright: two artists can share a name, and the id is the one thing
 * that cannot be shared.
 */
export function selectArtist(
    items: readonly PlexMetadata[],
    name: string,
    mbid: string | undefined,
    idOf: (item: PlexMetadata) => string | undefined,
): PlexMetadata | undefined {
    const artists = items.filter(item => item.ratingKey && item.type === 'artist');
    if (mbid) {
        const byId = artists.find(item => idOf(item) === mbid.toLowerCase());
        if (byId) return byId;
    }
    const wanted = normalize(name);
    // A namesake with a DIFFERENT id is somebody else, however well the name matches.
    const named = artists.filter(item => normalize(item.title ?? '') === wanted && !(mbid && idOf(item) && idOf(item) !== mbid.toLowerCase()));
    // Two artists answering to one name and no id to tell them apart: neither is safe to describe.
    return named.length === 1 ? named[0] : undefined;
}

/** The record with that title by that artist, decorations aside on the title. */
export function selectAlbum(items: readonly PlexMetadata[], name: string, artist: string): PlexMetadata | undefined {
    const wantedName = baseForm(name);
    const wantedArtist = normalize(artist);
    const matches = items.filter(
        item =>
            item.ratingKey &&
            item.type === 'album' &&
            baseForm(item.title ?? '') === wantedName &&
            normalize(item.parentTitle ?? '') === wantedArtist,
    );
    return matches.find(item => normalize(item.title ?? '') === normalize(name)) ?? matches[0];
}
