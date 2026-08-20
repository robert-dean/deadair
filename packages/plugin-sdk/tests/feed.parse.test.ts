import { describe, expect, it, vi } from 'vitest';
import { FEED_SUMMARY_MAX_CHARS, fetchFeed, parseFeed } from '../src/feed.parse.js';
import { PluginError } from '../src/plugin.error.js';
import type { PluginHost } from '../src/plugin.host.js';

/**
 * Against documents shaped like the real thing rather than minimal ones, because
 * every bug this file exists to prevent is a field that is optional in the spec
 * and present everywhere in practice: a title with a `type` attribute, a link
 * that is an attribute, a date in a format the other two formats never use.
 */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel>
        <title>Example News</title>
        <link>https://example.com</link>
        <description>Everything that happened</description>
        <item>
            <title>Bridge reopens after four years</title>
            <link>https://example.com/bridge</link>
            <guid isPermaLink="false">urn:example:1</guid>
            <pubDate>Tue, 03 Jun 2008 11:05:30 GMT</pubDate>
            <description><![CDATA[<p>The crossing reopened <b>this morning</b> &amp; traffic is moving.</p>]]></description>
            <category>Local</category>
            <category>Transport</category>
            <dc:creator>A Reporter</dc:creator>
        </item>
        <item>
            <title>Second story</title>
            <link>https://example.com/second</link>
            <content:encoded><![CDATA[<p>Only the full article was published.</p>]]></content:encoded>
        </item>
    </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Example Atom</title>
    <link href="https://example.org/" rel="alternate"/>
    <link href="https://example.org/feed.xml" rel="self"/>
    <entry>
        <title type="html">Council votes &amp; adjourns</title>
        <id>tag:example.org,2026:1</id>
        <link rel="self" href="https://example.org/feed.xml"/>
        <link rel="alternate" href="https://example.org/council"/>
        <published>2026-01-02T03:04:05Z</published>
        <summary>A short summary.</summary>
        <author><name>R. Writer</name></author>
        <category term="politics"/>
    </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel rdf:about="https://old.example.net/">
        <title>Example RDF</title>
        <link>https://old.example.net/</link>
    </channel>
    <item rdf:about="https://old.example.net/one">
        <title>An older format</title>
        <link>https://old.example.net/one</link>
        <dc:date>2026-02-03T10:00:00+00:00</dc:date>
    </item>
