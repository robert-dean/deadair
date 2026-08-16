import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { RssPlugin } from '../src/rss.plugin.js';
import { rssManifest } from '../src/rss.manifest.js';

const feedXml = (...items: { title: string; guid?: string; date?: string }[]): string => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example</title>
${items
    .map(
        item => `<item>
    <title>${item.title}</title>
    ${item.guid === undefined ? '' : `<guid>${item.guid}</guid>`}
    ${item.date === undefined ? '' : `<pubDate>${item.date}</pubDate>`}
    <description><![CDATA[<p>Words about ${item.title}.</p>]]></description>
</item>`,
    )
    .join('\n')}
</channel></rss>`;

let host: FakePluginHost;
let plugin: RssPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ feeds: 'world|World news|https://one.example.com/rss.xml', ...config });
    await plugin.init(host);
};

const queueFeed = (xml: string): void => host.queueResponse({ status: 200, body: xml, headers: { 'content-type': 'application/rss+xml' } });

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new RssPlugin();
});

describe('manifest', () => {
    it('declares one allowlist entry, resolved from the list the operator wrote', () => {
        expect(rssManifest.permissions.network).toEqual([{ fromConfig: 'feeds', ratePerSecond: 1, bucket: 'rss' }]);
    });

    // The stories are on the publisher's site and the feed is on the publisher's feed host, so the
    // allowlist above resolves to exactly the one hostname that does not hold the news. Asking is
    // the only honest way to reach the rest, and asking is not being granted.
    it('asks for the open web, and says why in a sentence an operator can act on', () => {
        const [asked] = rssManifest.permissions.grants ?? [];

        expect(asked?.capability).toBe('network.open');
        expect(asked?.reason.length).toBeGreaterThan(20);
        // Paced as the feeds are: one bucket for this plugin's whole outbound rate.
        expect(asked).toMatchObject({ ratePerSecond: 1, bucket: 'rss' });
    });

    it('asks for no storage, because a feed belongs to whoever published it', () => {
        expect(rssManifest.permissions.storage).toBe(false);
        expect(rssManifest.permissions.oauth).toBe(false);
    });
});

describe('listFeeds', () => {
    it('answers with the list the operator wrote', async () => {
        await initialize();

        expect(await plugin.listFeeds()).toEqual([{ id: 'world', name: 'World news' }]);
    });

    it('offers nothing when nobody has configured a feed, and does not call it a failure', async () => {
        await initialize({ feeds: '' });

        expect(await plugin.listFeeds()).toEqual([]);
    });

    it('rebuilds its list on init, which is how an operator edit arrives', async () => {
        await initialize();
        // A config write reinitializes the plugin rather than mutating it, so
        // this is the path an edit actually takes.
        await initialize({ feeds: 'sport|Sport|https://two.example.com/rss.xml' });

        expect(await plugin.listFeeds()).toEqual([{ id: 'sport', name: 'Sport' }]);
    });
});

describe('fetchItems', () => {
    it('reads a feed and stamps every entry with where it came from', async () => {
        await initialize();
        queueFeed(feedXml({ title: 'Bridge reopens', guid: 'g1', date: 'Tue, 03 Jun 2008 11:05:30 GMT' }));

        const [item] = await plugin.fetchItems({ limit: 10 });

        expect(item).toMatchObject({
            id: 'world:g1',
            feedId: 'world',
            feedName: 'World news',
            title: 'Bridge reopens',
            summary: 'Words about Bridge reopens.',
            publishedAt: '2008-06-03T11:05:30.000Z',
        });
    });

    it('qualifies the id by feed, so two feeds carrying one guid stay two entries', async () => {
        await initialize({ feeds: ['a|A|https://one.example.com/rss.xml', 'b|B|https://two.example.com/rss.xml'].join('\n') });
        queueFeed(feedXml({ title: 'Shared story', guid: 'g1' }));
        queueFeed(feedXml({ title: 'Shared story', guid: 'g1' }));

        const items = await plugin.fetchItems({ limit: 10 });

        expect(items.map(item => item.id)).toEqual(['a:g1', 'b:g1']);
    });

    it('gives the same entry the same id on a later call, which is what lets a caller de-duplicate', async () => {
        await initialize({ cacheSeconds: 0 });
        queueFeed(feedXml({ title: 'Bridge reopens', guid: 'g1' }));
        queueFeed(feedXml({ title: 'Something newer', guid: 'g2' }, { title: 'Bridge reopens', guid: 'g1' }));

        const first = await plugin.fetchItems({ limit: 10 });
        const second = await plugin.fetchItems({ limit: 10 });

        expect(first.map(item => item.id)).toEqual(['world:g1']);
        expect(second.map(item => item.id)).toEqual(['world:g2', 'world:g1']);
    });

    it('merges several feeds newest first', async () => {
        await initialize({ feeds: ['a|A|https://one.example.com/rss.xml', 'b|B|https://two.example.com/rss.xml'].join('\n') });
        queueFeed(feedXml({ title: 'Older', guid: 'g1', date: 'Tue, 03 Jun 2008 11:05:30 GMT' }));
        queueFeed(feedXml({ title: 'Newer', guid: 'g2', date: 'Wed, 04 Jun 2008 09:00:00 GMT' }));

        expect((await plugin.fetchItems({ limit: 10 })).map(item => item.title)).toEqual(['Newer', 'Older']);
    });

    it('answers about one feed when it is asked about one', async () => {
        await initialize({ feeds: ['a|A|https://one.example.com/rss.xml', 'b|B|https://two.example.com/rss.xml'].join('\n') });
        queueFeed(feedXml({ title: 'From B', guid: 'g1' }));

        const items = await plugin.fetchItems({ feedId: 'b', limit: 10 });

        expect(items.map(item => item.feedId)).toEqual(['b']);
        expect(host.calls.map(call => call.url)).toEqual(['https://two.example.com/rss.xml']);
    });

    it('answers with nothing for a feed id nobody offers, rather than throwing', async () => {
        await initialize();

        await expect(plugin.fetchItems({ feedId: 'gone', limit: 10 })).resolves.toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('lets a bad day at one publisher cost that one feed', async () => {
        await initialize({ feeds: ['a|A|https://one.example.com/rss.xml', 'b|B|https://two.example.com/rss.xml'].join('\n') });
        host.queueResponse({ status: 503, body: 'down' });
        queueFeed(feedXml({ title: 'From B', guid: 'g1' }));

        expect((await plugin.fetchItems({ limit: 10 })).map(item => item.title)).toEqual(['From B']);
    });

    it('honours the limit and the per-feed ceiling', async () => {
        await initialize({ maxItems: 2 });
        queueFeed(feedXml({ title: 'One', guid: 'g1' }, { title: 'Two', guid: 'g2' }, { title: 'Three', guid: 'g3' }));

        expect(await plugin.fetchItems({ limit: 1 })).toHaveLength(1);
        // The per-feed ceiling is applied at the fetch, so it survives the cache.
        expect(await plugin.fetchItems({ limit: 10 })).toHaveLength(2);
    });

    it('filters to what is new when it is asked with since', async () => {
        await initialize();
        queueFeed(
            feedXml(
                { title: 'Old', guid: 'g1', date: 'Tue, 03 Jun 2008 11:05:30 GMT' },
                { title: 'New', guid: 'g2', date: 'Fri, 06 Jun 2008 11:05:30 GMT' },
            ),
        );

        const items = await plugin.fetchItems({ limit: 10, since: '2008-06-04T00:00:00.000Z' });

        expect(items.map(item => item.title)).toEqual(['New']);
    });

    it('keeps an undated entry through a since filter, because unjudgeable is not old', async () => {
        await initialize();
        queueFeed(feedXml({ title: 'Undated', guid: 'g1' }));

        expect(await plugin.fetchItems({ limit: 10, since: '2026-01-01T00:00:00.000Z' })).toHaveLength(1);
    });

    it('reuses a feed within the cache window rather than asking twice in one break', async () => {
        await initialize({ cacheSeconds: 60 });
        queueFeed(feedXml({ title: 'One', guid: 'g1' }));

        await plugin.fetchItems({ limit: 10 });
        await plugin.fetchItems({ limit: 10 });

        expect(host.calls).toHaveLength(1);
    });

    it('does not cache a failure, so a momentary 502 is not a minute of no news', async () => {
        await initialize({ cacheSeconds: 60 });
        host.queueResponse({ status: 502, body: 'bad gateway' });
        queueFeed(feedXml({ title: 'Recovered', guid: 'g1' }));

        expect(await plugin.fetchItems({ limit: 10 })).toEqual([]);
        expect((await plugin.fetchItems({ limit: 10 })).map(item => item.title)).toEqual(['Recovered']);
    });

    it('stops short of the list rather than being cut off mid-feed', async () => {
        await initialize({ feeds: ['a|A|https://one.example.com/rss.xml', 'b|B|https://two.example.com/rss.xml'].join('\n') });
        queueFeed(feedXml({ title: 'From A', guid: 'g1' }));
        queueFeed(feedXml({ title: 'From B', guid: 'g2' }));
        host.seedRemainingMs(200);

        expect((await plugin.fetchItems({ limit: 10 })).map(item => item.title)).toEqual(['From A']);
        expect(host.calls).toHaveLength(1);
    });
});

describe('testConnection', () => {
    it('names the feeds that answered with nothing rather than only the first', async () => {
        await initialize({ feeds: ['a|A|https://one.example.com/rss.xml', 'b|B|https://two.example.com/rss.xml'].join('\n') });
        queueFeed(feedXml({ title: 'From A', guid: 'g1' }));
        // A publisher that moved leaves an HTML page at the old address, which is
        // a 200 and no items.
        host.queueResponse({ status: 200, body: '<html><body>Moved</body></html>' });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('b') });
    });

    it('says so plainly when nothing has been configured', async () => {
        await initialize({ feeds: '' });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });
});

/**
 * A feed is a list of titles. Measured against the station's own configured
 * feed, every entry's description was one sentence restating its title, which
 * is a bulletin that reads out a list — so the story behind the headline is
 * fetched separately, and these are the bounds on doing that.
 */
describe('fetchItems stories', () => {
    const linkedFeed = (...items: { title: string; guid: string; link: string }[]): string => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example</title>
${items
    .map(
        item => `<item><title>${item.title}</title><guid>${item.guid}</guid><link>${item.link}</link>
    <description>A teaser about ${item.title}.</description></item>`,
    )
    .join('\n')}
</channel></rss>`;

    const articlePage = (text: string): string => `<html><body><article><p>${text}</p></article></body></html>`;

    /**
     * Answers feeds and article pages by address rather than in order.
     *
     * The queue cannot express this: a call reads one feed and then several
     * pages, and which page is asked for depends on what the feed said.
     */
    const serving = (pages: Record<string, string>, feed: string): void => {
        host.setFetchImpl(async (url: string) => {
            if (url.endsWith('rss.xml')) return new Response(feed, { headers: { 'content-type': 'application/rss+xml' } });

            const page = pages[url];
            if (page === undefined) throw new Error(`no page for ${url}`);
            return new Response(page, { headers: { 'content-type': 'text/html' } });
        });
    };

    it('reads the story behind each headline and keeps the teaser beside it', async () => {
        await initialize();
        serving(
            { 'https://one.example.com/a': articlePage('The council voted to reopen the crossing after eleven months of works.') },
            linkedFeed({ title: 'Bridge reopens', guid: 'g1', link: 'https://one.example.com/a' }),
        );

        const [item] = await plugin.fetchItems({ limit: 10 });

        expect(item).toMatchObject({
            title: 'Bridge reopens',
            summary: 'A teaser about Bridge reopens.',
            content: 'The council voted to reopen the crossing after eleven months of works.',
        });
    });

    // The bound that matters most: a feed read twenty-five entries deep must not
    // cost twenty-five page loads to answer a request for three.
    it('reads pages only for the items it is answering with', async () => {
        await initialize();
        serving(
            {
                'https://one.example.com/a': articlePage('The first story, at a length that reads as a paragraph of reporting.'),
                'https://one.example.com/b': articlePage('The second story, also long enough to be taken for prose.'),
            },
            linkedFeed(
                { title: 'First', guid: 'g1', link: 'https://one.example.com/a' },
                { title: 'Second', guid: 'g2', link: 'https://one.example.com/b' },
            ),
        );

        const items = await plugin.fetchItems({ limit: 1 });

        expect(items).toHaveLength(1);
        expect(host.calls.map(call => call.url)).toEqual(['https://one.example.com/rss.xml', 'https://one.example.com/a']);
    });

    it('reads no more than four pages however many it is asked for', async () => {
        const six = Array.from({ length: 6 }, (_unused, at) => ({ title: `Story ${at}`, guid: `g${at}`, link: `https://one.example.com/${at}` }));
        await initialize();
        serving(
            Object.fromEntries(six.map(item => [item.link, articlePage(`The body of ${item.title}, long enough to be taken for real prose.`)])),
            linkedFeed(...six),
        );

        const items = await plugin.fetchItems({ limit: 6 });

        expect(items).toHaveLength(6);
        expect(items.filter(item => item.content !== undefined)).toHaveLength(4);
    });

    it('stops reading stories when the budget runs low, and still answers', async () => {
        await initialize();
        serving(
            { 'https://one.example.com/a': articlePage('A story nobody has time to read right now, but a real paragraph nonetheless.') },
            linkedFeed({ title: 'Bridge reopens', guid: 'g1', link: 'https://one.example.com/a' }),
        );
        host.seedRemainingMs(2_000);

        const [item] = await plugin.fetchItems({ limit: 10 });

        expect(item).toMatchObject({ title: 'Bridge reopens', summary: 'A teaser about Bridge reopens.' });
        expect(item?.content).toBeUndefined();
    });

    // Every failure is the same outcome, because it is the same outcome to the
    // caller: the entry's own words, which are a real answer.
    it.each([
        ['a page that will not load', () => Promise.reject(new Error('refused'))],
        [
            'a page with nothing on it',
            () => Promise.resolve(new Response('<html><body><p>Menu</p></body></html>', { headers: { 'content-type': 'text/html' } })),
        ],
        ['something that is not a page at all', () => Promise.resolve(new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }))],
    ])('falls back to the headline for %s', async (_what, answer) => {
        await initialize();
        const feed = linkedFeed({ title: 'Bridge reopens', guid: 'g1', link: 'https://one.example.com/a' });
        host.setFetchImpl(async (url: string) =>
            url.endsWith('rss.xml') ? new Response(feed, { headers: { 'content-type': 'application/rss+xml' } }) : answer(),
        );

        const [item] = await plugin.fetchItems({ limit: 10 });

        expect(item).toMatchObject({ title: 'Bridge reopens' });
        expect(item?.content).toBeUndefined();
    });

    // A model writing one break calls the news tool twice. Reading a publisher's
    // page twice inside ten seconds is rude for no gain, and it is the expensive
    // half of the two.
    it('reads a page once inside the cache window', async () => {
        await initialize({ cacheSeconds: 600 });
        serving(
            { 'https://one.example.com/a': articlePage('One story, read once, at a length that passes for reporting.') },
            linkedFeed({ title: 'Bridge reopens', guid: 'g1', link: 'https://one.example.com/a' }),
        );

        const first = await plugin.fetchItems({ limit: 10 });
        const second = await plugin.fetchItems({ limit: 10 });

        expect(host.calls).toHaveLength(2);
        expect(second[0]?.content).toBe(first[0]?.content);
    });

    it('reads it again once the window has passed', async () => {
        await initialize({ cacheSeconds: 0 });
        serving(
            { 'https://one.example.com/a': articlePage('One story, read twice, at a length that passes for reporting.') },
            linkedFeed({ title: 'Bridge reopens', guid: 'g1', link: 'https://one.example.com/a' }),
        );

        await plugin.fetchItems({ limit: 10 });
        await plugin.fetchItems({ limit: 10 });

        expect(host.calls).toHaveLength(4);
    });

    it('reads no pages at all when the operator turned stories off', async () => {
        await initialize({ fetchArticles: false });
        serving(
            { 'https://one.example.com/a': articlePage('A story the operator does not want paid for.') },
            linkedFeed({ title: 'Bridge reopens', guid: 'g1', link: 'https://one.example.com/a' }),
        );

        const [item] = await plugin.fetchItems({ limit: 10 });

        expect(item?.content).toBeUndefined();
        expect(host.calls).toHaveLength(1);
    });
});

describe('unload', () => {
    it('drops the cache, so a reconfigured plugin does not answer from the old list', async () => {
        await initialize({ cacheSeconds: 600 });
        queueFeed(feedXml({ title: 'One', guid: 'g1' }));
        await plugin.fetchItems({ limit: 10 });

        await plugin.dispose();
        await initialize({ cacheSeconds: 600 });
        queueFeed(feedXml({ title: 'Two', guid: 'g2' }));

        expect((await plugin.fetchItems({ limit: 10 })).map(item => item.title)).toEqual(['Two']);
        expect(host.calls).toHaveLength(2);
    });
});
