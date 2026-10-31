import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { isLiveRecording } from './live.version.js';

/**
 * Whether an album a record carries is a collection rather than the release the record came from.
 *
 * A record keeps the album it was first ingested from (`shared/release.year.ts`), so a song first met
 * on a best-of airs with "from The Very Best Of ..." in front of the writer, and the presenter says
 * it. Nothing marks a compilation: no provider sends a release type, and `deadair.albums.artist_id` is
 * the LEAD of whichever track created the row (`CatalogResolverService.ingestTrack`), so there is no
 * album-level artist either. A various-artists release becomes one album row per artist on it, all
 * with one `name_key`. That leaves three readings, all of them evidence rather than fact:
 *
 * - the record's own credit, the one place a "Various Artists" can survive ingest;
 * - the title saying so, {@link namesACollection};
 * - several artists under one title in the catalog, {@link maySpanArtists} and
 *   {@link SEVERAL_ARTISTS}, read by `CandidatesRepository.albumTitlesAcrossArtists`.
 *
 * **Misses are the side to err on**, as in `live.version.ts`. A miss is a presenter naming a
 * compilation, which is where this started. A false hit loses a true fact about a real album with
 * nothing on air to say why.
 */

/** A record filed under a compiler's credit rather than a performer's. */
const VARIOUS_ARTISTS = /^(?:various(?: artists)?|v\.?\/?a\.?)$/i;

/**
 * The wordings that say a release is a collection. Each is narrower than its word, because the word
 * alone is a real album too:
 *
 * - "best of" leaves out "The Best of Both Worlds", "Best of Times", "The Best of Me" and the like;
 * - "essential" counts opening on "The Essential" or closing on "Essentials", never "Essential Tremors";
 * - "collection" counts alone or after a word that sells one, never "Private Collection".
 */
const COLLECTION_WORDING = [
    /\bgreatest hits\b/i,
    /\bbest of\b(?! (?:both|times|you|me|us)\b)/i,
    /\bthe very best\b/i,
    /^the essential\b/i,
    /\bessentials$/i,
    /\banthology\b/i,
    /^(?:the )?collection$/i,
    /\b(?:the|ultimate|definitive|complete|platinum|gold|singles|hits) collection\b/i,
    /\bnow that'?s what i call\b/i,
];

/**
 * How many different artists one album title takes before it reads as a compilation.
 *
 * Three rather than two because two is two bands with the same idea: "Blue", "Back Home", "Heart".
 */
export const SEVERAL_ARTISTS = 3;

/** Whether a record's credit is a compiler's rather than a performer's. */
export function isVariousArtists(artist: string): boolean {
    return VARIOUS_ARTISTS.test(artist.trim());
}

/** Whether an album's own title says it is a collection. Curly apostrophes count as straight ones. */
export function namesACollection(album: string): boolean {
    const name = album.trim().replaceAll('’', "'");
    return COLLECTION_WORDING.some(pattern => pattern.test(name));
}

/**
 * Whether a title shared by {@link SEVERAL_ARTISTS} would mean anything, so is worth asking about.
 *
 * Not a one-word title, where a shared name is coincidence ("Love", "Gold", "Home"), and not a live
 * album, where it is the format: "MTV Unplugged", "Live in Paris" and "Live at Budokan" are each a
 * real record by everybody who made one.
 */
export function maySpanArtists(album: string): boolean {
    return normalizeKey(album).split(' ').length >= 2 && !isLiveRecording('', album);
}
