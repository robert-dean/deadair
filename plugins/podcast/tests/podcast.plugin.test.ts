import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { isEpisodeAudio, PodcastPlugin } from '../src/podcast.plugin.js';
import { podcastManifest } from '../src/podcast.manifest.js';
import { showIdFor } from '../src/podcast.feeds.js';

const FEED = 'https://longwave.example.com/feed.xml';
const SHOW = showIdFor(FEED);

interface Entry {
    title: string;
    guid: string;
    date?: string;
    audio?: string;
    type?: string;
    duration?: string;
}

/** A podcast feed with the channel furniture a real one carries, around whatever entries a test needs. */
const podcastXml = (...entries: Entry[]): string => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
    <title>The Long Wave</title>
    <link>https://longwave.example.com</link>
    <description>Conversations about radio.</description>
    <itunes:author>Long Wave Productions</itunes:author>
    <itunes:image href="https://cdn.example.com/square.jpg"/>
    <itunes:explicit>no</itunes:explicit>
${entries
    .map(
        entry => `<item>
    <title>${entry.title}</title>
    <guid>${entry.guid}</guid>
    ${entry.date === undefined ? '' : `<pubDate>${entry.date}</pubDate>`}
    ${entry.audio === undefined ? '' : `<enclosure url="${entry.audio}" type="${entry.type ?? 'audio/mpeg'}" length="1000"/>`}
    ${entry.duration === undefined ? '' : `<itunes:duration>${entry.duration}</itunes:duration>`}
    <description>About ${entry.title}.</description>
</item>`,
    )
    .join('\n')}