</rdf:RDF>`;

describe('parseFeed', () => {
    it('reads an RSS 2.0 document', () => {
        const feed = parseFeed(RSS);

        expect(feed.title).toBe('Example News');
        expect(feed.homeUrl).toBe('https://example.com');
        expect(feed.items).toHaveLength(2);

        const [first] = feed.items;
        expect(first).toMatchObject({
            id: 'urn:example:1',
            title: 'Bridge reopens after four years',
            url: 'https://example.com/bridge',
            publishedAt: '2008-06-03T11:05:30.000Z',
            author: 'A Reporter',
            categories: ['Local', 'Transport'],
        });
    });

    it('strips markup and decodes entities out of a CDATA description', () => {
        const [first] = parseFeed(RSS).items;

        expect(first?.summary).toBe('The crossing reopened this morning & traffic is moving.');
    });

    it('decodes a title a publisher escaped twice, because a voice would read the entity out', () => {
        // Measured on a real feed: `it&amp;#8217;s` in the document is `it&#8217;s` once the XML
        // parser has done its one pass, and a bulletin read that out on air. Titles get the same
        // treatment summaries already got, which is what fixes it.
        const doubled = RSS.replace('Bridge reopens after four years', 'Framework says it&amp;#8217;s fixing a BIOS update');
        const [first] = parseFeed(doubled).items;

        expect(first?.title).toBe('Framework says it’s fixing a BIOS update');
    });

    it('takes the markup out of a title as well, since `type="html"` on one is ordinary', () => {
        // Escaped in the document, which is how a title carries markup at all: the XML parser
        // hands back the tag and this is what keeps a `<em>` out of a speaking voice.
        const marked = RSS.replace('Bridge reopens after four years', 'Bridge reopens &lt;em&gt;at last&lt;/em&gt;');
        const [first] = parseFeed(marked).items;

        expect(first?.title).toBe('Bridge reopens at last');
    });

    it('falls back to the full article when there is no teaser', () => {
        const [, second] = parseFeed(RSS).items;

        expect(second?.summary).toBe('Only the full article was published.');
    });

    it('reads an Atom document, including a title carrying an attribute', () => {
        const feed = parseFeed(ATOM);

        expect(feed.title).toBe('Example Atom');
        // `rel="self"` is the feed itself; a reader linking a listener there sends them to the XML.
        expect(feed.homeUrl).toBe('https://example.org/');
        expect(feed.items[0]).toMatchObject({
            id: 'tag:example.org,2026:1',
            title: 'Council votes & adjourns',
            url: 'https://example.org/council',
            publishedAt: '2026-01-02T03:04:05.000Z',
            author: 'R. Writer',
            categories: ['politics'],
        });
    });

    it('reads an RDF document, whose items are siblings of its channel', () => {
        const feed = parseFeed(RDF);

        expect(feed.title).toBe('Example RDF');
        expect(feed.items).toHaveLength(1);
        expect(feed.items[0]).toMatchObject({ title: 'An older format', publishedAt: '2026-02-03T10:00:00.000Z' });
    });

    it('gives an item with no guid a stable id rather than a positional one', () => {
        const first = parseFeed(RSS).items[1]?.id;
        const again = parseFeed(RSS).items[1]?.id;

        expect(first).toBe(again);
        // The link is the next rung of the ladder, and it is stable where a hash of the words is not.
        expect(first).toBe('https://example.com/second');
    });

    it('hashes the title and date when the feed supplies no identifier at all', () => {
        const bare = `<rss><channel><item><title>No id anywhere</title><pubDate>Tue, 03 Jun 2008 11:05:30 GMT</pubDate></item></channel></rss>`;

        const once = parseFeed(bare).items[0]?.id;
        expect(once).toMatch(/^hash:[0-9a-f]{8}$/);
        expect(parseFeed(bare).items[0]?.id).toBe(once);
    });

    it('drops an item with no title rather than airing a pause', () => {
        const partial = `<rss><channel><item><link>https://example.com/a</link></item><item><title>Kept</title></item></channel></rss>`;

        expect(parseFeed(partial).items.map(item => item.title)).toEqual(['Kept']);
    });

    it('leaves an unreadable date absent rather than guessing at an epoch', () => {
        const undated = `<rss><channel><item><title>When?</title><pubDate>last Thursday</pubDate></item></channel></rss>`;

        expect(parseFeed(undated).items[0]?.publishedAt).toBeUndefined();
    });

    it('caps a long summary at a word boundary', () => {
        const long = `word `.repeat(400);
        const wordy = `<rss><channel><item><title>Long</title><description>${long}</description></item></channel></rss>`;

        const summary = parseFeed(wordy).items[0]?.summary ?? '';
        expect(summary.length).toBeLessThanOrEqual(FEED_SUMMARY_MAX_CHARS + 1);
        expect(summary.endsWith('…')).toBe(true);
        expect(summary).not.toContain('wor…');
    });

    it('answers with no items for anything that is not a feed', () => {
        expect(parseFeed('<html><body>Not a feed</body></html>').items).toEqual([]);
        expect(parseFeed('').items).toEqual([]);
        expect(parseFeed('<rss><channel><item><title>Truncated').items).toBeInstanceOf(Array);
    });
});

/** Enough of a host to answer one request. The rest of the interface is never reached here. */
const hostAnswering = (response: Response): PluginHost => ({ fetch: vi.fn(async () => response) }) as unknown as PluginHost;

describe('fetchFeed', () => {
    it('parses what the upstream sent', async () => {
        const feed = await fetchFeed(hostAnswering(new Response(RSS, { status: 200 })), 'https://example.com/feed.xml');

        expect(feed.items).toHaveLength(2);
    });

    it('throws a classified PluginError on a bad status, carrying the upstream advice', async () => {
        const response = new Response('slow down', { status: 429, headers: { 'retry-after': '30' } });

        await expect(fetchFeed(hostAnswering(response), 'https://example.com/feed.xml')).rejects.toMatchObject({
            code: 'rate_limited',
            retryable: true,
            retryAfterMs: 30_000,
            upstreamStatus: 429,
        });
    });

    it('reports a missing feed as not_found rather than as the plugin being sick', async () => {
        const failed = await fetchFeed(hostAnswering(new Response('gone', { status: 404 })), 'https://example.com/feed.xml').catch(error => error);

        expect(failed).toBeInstanceOf(PluginError);
        expect(failed.code).toBe('not_found');
    });
});
