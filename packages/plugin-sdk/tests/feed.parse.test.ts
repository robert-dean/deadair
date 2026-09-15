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

/**
 * A podcast feed shaped like the ones the big hosts actually serve: RSS 2.0 with the iTunes
 * namespace, both kinds of channel image, nested iTunes categories, an Atom self link inside an item,
 * a cover attached as a second enclosure, and a `length="0"` nobody filled in.
 */
const PODCAST = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>The Long Wave</title>
        <link>https://longwave.example.com</link>
        <language>en-gb</language>
        <description><![CDATA[<p>Conversations about <b>radio</b> &amp; the people who make it.</p>]]></description>
        <itunes:author>Long Wave Productions</itunes:author>
        <itunes:explicit>false</itunes:explicit>
        <image><url>https://longwave.example.com/banner.png</url><title>The Long Wave</title></image>
        <itunes:image href="https://cdn.example.com/square.jpg"/>
        <itunes:category text="Society &amp; Culture">
            <itunes:category text="Documentary"/>
        </itunes:category>
        <itunes:category text="Arts"/>
        <item>
            <title>Episode 12: The night shift</title>
            <link>https://longwave.example.com/12</link>
            <guid isPermaLink="false">longwave-12</guid>
            <pubDate>Mon, 14 Sep 2026 06:00:00 GMT</pubDate>
            <description>Who is awake at 3am, and why they listen.</description>
            <atom:link rel="self" href="https://longwave.example.com/feed.xml"/>
            <enclosure url="https://cdn.example.com/12-cover.jpg" type="image/jpeg" length="40213"/>
            <enclosure url="https://cdn.example.com/12.mp3" type="Audio/MPEG" length="0"/>
            <itunes:duration>1:02:03</itunes:duration>
            <itunes:image href="https://cdn.example.com/12.jpg"/>
            <itunes:explicit>yes</itunes:explicit>
            <itunes:season>2</itunes:season>
            <itunes:episode>12</itunes:episode>
        </item>
        <item>
            <title>Episode 11: Static</title>
            <guid>longwave-11</guid>
            <enclosure url="https://cdn.example.com/11.m4a" type="audio/x-m4a" length="55102934"/>
            <itunes:duration>3725</itunes:duration>
        </item>
        <item>
            <title>A trailer with nowhere to fetch it from</title>
            <guid>longwave-trailer</guid>
            <enclosure url="file:///Users/producer/trailer.mp3" type="audio/mpeg"/>
            <itunes:duration>not long</itunes:duration>
        </item>
    </channel>
</rss>`;

const ATOM_PODCAST = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom Radio</title>
    <link href="https://atom.example.net/" rel="alternate"/>
    <author><name>An Atom Publisher</name></author>
    <entry>
        <title>First broadcast</title>
        <id>tag:atom.example.net,2026:1</id>
        <link href="https://atom.example.net/1"/>
        <link rel="enclosure" href="https://atom.example.net/1.ogg" type="audio/ogg" length="1048576"/>
        <published>2026-09-01T12:00:00Z</published>
    </entry>
</feed>`;

