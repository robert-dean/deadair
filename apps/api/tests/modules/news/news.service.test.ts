// The newsroom list: every installed news plugin asked what it offers, under ids
// that say which plugin offered them, with a failing plugin costing its own rows
// and nothing else. No HTTP here — `NewsService` takes a query and answers with
// items, which is the same path the tool and the route drive.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type NewsFeedDescriptor, type NewsItem, type PluginManifest } from '@deadair/plugin-sdk';

import { MAX_NEWS_ITEMS, NewsService } from '../../../src/modules/news/news.service.js';
import { qualifyFeedId, splitFeedId } from '../../../src/modules/news/feed.ids.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const RSS = 'deadair.rss';
const WIRE = 'deadair.wire';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['news'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

const item = (id: string, title: string, publishedAt?: string): NewsItem => ({
    id,
    feedId: 'world',
    feedName: 'World news',
    title,
    ...(publishedAt === undefined ? {} : { publishedAt }),
});

interface InstanceOptions {
    listFeeds?: unknown;
    fetchItems?: unknown;
}

function instance(options: InstanceOptions = {}) {
    const built: Record<string, unknown> = {
        init: vi.fn(),
        listFeeds: options.listFeeds ?? vi.fn(async (): Promise<NewsFeedDescriptor[]> => [{ id: 'world', name: 'World news' }]),
        fetchItems: options.fetchItems ?? vi.fn(async (): Promise<NewsItem[]> => [item('g1', 'Bridge reopens', '2026-08-15T08:00:00.000Z')]),
    };
    return built;
}

function record(id: string, overrides: Partial<PluginRecord> = {}, options: InstanceOptions = {}): PluginRecord {
    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest(id), instance: instance(options) as never, ...overrides };
}

/** One of the operator's categories, as the repository answers with it. */
const topic = (key: string, label: string, config: Record<string, unknown>): Topic => ({
    id: `t-${key}`,
    kind: 'news',
    key,
    label,
    config,
    position: 0,
});

/** A topic table that answers with these rows, or throws when they are an error. */
const topicsAnswering = (rows: Topic[] | Error): TopicRepository =>
    ({
        list: vi.fn(async () => {
            if (rows instanceof Error) throw rows;
            return rows;
        }),
    }) as unknown as TopicRepository;

const build = (records: PluginRecord[], topics: Topic[] | Error = []): NewsService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    return new NewsService(registry, new PluginInvoker(registry, stubPluginLog().log), topicsAnswering(topics), stubLogger());
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('feed ids', () => {
    it('round-trips a plugin id and a feed id', () => {
        expect(splitFeedId(qualifyFeedId(RSS, 'world'))).toEqual({ pluginId: RSS, feedId: 'world' });
    });

    it('splits at the FIRST colon, so a feed id may contain one', () => {
        expect(splitFeedId(qualifyFeedId(RSS, 'geo:gb'))).toEqual({ pluginId: RSS, feedId: 'geo:gb' });
    });

    it.each(['world', '', ':world', `${RSS}:`])('declines "%s", which names no plugin', qualified => {
        expect(splitFeedId(qualified)).toBeUndefined();
    });
});

describe('listing what is on offer', () => {
    it('qualifies every id with the plugin that named it', async () => {
        const service = build([record(RSS)]);

        expect(await service.listFeeds()).toEqual([{ id: `${RSS}:world`, pluginId: RSS, name: 'World news' }]);
    });

    it('keeps two plugins that both call a feed "world" apart', async () => {
        const service = build([record(RSS), record(WIRE)]);

        expect((await service.listFeeds()).map(feed => feed.id)).toEqual([`${RSS}:world`, `${WIRE}:world`]);
    });

    it('loses one plugin to a failure and keeps the other', async () => {
        const listFeeds = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });
        const service = build([record(RSS, {}, { listFeeds }), record(WIRE)]);

        expect((await service.listFeeds()).map(feed => feed.pluginId)).toEqual([WIRE]);
    });

    it('ignores a plugin that declares news and only half implements it', async () => {
        const half = record(RSS);
        half.instance = { init: vi.fn(), fetchItems: vi.fn() } as never;
        const service = build([half]);

        expect(await service.listFeeds()).toEqual([]);
        expect(service.hasNews()).toBe(false);
    });
});

