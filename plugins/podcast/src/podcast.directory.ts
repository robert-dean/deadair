import { plainText, type PodcastDirectoryEntry } from '@deadair/plugin-sdk';

/**
 * Apple's podcast directory, as {@link PodcastDirectoryEntry} rows.
 *
 * The iTunes Search API rather than anything with a key: it is public, it needs no account, and every
 * result carries the one thing subscribing needs, the show's `feedUrl`. PodcastIndex is the other
 * directory worth having and needs a key and a secret, which is a second provider for the day
 * somebody wants it rather than a reason to make this one harder to switch on.
 *
 * Pure, and separate from the plugin, so the mapping is tested against a real answer's shape with no
 * host in the way.
 */

/** The address a search is sent to, with the words and the limit in the query. */
export function directorySearchUrl(query: string, limit: number, country: string): string {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('media', 'podcast');
    url.searchParams.set('entity', 'podcast');
    url.searchParams.set('term', query);
    // Apple's own ceiling on one page is 200; asking for more is not refused, it is ignored.
    url.searchParams.set('limit', String(Math.min(Math.max(1, Math.floor(limit)), 200)));
    if (country.length > 0) url.searchParams.set('country', country.toLowerCase());

    return url.toString();
}

/** The part of an iTunes Search answer this reads. Everything is optional, because all of it is theirs. */
export interface ItunesSearchAnswer {
    results?: ItunesPodcast[];
}

export interface ItunesPodcast {
    collectionId?: number;
    collectionName?: string;
    artistName?: string;
    feedUrl?: string;
    collectionViewUrl?: string;
    artworkUrl600?: string;
    artworkUrl100?: string;
    genres?: string[];
    /** `explicit`, `notExplicit` or `cleaned`, the three words Apple uses. */
    collectionExplicitness?: string;
}

/**
 * An answer, as directory entries.
 *
 * A result with no feed address is dropped rather than shown: Apple lists shows it distributes itself
 * (its own subscriptions, some exclusives) with no public feed, and an entry nobody can subscribe to is
 * not a result. `Podcasts`, which Apple puts in every genre list, is dropped from the categories for the
 * same reason a news feed's `Deals` label is noise: it says nothing about THIS show.
 */
export function toDirectoryEntries(answer: ItunesSearchAnswer | undefined, limit: number): PodcastDirectoryEntry[] {
    const entries: PodcastDirectoryEntry[] = [];
    const seen = new Set<string>();

    for (const result of answer?.results ?? []) {
        const feedUrl = webAddress(result.feedUrl);
        const title = result.collectionName === undefined ? undefined : plainText(result.collectionName);
        if (feedUrl === undefined || title === undefined || title.length === 0 || seen.has(feedUrl)) continue;
        seen.add(feedUrl);

        const entry: PodcastDirectoryEntry = { id: String(result.collectionId ?? feedUrl), title, feedUrl };

        const author = result.artistName?.trim();
        if (author) entry.author = author;

        const artworkUrl = webAddress(result.artworkUrl600) ?? webAddress(result.artworkUrl100);
        if (artworkUrl !== undefined) entry.artworkUrl = artworkUrl;

        const homeUrl = webAddress(result.collectionViewUrl);
        if (homeUrl !== undefined) entry.homeUrl = homeUrl;

        const categories = (result.genres ?? []).map(genre => genre.trim()).filter(genre => genre.length > 0 && genre !== 'Podcasts');
        if (categories.length > 0) entry.categories = categories;

        if (result.collectionExplicitness === 'explicit') entry.explicit = true;
        else if (result.collectionExplicitness === 'notExplicit' || result.collectionExplicitness === 'cleaned') entry.explicit = false;

        entries.push(entry);
        if (entries.length >= limit) break;
    }

    return entries;
}

/** An http(s) address, or nothing. Anything this hands on is fetched by somebody else. */
function webAddress(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    try {
        const { protocol } = new URL(raw.trim());
        return protocol === 'http:' || protocol === 'https:' ? raw.trim() : undefined;
    } catch {
        return undefined;
    }
}
