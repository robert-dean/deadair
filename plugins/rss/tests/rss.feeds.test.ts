import { describe, expect, it } from 'vitest';
import { parseFeedLines } from '../src/rss.feeds.js';

describe('parseFeedLines', () => {
    it('takes a bare address and names it after the publisher', () => {
        expect(parseFeedLines('https://www.example.com/rss.xml')).toEqual([
            { descriptor: { id: 'example-com', name: 'example.com' }, url: 'https://www.example.com/rss.xml' },
        ]);
    });

    it('takes a name in front of the address', () => {
        expect(parseFeedLines('World news|https://example.com/world.xml')).toEqual([
            { descriptor: { id: 'world-news', name: 'World news' }, url: 'https://example.com/world.xml' },
        ]);
    });

    it('takes an id and a name, so the DJ has something short to ask for', () => {
        expect(parseFeedLines('world|World news|https://example.com/world.xml')).toEqual([
            { descriptor: { id: 'world', name: 'World news' }, url: 'https://example.com/world.xml' },
        ]);
    });

    it('reads the address as the last field, which is how the host reads the same setting', () => {
        // The agreement that matters: a line this accepts and the allowlist does
        // not is a feed on the menu that is refused on every fetch.
        const [feed] = parseFeedLines('sport|Sport & Results|https://example.com/sport.xml');

        expect(feed?.url).toBe('https://example.com/sport.xml');
        expect(new URL(feed?.url ?? '').hostname).toBe('example.com');
    });

    it('drops blank lines, comments and anything that is not an http address', () => {
        const feeds = parseFeedLines(['', '# my feeds', 'not a url', 'file:///etc/passwd', 'https://example.com/good.xml'].join('\n'));

        expect(feeds.map(feed => feed.url)).toEqual(['https://example.com/good.xml']);
    });

    it('keeps two feeds that would have the same id, without renaming the first', () => {
        const feeds = parseFeedLines(['world|World|https://one.example.com/w.xml', 'world|World|https://two.example.com/w.xml'].join('\n'));

        // Adding a line at the bottom must not rename what is above it: an id is
        // what a model copies back, and a menu that renumbers is a menu that
        // answers the wrong feed.
        expect(feeds.map(feed => feed.descriptor.id)).toEqual(['world', 'world-2']);
    });

    it('reads nothing out of an unconfigured plugin without complaining about it', () => {
        expect(parseFeedLines(undefined)).toEqual([]);
        expect(parseFeedLines('   ')).toEqual([]);
    });
});