describe('parseFeed on a podcast', () => {
    it('reads the channel as a show', () => {
        const feed = parseFeed(PODCAST);

        expect(feed).toMatchObject({
            title: 'The Long Wave',
            homeUrl: 'https://longwave.example.com',
            description: 'Conversations about radio & the people who make it.',
            author: 'Long Wave Productions',
            language: 'en-gb',
            explicit: false,
            categories: ['Society & Culture', 'Documentary', 'Arts'],
        });
    });

    it('prefers the square iTunes image over the RSS banner', () => {
        expect(parseFeed(PODCAST).imageUrl).toBe('https://cdn.example.com/square.jpg');
    });

    it('reads an episode: its audio, how long it runs, and how it is numbered', () => {
        const [episode] = parseFeed(PODCAST).items;

        expect(episode).toMatchObject({
            id: 'longwave-12',
            title: 'Episode 12: The night shift',
            url: 'https://longwave.example.com/12',
            publishedAt: '2026-09-14T06:00:00.000Z',
            durationMs: 3_723_000,
            imageUrl: 'https://cdn.example.com/12.jpg',
            explicit: true,
            season: 2,
            episode: 12,
        });
    });

    it('takes the audio enclosure over a cover attached ahead of it, and leaves a zero length absent', () => {
        const [episode] = parseFeed(PODCAST).items;

        expect(episode?.enclosure).toEqual({ url: 'https://cdn.example.com/12.mp3', type: 'audio/mpeg' });
    });

    it('never mistakes the enclosure, or an Atom self link, for the page', () => {
        const [episode, second] = parseFeed(PODCAST).items;

        expect(episode?.url).toBe('https://longwave.example.com/12');
        expect(second?.url).toBeUndefined();
    });

    it('reads bare seconds and keeps a declared size', () => {
        const second = parseFeed(PODCAST).items[1];

        expect(second?.durationMs).toBe(3_725_000);
        expect(second?.enclosure).toEqual({ url: 'https://cdn.example.com/11.m4a', type: 'audio/x-m4a', lengthBytes: 55_102_934 });
    });

    it('drops an enclosure nobody could fetch, and a duration nobody could read', () => {
        const trailer = parseFeed(PODCAST).items[2];

        expect(trailer?.title).toBe('A trailer with nowhere to fetch it from');
        expect(trailer?.enclosure).toBeUndefined();
        expect(trailer?.durationMs).toBeUndefined();
    });

    it('reads an Atom enclosure link without taking it for the page', () => {
        const feed = parseFeed(ATOM_PODCAST);
        const [entry] = feed.items;

        expect(feed.author).toBe('An Atom Publisher');
        expect(entry?.url).toBe('https://atom.example.net/1');
        expect(entry?.enclosure).toEqual({ url: 'https://atom.example.net/1.ogg', type: 'audio/ogg', lengthBytes: 1_048_576 });
    });

    it('reads an entry that names itself twice, once in each namespace', () => {
        // With the prefix gone `<title>` and `<itunes:title>` are two `title`s, and this is how most
        // of the big hosts write an episode. Until it was read, every such entry was dropped as
        // untitled: NPR's Planet Money feed parsed to a channel with no episodes in it.
        const feed = parseFeed(`<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
            <title>A show</title>
            <itunes:title>A show, again</itunes:title>
            <item>
                <title>Episode 7: The long one</title>
                <itunes:title>The long one</itunes:title>
                <guid>ep7</guid>
                <enclosure url="https://cdn.example.com/7.mp3" type="audio/mpeg" length="1"/>
            </item>
        </channel></rss>`);

        expect(feed.title).toBe('A show');
        expect(feed.items).toHaveLength(1);
        expect(feed.items[0]).toMatchObject({ id: 'ep7', title: 'Episode 7: The long one' });
    });

    it('reports nothing new about an ordinary news feed', () => {
        const feed = parseFeed(RSS);

        expect(feed.items.every(item => item.enclosure === undefined && item.durationMs === undefined)).toBe(true);
        expect(feed.imageUrl).toBeUndefined();
    });
});

describe('itunes:duration', () => {
    /** One episode carrying this duration, read back. */
    const durationOf = (value: string): number | undefined =>
        parseFeed(`<rss><channel><title>t</title><item><title>e</title><duration>${value}</duration></item></channel></rss>`).items[0]?.durationMs;

    it.each([
        ['01:02:03', 3_723_000],
        ['1:02:03', 3_723_000],
        ['62:03', 3_723_000],
        ['90:00', 5_400_000],
        ['3723', 3_723_000],
        ['3723.5', 3_723_500],
        [' 45:30 ', 2_730_000],
    ])('reads %s', (value, expected) => {
        expect(durationOf(value)).toBe(expected);
    });

    it.each(['', '0', '00:00:00', '1h 2m', 'about an hour', '1:90:00', '12:75', '1:2:3:4', '-5', '1:02:03.5.1'])('refuses %j', value => {
        expect(durationOf(value)).toBeUndefined();
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
