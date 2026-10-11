import { normalize } from '@deadair/plugin-sdk';

/**
 * How a free-text query becomes Jellyfin searches.
 *
 * Jellyfin's `searchTerm` matches an item's NAME and nothing else, so a search
 * for audio matches track titles only. The station searches with
 * `"<artist> <title>"` (that is what `ProviderTrackLookup` sends for every
 * record it commits), and against a name-only match that string finds nothing
 * at all: measured on 10.11.0, `Song 1` found the track and `Test Artist Song 1`
 * found nothing. So a query is also read as an artist at the front and a title
 * after it, and the artist is looked up so the title can be searched within
 * their tracks.
 *
 * Pure functions, so the reading can be tested without a server.
 */

/** Leading words skipped when choosing the word to look an artist up by. */
const ARTICLES = new Set(['the', 'a', 'an', 'el', 'la', 'las', 'los', 'le', 'les', 'die', 'der', 'das']);

/** A word with the punctuation at either end removed: `Tyler,` is `Tyler`. */
const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * The one word to ask Jellyfin's artist search for, or nothing when the query
 * is a single word and so cannot hold an artist AND a title.
 *
 * The first word, because the station puts the artist first; past a leading
 * article, because "The" matches every band called The Anything and "Beatles"
 * matches the one meant. The artist search is a substring match, so any one word
 * of the name finds it.
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

/**
 * The artists a query starts with, longest name first.
 *
 * Whole words only: "Portishead Roads" starts with Portishead, and "Portis
 * Roads" does not. Longest first because a shorter name that is a prefix of a
 * longer one ("Tyler" and "Tyler, The Creator") is the weaker reading.
 */
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
 * The items whose title contains `rest`, compared in normal form, with exact
 * titles first.
 *
 * Containment rather than equality, so `Roads (Live)` is still a candidate for
 * `roads`: these are candidates, and the station's own lookup scores them
 * strictly before anything is chosen. An exact title is put first because it is
 * the reading the query most likely meant.
 */
export function titleMatches<T extends { Name?: string | null }>(items: readonly T[], rest: string): T[] {
    const wanted = normalize(rest);
    const matched = items.filter(item => normalize(item.Name ?? '').includes(wanted));
    return [...matched.filter(item => normalize(item.Name ?? '') === wanted), ...matched.filter(item => normalize(item.Name ?? '') !== wanted)];
}

/** The longest word of a title, to ask the server for when one page of an artist's tracks is not all of them. */
export function longestWord(rest: string): string | undefined {
    const words = rest.split(/\s+/).filter(word => word.length > 0);
    return words.length === 0 ? undefined : words.reduce((longest, word) => (word.length > longest.length ? word : longest));
}

/** The earliest year a period may name: the same floor the mapping applies to a tagged year. */
const FIRST_YEAR = 1900;

/**
 * A period as the comma-separated list Jellyfin's `Years` filter takes, or
 * `undefined` when no period was asked for.
 *
 * An open end is closed at the floor or at next year, so "1990 onwards" is a
 * finite list. An empty string means the period holds no years at all (the
 * ends cross), and the caller answers nothing rather than searching.
 */
export function yearsFilter(yearFrom: number | undefined, yearTo: number | undefined, now = new Date()): string | undefined {
    if (yearFrom === undefined && yearTo === undefined) return undefined;

    const from = Math.max(Math.floor(yearFrom ?? FIRST_YEAR), FIRST_YEAR);
    const to = Math.min(Math.floor(yearTo ?? now.getUTCFullYear() + 1), now.getUTCFullYear() + 1);
    const years: number[] = [];
    for (let year = from; year <= to; year++) years.push(year);
    return years.join(',');
}
