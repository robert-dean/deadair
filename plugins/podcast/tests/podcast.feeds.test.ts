import { describe, expect, it } from 'vitest';

import { parsePodcastRows, showIdFor } from '../src/podcast.feeds.js';

/** The rows as they are stored, which is the JSON array a `list` config field holds. */
const rows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

describe('parsePodcastRows', () => {
    it('reads a row with a name and a feed', () => {
        const [show] = parsePodcastRows(rows({ name: 'The Long Wave', url: 'https://longwave.example.com/feed.xml' }));

        expect(show).toEqual({
            id: showIdFor('https://longwave.example.com/feed.xml'),
            name: 'The Long Wave',
            url: 'https://longwave.example.com/feed.xml',
        });
    });

    it('leaves the name absent rather than inventing one, so the feed can say what it is called', () => {
        expect(parsePodcastRows(rows({ url: 'https://longwave.example.com/feed.xml' }))[0]?.name).toBeUndefined();
    });

    it('drops a row nothing could fetch, and only that row', () => {
        const shows = parsePodcastRows(rows({ url: 'file:///tmp/feed.xml' }, { url: 'not an address' }, { url: 'https://ok.example.com/feed.xml' }));

        expect(shows.map(show => show.url)).toEqual(['https://ok.example.com/feed.xml']);
    });

    it('carries one feed once, however many rows name it', () => {
        const shows = parsePodcastRows(
            rows({ name: 'First', url: 'https://a.example.com/feed.xml' }, { name: 'Second', url: 'https://a.example.com/feed.xml' }),
        );

        expect(shows).toHaveLength(1);
        expect(shows[0]?.name).toBe('First');
    });

    it('answers nothing for a value that is not a list', () => {
        expect(parsePodcastRows(undefined)).toEqual([]);
        expect(parsePodcastRows('')).toEqual([]);
        expect(parsePodcastRows('{"url":"https://a.example.com"}')).toEqual([]);
    });
});

describe('showIdFor', () => {
    // The station keeps every episode it fetched and aired under this id, and a clock band names a
    // show by it. So it has to survive a rename and a reorder, which are the two things an operator
    // does to a row without meaning to replace the subscription.
    it('survives a rename and a reorder', () => {
        const before = parsePodcastRows(rows({ name: 'Old name', url: 'https://a.example.com/feed.xml' }, { url: 'https://b.example.com/feed.xml' }));
        const after = parsePodcastRows(rows({ url: 'https://b.example.com/feed.xml' }, { name: 'New name', url: 'https://a.example.com/feed.xml' }));

        expect(after.find(show => show.url === 'https://a.example.com/feed.xml')?.id).toBe(before[0]?.id);
    });

    it('is a different show for a different feed', () => {
        expect(showIdFor('https://a.example.com/feed.xml')).not.toBe(showIdFor('https://b.example.com/feed.xml'));
    });

    it('is short and plain, since it ends up in a table an operator reads', () => {
        expect(showIdFor('https://a.example.com/feed.xml')).toMatch(/^[0-9a-f]{8}$/);
    });
});
