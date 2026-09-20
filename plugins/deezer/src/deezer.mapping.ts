import type { ArtistTrack, SimilarArtist } from '@deadair/plugin-sdk';

import type { DeezerArtist, DeezerTrack } from './deezer.types.js';

/**
 * One artist name reduced to what two spellings of the same act have in common.
 *
 * Case and accents only. Punctuation is deliberately left alone: "AC/DC" and
 * "ACDC" are different strings to every other part of the station, and a
 * normaliser here that was looser than the one the pick path uses would accept
 * a match the host then fails to find.
 */
export function normalizeName(name: string): string {
    return name
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * The searched-for artist among the results, or nothing.
 *
 * STRICT, and that is the whole judgement in this file. Deezer's search is
 * fuzzy and ranks by popularity, so a name it does not carry returns the
 * nearest famous act instead: asking for a small synthwave producer and taking
 * `data[0]` yields a stadium band, and every neighbour after that is drawn from
 * the wrong scene. Nothing downstream could tell — the names would all resolve,
 * the records would all play, and the hour would simply be wrong. So an exact
 * normalised match or nothing.
 */
export function exactArtist(results: DeezerArtist[], wanted: string): DeezerArtist | undefined {
    const target = normalizeName(wanted);
    if (target.length === 0) return undefined;

    return results.find(artist => {
        const name = artist.name?.trim();
        return artist.id !== undefined && name !== undefined && normalizeName(name) === target;
    });
}

/**
 * Deezer's neighbours as the host's shape.
 *
 * No `match`: Deezer returns `related` as an ordered list and publishes no
 * score, and inventing one from the position would be a number the host is
 * entitled to compare against a real one. Order carries the ranking, which is
 * exactly what {@link SimilarArtist.match} is documented to be a hint about.
 *
 * `providerRef` is Deezer's own artist id, handed back per the capability so a
 * later question about the same artist could be a lookup rather than another
 * search. Nothing in the host forwards it today; it costs one field to be ready
 * for the version that does.
 */
export function toSimilarArtists(artists: DeezerArtist[]): SimilarArtist[] {
    const found: SimilarArtist[] = [];

    for (const artist of artists) {
        const name = artist.name?.trim();
        if (!name) continue;

        found.push({
            name,
            ...(artist.id === undefined ? {} : { providerRef: String(artist.id) }),
        });
    }

    return found;
}

/**
 * Deezer's records as the host's shape.
 *
 * `artist.name` is the LEAD and `contributors` is the full credit. Only the
 * lead is carried, because everything downstream — the repeat window, the
 * artist cooldown, the provider lookup, `play_history` — matches a record on
 * its lead artist alone, so a joined credit line is a record named correctly
 * and then dropped as one nothing can find.
 *
 * A record with no artist of its own is skipped rather than being given the
 * artist that was asked about: on a compilation or a guest spot that would name
 * a record by the wrong act.
 */
export function toArtistTracks(tracks: DeezerTrack[]): ArtistTrack[] {
    const found: ArtistTrack[] = [];

    for (const track of tracks) {
        const title = track.title?.trim();
        const artist = track.artist?.name?.trim();
        if (!title || !artist) continue;

        const album = track.album?.title?.trim();
        found.push({ title, artist, ...(album ? { album } : {}) });
    }

    return found;
}