describe('reading the news', () => {
    it('qualifies the id and the feed of every story, so what comes back can be asked for again', async () => {
        const service = build([record(RSS)]);

        const [story] = await service.fetchItems({ limit: 10 });

        expect(story).toMatchObject({ id: `${RSS}:g1`, feedId: `${RSS}:world`, title: 'Bridge reopens' });
    });

    it('asks only the plugin that minted the feed id', async () => {
        const fetchItems = vi.fn(async (): Promise<NewsItem[]> => [item('g2', 'From the wire')]);
        const service = build([record(RSS), record(WIRE, {}, { fetchItems })]);

        const stories = await service.fetchItems({ feedId: `${WIRE}:world`, limit: 10 });

        expect(stories.map(story => story.title)).toEqual(['From the wire']);
        // The plugin is asked with its OWN id, not the qualified one.
        expect(fetchItems).toHaveBeenCalledWith({ feedId: 'world', limit: 10 });
    });

    it('merges every plugin newest first when no feed was named', async () => {
        const older = vi.fn(async (): Promise<NewsItem[]> => [item('g1', 'Older', '2026-08-15T06:00:00.000Z')]);
        const newer = vi.fn(async (): Promise<NewsItem[]> => [item('g2', 'Newer', '2026-08-15T09:00:00.000Z')]);
        const service = build([record(RSS, {}, { fetchItems: older }), record(WIRE, {}, { fetchItems: newer })]);

        expect((await service.fetchItems({ limit: 10 })).map(story => story.title)).toEqual(['Newer', 'Older']);
    });

    it('answers with nothing for an id that names no installed plugin, rather than throwing', async () => {
        const service = build([record(RSS)]);

        await expect(service.fetchItems({ feedId: 'deadair.gone:world', limit: 10 })).resolves.toEqual([]);
        await expect(service.fetchItems({ feedId: 'world', limit: 10 })).resolves.toEqual([]);
    });

    it('loses a failing plugin and keeps the rest of the news', async () => {
        const fetchItems = vi.fn(async () => {
            throw new PluginError('publisher is down').withCode('unavailable');
        });
        const service = build([record(RSS, {}, { fetchItems }), record(WIRE)]);

        expect(await service.fetchItems({ limit: 10 })).toHaveLength(1);
    });

    it('drops a story with no title, because a headline is the whole of what it is', async () => {
        const fetchItems = vi.fn(async (): Promise<NewsItem[]> => [item('g1', '   '), item('g2', 'Real')]);
        const service = build([record(RSS, {}, { fetchItems })]);

        expect((await service.fetchItems({ limit: 10 })).map(story => story.title)).toEqual(['Real']);
    });

    it('clamps what it asks a third party for', async () => {
        const fetchItems = vi.fn(async (): Promise<NewsItem[]> => []);
        const service = build([record(RSS, {}, { fetchItems })]);

        await service.fetchItems({ limit: 5_000 });

        expect(fetchItems).toHaveBeenCalledWith({ limit: MAX_NEWS_ITEMS });
    });

    it('passes since through to the plugin, which is where it can be applied cheaply', async () => {
        const fetchItems = vi.fn(async (): Promise<NewsItem[]> => []);
        const service = build([record(RSS, {}, { fetchItems })]);

        await service.fetchItems({ limit: 10, since: '2026-08-15T00:00:00.000Z' });

        expect(fetchItems).toHaveBeenCalledWith({ limit: 10, since: '2026-08-15T00:00:00.000Z' });
    });
});

describe('what the console reads', () => {
    it('wraps the list, and a page of stories, without reshaping either', async () => {
        const service = build([record(RSS)]);

        expect(await service.readFeeds()).toEqual({ feeds: await service.listFeeds() });
        expect((await service.readNews({})).stories.map(story => story.title)).toEqual(['Bridge reopens']);
    });

    it('answers a station with no news plugin with an empty page rather than a failure', async () => {
        const service = build([]);

        expect(await service.readFeeds()).toEqual({ feeds: [] });
        expect(await service.readNews({})).toEqual({ stories: [] });
    });
});

/**
 * What the station will not read is decided here rather than in the bulletin, so the page, the
 * model's tool and the bulletin cannot disagree about what the station has. The failure it answers
 * aired: a publisher's deals desk shares its main feed, and a discount code was read out as news.
 */
describe('what the station keeps off the air', () => {
    const shopping = topic('shopping', 'Shopping and sponsored', { offAir: true, labels: ['Deals'], words: ['discount code'] });

    const deals = (): NewsItem[] => [
        { ...item('g1', 'Council reopens the bridge', '2026-08-15T08:00:00.000Z') },
        { ...item('g2', 'Save on tents with this discount code', '2026-08-15T07:00:00.000Z') },
        { ...item('g3', 'A new pair of headphones', '2026-08-15T06:00:00.000Z'), categories: ['Deals'] },
    ];

    it('withholds a story an off-air category claims', async () => {
        const service = build([record(RSS, {}, { fetchItems: vi.fn(async () => deals()) })], [shopping]);

        expect((await service.fetchItems({ limit: 10 })).map(story => story.title)).toEqual(['Council reopens the bridge']);
    });

    it('withholds it from one named feed as well as from the merge', async () => {
        const service = build([record(RSS, {}, { fetchItems: vi.fn(async () => deals()) })], [shopping]);

        const stories = await service.fetchItems({ limit: 10, feedId: qualifyFeedId(RSS, 'world') });

        expect(stories.map(story => story.title)).toEqual(['Council reopens the bridge']);
    });

    it('spends the limit on stories the station will read, not on the ones it drops', async () => {
        const service = build([record(RSS, {}, { fetchItems: vi.fn(async () => deals()) })], [shopping]);

        // Two of the three are withheld, so a caller asking for one gets the story rather than
        // a page whose only survivor fell off the end of the cut.
        expect((await service.fetchItems({ limit: 1 })).map(story => story.title)).toEqual(['Council reopens the bridge']);
    });

    it('keeps a whole feed out when the feed itself is filed under one', async () => {
        const listFeeds = vi.fn(async (): Promise<NewsFeedDescriptor[]> => [{ id: 'world', name: 'World news', category: 'Shopping and sponsored' }]);
        const service = build([record(RSS, {}, { listFeeds, fetchItems: vi.fn(async () => deals()) })], [shopping]);

        expect(await service.fetchItems({ limit: 10 })).toEqual([]);
    });

    it('drops nothing on a station whose categories cannot be read', async () => {
        const service = build([record(RSS, {}, { fetchItems: vi.fn(async () => deals()) })], new Error('no topics table'));

        expect((await service.fetchItems({ limit: 10 })).map(story => story.title)).toHaveLength(3);
    });

    it('drops nothing when no category is marked off air', async () => {
        const ordinary = topic('technology', 'Technology', { labels: ['Deals'] });
        const service = build([record(RSS, {}, { fetchItems: vi.fn(async () => deals()) })], [ordinary]);

        expect((await service.fetchItems({ limit: 10 })).map(story => story.title)).toHaveLength(3);
    });
});
