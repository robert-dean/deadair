import { normalize } from '@deadair/plugin-sdk';

/**
 * How a free-text query becomes Plex searches.
 *
 * Plex's title filter matches an item's own title, a word at a time and without
 * regard to punctuation (measured on 1.43.4: `mr brightside` finds `Mr.
 * Brightside`, `ong` finds nothing). So a track search matches track titles
 * only, and the station searches with `"<artist> <title>"` (that is what
 * `ProviderTrackLookup` sends for every record it commits), which matched
 * nothing. A query is therefore also read as an artist at the front and a title
 * after it: the artist is looked up, their tracks are read, and the titles are
 * compared here in the SDK's normal form.
 *
 * The same reading the Jellyfin plugin makes of the same problem. Pure
 * functions, so it can be tested without a server.
 */

/** Leading words skipped when choosing the word to look an artist up by. */
const ARTICLES = new Set(['the', 'a', 'an', 'el', 'la', 'las', 'los', 'le', 'les', 'die', 'der', 'das']);

/** A word with the punctuation at either end removed: `Tyler,` is `Tyler`. */
const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * The one word to look an artist up by, or nothing when the query is a single
 * word and so cannot hold an artist AND a title. The first word, past a leading
 * article: "The" matches every band called The Anything.
 */
export function artistProbe(query: string): string | undefined {
    const words = query
        .trim()
        .split(/\s+/)
        .map(bare)
        .filter(word => word.length > 0);
    if (words.length < 2) return undefined;

    const first = words[0]!;
    if (ARTICLES.has(first.toLowerCase()) && words.length > 2) return words[1];
    return first;
}

/** An artist the query starts with, and what is left of the query after their name. */
export interface ArtistReading {
    id: string;
    /** The title part, in comparison form. Empty when the whole query was the artist's name. */
    rest: string;
}

/** The artists a query starts with, whole words only, longest name first. */
export function artistReadings(query: string, artists: readonly { id: string; name: string }[]): ArtistReading[] {
    const wanted = normalize(query);
    const readings: (ArtistReading & { length: number })[] = [];

    for (const artist of artists) {
        const name = normalize(artist.name);
        if (!name) continue;
        if (wanted === name) readings.push({ id: artist.id, rest: '', length: name.length });
        else if (wanted.startsWith(`${name} `)) readings.push({ id: artist.id, rest: wanted.slice(name.length + 1), length: name.length });
    }

    return readings.sort((left, right) => right.length - left.length).map(({ id, rest }) => ({ id, rest }));
}

/**
 * The items whose title contains `rest`, compared in normal form, exact titles
 * first. Containment rather than equality, so `Roads (Live)` is still a
 * candidate for `roads`: the station's own lookup scores candidates strictly.
 */
export function titleMatches<T extends { title?: string }>(items: readonly T[], rest: string): T[] {
    const wanted = normalize(rest);
    const matched = items.filter(item => normalize(item.title ?? '').includes(wanted));
    return [...matched.filter(item => normalize(item.title ?? '') === wanted), ...matched.filter(item => normalize(item.title ?? '') !== wanted)];
}

/** Whether a year falls in a period. An unknown year falls in none: a period was asked for and this record cannot show it belongs. */
export function inPeriod(year: number | undefined, yearFrom: number | undefined, yearTo: number | undefined): boolean {
    if (yearFrom === undefined && yearTo === undefined) return true;
    if (year === undefined) return false;
    return (yearFrom === undefined || year >= yearFrom) && (yearTo === undefined || year <= yearTo);
}
