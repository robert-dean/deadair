import { describe, expect, it } from 'vitest';
import { parseFeedRows } from '../src/rss.feeds.js';

/** The rows as they are stored: a JSON array in a string, which is what a `list` field holds. */
const rows = (...entries: Record<string, string>[]) => JSON.stringify(entries);

describe('parseFeedRows', () => {
    it('takes a bare address and names it after the publisher', () => {
        expect(parseFeedRows(rows({ url: 'https://www.example.com/rss.xml' }))).toEqual([
            { descriptor: { id: 'example-com', name: 'example.com' }, url: 'https://www.example.com/rss.xml' },
        ]);
    });

    it('takes the name the operator gave it, and derives the id from that', () => {
        expect(parseFeedRows(rows({ name: 'World news', url: 'https://example.com/world.xml' }))).toEqual([
            { descriptor: { id: 'world-news', name: 'World news' }, url: 'https://example.com/world.xml' },
        ]);
    });

    it("carries the operator's category through untouched", () => {
        // What it MEANS is the station's business: it is matched against the categories the station
        // holds, and a plugin normalising it would be an opinion about a vocabulary it cannot see.
        expect(parseFeedRows(rows({ name: 'Sport', url: 'https://example.com/sport.xml', category: 'sport' }))).toEqual([
            { descriptor: { id: 'sport', name: 'Sport', category: 'sport' }, url: 'https://example.com/sport.xml' },
        ]);
    });

    it('takes the address off the same cell the host reads for the allowlist', () => {
        // The agreement that matters: a row this accepts and the allowlist does not is a feed on
        // the menu that is refused on every fetch.
        const [feed] = parseFeedRows(rows({ name: 'Sport & Results', url: 'https://example.com/sport.xml', category: 'sport' }));

        expect(feed?.url).toBe('https://example.com/sport.xml');
        expect(new URL(feed?.url ?? '').hostname).toBe('example.com');
    });

    it('drops a row with nothing fetchable in it, and costs only that row', () => {
        const feeds = parseFeedRows(
            rows({ name: 'Empty' }, { url: 'not a url' }, { url: 'file:///etc/passwd' }, { url: 'https://example.com/good.xml' }),
        );

        expect(feeds.map(feed => feed.url)).toEqual(['https://example.com/good.xml']);
    });

    it('keeps two feeds that would have the same id, without renaming the first', () => {
        const feeds = parseFeedRows(
            rows({ name: 'World', url: 'https://one.example.com/w.xml' }, { name: 'World', url: 'https://two.example.com/w.xml' }),
        );

        // Adding a row at the bottom must not rename what is above it: an id is what a model copies
        // back, and a menu that renumbers is a menu that answers the wrong feed.
        expect(feeds.map(feed => feed.descriptor.id)).toEqual(['world', 'world-2']);
    });

    it('reads nothing out of an unconfigured plugin without complaining about it', () => {
        expect(parseFeedRows(undefined)).toEqual([]);
        expect(parseFeedRows('   ')).toEqual([]);
        expect(parseFeedRows('[]')).toEqual([]);
    });

    it('reads nothing out of a value somebody hand-edited into nonsense', () => {
        // Same stakes as everywhere else this value is read: a station that will not load is worse
        // than a plugin with no feeds, and the save path is where an operator is told.
        expect(parseFeedRows('not json')).toEqual([]);
        expect(parseFeedRows('{"url":"https://example.com/rss.xml"}')).toEqual([]);
    });
});