</channel></rss>`;

/** The rows as they are stored, which is the JSON array a `list` config field holds. */
const rows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

let host: FakePluginHost;
let plugin: PodcastPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ feeds: rows({ url: FEED }), ...config });
    await plugin.init(host);
};

const queueFeed = (xml: string): void => host.queueResponse({ status: 200, body: xml, headers: { 'content-type': 'application/rss+xml' } });

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new PodcastPlugin();
});

describe('manifest', () => {
    it('reaches the feeds the operator listed and the directory, and nowhere an episode lives', () => {
        expect(podcastManifest.permissions.network).toEqual([
            { fromConfig: 'feeds', ratePerSecond: 1, bucket: 'podcast' },
            { host: 'itunes.apple.com', ratePerSecond: 1 / 3 },
        ]);
        expect(podcastManifest.permissions.grants).toBeUndefined();
    });

    it('declares the capability and keeps nothing', () => {
        expect(podcastManifest.capabilities).toEqual(['podcast']);
        expect(podcastManifest.permissions.storage).toBe(false);
    });

    it('refuses a row with no address at save, rather than a subscription that never produces anything', () => {
        const schema = podcastManifest.configSchema;

        expect(schema.safeParse({ feeds: rows({ name: 'No feed' }) }).success).toBe(false);
        expect(schema.safeParse({ feeds: rows({ url: FEED }) }).success).toBe(true);
        expect(schema.safeParse({ feeds: rows({ url: FEED }), country: 'united kingdom' }).success).toBe(false);
    });
});

describe('listShows', () => {
    it('describes a show from its feed', async () => {
        await initialize();
        queueFeed(podcastXml());

        expect(await plugin.listShows()).toEqual([
            {
                id: SHOW,
                title: 'The Long Wave',
                feedUrl: FEED,
                author: 'Long Wave Productions',
                description: 'Conversations about radio.',
                artworkUrl: 'https://cdn.example.com/square.jpg',
                homeUrl: 'https://longwave.example.com',
                explicit: false,
            },
        ]);
    });

    it("calls a show what the operator called it, over the feed's own title", async () => {
        await initialize({ feeds: rows({ name: 'Night Radio', url: FEED }) });
        queueFeed(podcastXml());

        expect((await plugin.listShows())[0]?.title).toBe('Night Radio');
    });

    it('still lists a show whose feed is down, because the subscription has not gone anywhere', async () => {
        await initialize();
        host.queueResponse({ status: 503, body: 'down' });

        expect(await plugin.listShows()).toEqual([{ id: SHOW, title: 'longwave.example.com', feedUrl: FEED }]);
    });

    it('lists the rest from what it knows when the budget is nearly spent, rather than being cut off', async () => {
        await initialize();
        host.seedRemainingMs(500);

        expect(await plugin.listShows()).toEqual([{ id: SHOW, title: 'longwave.example.com', feedUrl: FEED }]);
        expect(host.calls).toHaveLength(0);
    });
});

describe('listEpisodes', () => {
    it('answers the episodes that carry audio, newest first, whatever order the feed used', async () => {
        await initialize();
        queueFeed(
            podcastXml(
                { title: 'Episode 1', guid: 'ep1', date: 'Mon, 01 Jun 2026 06:00:00 GMT', audio: 'https://cdn.example.com/1.mp3', duration: '45:00' },
                { title: 'Show notes only', guid: 'notes', date: 'Mon, 08 Jun 2026 06:00:00 GMT' },
                {
                    title: 'Episode 2',
                    guid: 'ep2',
                    date: 'Mon, 15 Jun 2026 06:00:00 GMT',
                    audio: 'https://cdn.example.com/2.mp3',
                    duration: '1:02:03',
                },
            ),
        );

        const episodes = await plugin.listEpisodes({ showId: SHOW, limit: 10 });

        expect(episodes.map(episode => episode.id)).toEqual(['ep2', 'ep1']);
        expect(episodes[0]).toEqual({
            id: 'ep2',
            showId: SHOW,
            showTitle: 'The Long Wave',
            title: 'Episode 2',
            summary: 'About Episode 2.',
            publishedAt: '2026-06-15T06:00:00.000Z',
            durationMs: 3_723_000,
            audio: { url: 'https://cdn.example.com/2.mp3', mimeType: 'audio/mpeg', lengthBytes: 1000 },
            artworkUrl: 'https://cdn.example.com/square.jpg',
            explicit: false,
        });
    });

    it('honours since and limit, keeping an undated episode as unjudgeable rather than old', async () => {
        await initialize();
        queueFeed(
            podcastXml(
                { title: 'Old', guid: 'old', date: 'Mon, 01 Jun 2026 06:00:00 GMT', audio: 'https://cdn.example.com/old.mp3' },
                { title: 'Undated', guid: 'undated', audio: 'https://cdn.example.com/undated.mp3' },
                { title: 'New', guid: 'new', date: 'Mon, 15 Jun 2026 06:00:00 GMT', audio: 'https://cdn.example.com/new.mp3' },
            ),
        );

        const episodes = await plugin.listEpisodes({ showId: SHOW, limit: 10, since: '2026-06-10T00:00:00.000Z' });

        expect(episodes.map(episode => episode.id)).toEqual(['new', 'undated']);
        expect(await plugin.listEpisodes({ showId: SHOW, limit: 1 })).toHaveLength(1);
    });

    it('answers nothing for a show it does not carry, rather than throwing', async () => {
        await initialize();

        expect(await plugin.listEpisodes({ showId: 'gone', limit: 10 })).toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('answers nothing for a show whose feed is down, and does not remember the failure', async () => {
        await initialize();
        host.queueResponse({ status: 502, body: 'bad gateway' });
        queueFeed(podcastXml({ title: 'Back', guid: 'back', audio: 'https://cdn.example.com/back.mp3' }));

        expect(await plugin.listEpisodes({ showId: SHOW, limit: 10 })).toEqual([]);
        expect((await plugin.listEpisodes({ showId: SHOW, limit: 10 })).map(episode => episode.id)).toEqual(['back']);
    });

    it('reuses a feed it read a moment ago, and asks again once the cache says so', async () => {
        await initialize({ cacheSeconds: 0 });
        queueFeed(podcastXml({ title: 'One', guid: 'one', audio: 'https://cdn.example.com/1.mp3' }));
        queueFeed(podcastXml({ title: 'One', guid: 'one', audio: 'https://cdn.example.com/1.mp3' }));

        await plugin.listEpisodes({ showId: SHOW, limit: 10 });
        await plugin.listEpisodes({ showId: SHOW, limit: 10 });
        expect(host.calls).toHaveLength(2);

        const cached = new PodcastPlugin();
        const cachedHost = createFakePluginHost();
        cachedHost.seedConfig({ feeds: rows({ url: FEED }) });
        await cached.init(cachedHost);
        cachedHost.queueResponse({ status: 200, body: podcastXml({ title: 'One', guid: 'one', audio: 'https://cdn.example.com/1.mp3' }) });

        await cached.listEpisodes({ showId: SHOW, limit: 10 });
        await cached.listEpisodes({ showId: SHOW, limit: 10 });
        expect(cachedHost.calls).toHaveLength(1);
    });

    it('keeps the same ids across reads, which is what the station remembers episodes by', async () => {
        await initialize({ cacheSeconds: 0 });
        const xml = podcastXml({ title: 'One', guid: 'stable-guid', audio: 'https://cdn.example.com/1.mp3' });
        queueFeed(xml);
        queueFeed(xml);

        const first = await plugin.listEpisodes({ showId: SHOW, limit: 10 });
        const second = await plugin.listEpisodes({ showId: SHOW, limit: 10 });

        expect(first.map(episode => episode.id)).toEqual(second.map(episode => episode.id));
    });
});

describe('isEpisodeAudio', () => {
    it.each([
        [{ url: 'https://cdn.example.com/1.mp3', type: 'audio/mpeg' }, true],
        [{ url: 'https://cdn.example.com/1', type: 'audio/x-m4a' }, true],
        [{ url: 'https://cdn.example.com/1.mp3?token=abc' }, true],
        [{ url: 'https://cdn.example.com/1.m4a', type: 'application/octet-stream' }, true],
        [{ url: 'https://cdn.example.com/1.mp4', type: 'video/mp4' }, false],
        [{ url: 'https://cdn.example.com/1.m4a', type: 'video/x-m4v' }, false],
        [{ url: 'https://cdn.example.com/live.m3u', type: 'audio/x-mpegurl' }, false],
        [{ url: 'https://cdn.example.com/cover.jpg', type: 'image/jpeg' }, false],
        [{ url: 'https://cdn.example.com/page' }, false],
    ])('%j is audio: %s', (enclosure, expected) => {
        expect(isEpisodeAudio(enclosure)).toBe(expected);
    });
});

describe('searchShows', () => {
    const itunesAnswer = JSON.stringify({
        resultCount: 1,
        results: [{ collectionId: 42, collectionName: 'The Long Wave', feedUrl: FEED, artistName: 'Long Wave Productions' }],
    });

    it("answers from Apple's directory, in the store the operator chose", async () => {
        await initialize({ country: 'gb' });
        host.queueResponse({ status: 200, body: itunesAnswer, headers: { 'content-type': 'text/javascript; charset=utf-8' } });

        expect(await plugin.searchShows({ query: 'long wave', limit: 5 })).toEqual([
            { id: '42', title: 'The Long Wave', feedUrl: FEED, author: 'Long Wave Productions' },
        ]);

        const asked = new URL(host.calls[0]?.url ?? '');
        expect(asked.hostname).toBe('itunes.apple.com');
        expect(asked.searchParams.get('country')).toBe('gb');
        expect(asked.searchParams.get('term')).toBe('long wave');
    });

    it('sends nothing to Apple when the operator switched the directory off', async () => {
        await initialize({ directory: false });

        expect(await plugin.searchShows({ query: 'long wave', limit: 5 })).toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('answers nothing, rather than failing, when Apple refuses or the words are blank', async () => {
        await initialize();
        host.queueResponse({ status: 403, body: 'slow down' });

        expect(await plugin.searchShows({ query: 'long wave', limit: 5 })).toEqual([]);
        expect(await plugin.searchShows({ query: '   ', limit: 5 })).toEqual([]);
        expect(host.calls).toHaveLength(1);
    });
});

describe('testConnection', () => {
    it('asks for a show when there is none', async () => {
        await initialize({ feeds: rows() });

        expect(await plugin.testConnection()).toMatchObject({ ok: false });
    });

    it('passes a feed that carries episodes', async () => {
        await initialize();
        queueFeed(podcastXml({ title: 'One', guid: 'one', audio: 'https://cdn.example.com/1.mp3' }));

        expect(await plugin.testConnection()).toEqual({ ok: true, message: '1 of 1 feed read.' });
    });

    it("names a feed that reads and carries no audio, which is usually a blog's rather than the podcast's", async () => {
        await initialize();
        queueFeed(podcastXml({ title: 'A post', guid: 'post' }));

        const result = await plugin.testConnection();
        expect(result.ok).toBe(false);
        expect(result.message).toContain('No episodes with audio in: The Long Wave.');
    });

    it('passes a list where some shows work, and names the ones that do not', async () => {
        await initialize({ feeds: rows({ url: FEED }, { name: 'Broken', url: 'https://broken.example.com/feed.xml' }) });
        queueFeed(podcastXml({ title: 'One', guid: 'one', audio: 'https://cdn.example.com/1.mp3' }));
        host.queueResponse({ status: 404, body: 'gone' });

        const result = await plugin.testConnection();
        expect(result.ok).toBe(true);
        expect(result.message).toContain('Nothing came back from: Broken.');
    });
});
