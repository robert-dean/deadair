import { describe, expect, it } from 'vitest';

import { directorySearchUrl, toDirectoryEntries } from '../src/podcast.directory.js';

/** A result shaped like the iTunes Search API's own, trimmed to the fields that vary. */
const result = (fields: Record<string, unknown> = {}) => ({
    wrapperType: 'track',
    kind: 'podcast',
    collectionId: 1234567890,
    collectionName: 'The Long Wave',
    artistName: 'Long Wave Productions',
    feedUrl: 'https://longwave.example.com/feed.xml',
    collectionViewUrl: 'https://podcasts.apple.com/gb/podcast/the-long-wave/id1234567890',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/100x100bb.jpg',
    artworkUrl600: 'https://is1-ssl.mzstatic.com/600x600bb.jpg',
    genres: ['Documentary', 'Podcasts', 'Society & Culture'],
    collectionExplicitness: 'notExplicit',
    ...fields,
});

describe('directorySearchUrl', () => {
    it('asks for podcasts only, with the words and the limit', () => {
        const url = new URL(directorySearchUrl('long wave radio', 10, ''));

        expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
        expect(url.searchParams.get('media')).toBe('podcast');
        expect(url.searchParams.get('entity')).toBe('podcast');
        expect(url.searchParams.get('term')).toBe('long wave radio');
        expect(url.searchParams.get('limit')).toBe('10');
        expect(url.searchParams.has('country')).toBe(false);
    });

    it('names a store when the operator chose one, and keeps the limit inside what Apple serves', () => {
        const url = new URL(directorySearchUrl('x', 5_000, 'GB'));

        expect(url.searchParams.get('country')).toBe('gb');
        expect(url.searchParams.get('limit')).toBe('200');
    });
});

describe('toDirectoryEntries', () => {
    it('maps a result to an entry somebody could subscribe to', () => {
        expect(toDirectoryEntries({ results: [result()] }, 10)).toEqual([
            {
                id: '1234567890',
                title: 'The Long Wave',
                feedUrl: 'https://longwave.example.com/feed.xml',
                author: 'Long Wave Productions',
                artworkUrl: 'https://is1-ssl.mzstatic.com/600x600bb.jpg',
                homeUrl: 'https://podcasts.apple.com/gb/podcast/the-long-wave/id1234567890',
                categories: ['Documentary', 'Society & Culture'],
                explicit: false,
            },
        ]);
    });

    it('drops a show with no public feed, which Apple lists and nobody can subscribe to', () => {
        expect(toDirectoryEntries({ results: [result({ feedUrl: undefined }), result({ feedUrl: 'ftp://x.example.com/feed' })] }, 10)).toEqual([]);
    });

    it('says explicit only when Apple does, and says nothing when Apple says nothing', () => {
        const [explicit, unmarked] = toDirectoryEntries(
            {
                results: [
                    result({ collectionExplicitness: 'explicit' }),
                    result({ feedUrl: 'https://b.example.com/feed', collectionExplicitness: undefined }),
                ],
            },
            10,
        );

        expect(explicit?.explicit).toBe(true);
        expect(unmarked?.explicit).toBeUndefined();
    });

    it('lists one feed once, and never more than it was asked for', () => {
        const answer = {
            results: [result(), result(), result({ feedUrl: 'https://b.example.com/feed' }), result({ feedUrl: 'https://c.example.com/feed' })],
        };

        expect(toDirectoryEntries(answer, 2).map(entry => entry.feedUrl)).toEqual([
            'https://longwave.example.com/feed.xml',
            'https://b.example.com/feed',
        ]);
    });

    it('answers nothing for an answer that is not one', () => {
        expect(toDirectoryEntries(undefined, 10)).toEqual([]);
        expect(toDirectoryEntries({}, 10)).toEqual([]);
    });
});
