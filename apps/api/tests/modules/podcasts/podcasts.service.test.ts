// The station's list of programmes: every installed podcast plugin asked what it carries, under ids
// that say which plugin carries it, a failing plugin or show costing itself and nothing else, and a
// refresh that writes what the feeds said without ever deciding anything for the station.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { PluginError, type PluginManifest, type PodcastEpisode, type PodcastShow } from '@deadair/plugin-sdk';

import { PodcastsService, REFRESH_EPISODES_PER_SHOW } from '../../../src/modules/podcasts/podcasts.service.js';
import type { PodcastEpisodeRepository } from '../../../src/modules/podcasts/podcast.episode.repository.js';
import type { PodcastEpisodeListing, PodcastEpisodeRecord } from '../../../src/modules/podcasts/podcast.episode.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const PODCAST = 'deadair.podcast';
const OTHER = 'example.pods';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['podcast'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

const show = (id: string, title: string): PodcastShow => ({ id, title });

const episode = (id: string, overrides: Partial<PodcastEpisode> = {}): PodcastEpisode => ({
    id,
    showId: 'longwave',
    showTitle: 'The Long Wave',
    title: `Episode ${id}`,
    publishedAt: '2026-09-14T06:00:00.000Z',
    durationMs: 3_723_000,
    audio: { url: `https://cdn.example.com/${id}.mp3`, mimeType: 'audio/mpeg' },
    ...overrides,
});

interface InstanceOptions {
    listShows?: unknown;
    listEpisodes?: unknown;
}

function record(id: string, options: InstanceOptions = {}): PluginRecord {
    return {
        id,
        dir: `/plugins/${id}`,
        origin: 'bundled',
        status: 'active',
        manifest: manifest(id),
        instance: {
            init: vi.fn(),
            listShows: options.listShows ?? vi.fn(async () => [show('longwave', 'The Long Wave')]),
            listEpisodes: options.listEpisodes ?? vi.fn(async () => [episode('ep12')]),
        } as never,
    };
}

/** The table, as far as this service uses it: what was recorded, and rows to answer a list with. */
function episodesTable(rows: PodcastEpisodeRecord[] = []) {
    const recorded: PodcastEpisodeListing[][] = [];
    const repository = {
        record: vi.fn(async (listings: PodcastEpisodeListing[]) => {
            recorded.push([...listings]);
            return listings.length;
        }),
        list: vi.fn(async () => rows),
    };
    return { repository: repository as unknown as PodcastEpisodeRepository, recorded, list: repository.list };
}

const build = (records: PluginRecord[], table = episodesTable(), jobs = { send: vi.fn(async () => undefined) }) => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    const service = new PodcastsService(
        registry,
        new PluginInvoker(registry, stubPluginLog().log),
        table.repository,
        jobs as unknown as PgBossJobBroker,
        stubLogger(),
    );
    return { service, table, jobs };
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('listing shows', () => {
    it('qualifies every show with the plugin that carries it', async () => {
        const { service } = build([record(PODCAST)]);

        expect(await service.listShows()).toEqual([{ id: `${PODCAST}:longwave`, pluginId: PODCAST, title: 'The Long Wave' }]);
    });

    it('keeps two plugins that both call a show "longwave" apart', async () => {
        const { service } = build([record(PODCAST), record(OTHER)]);

        expect((await service.listShows()).map(entry => entry.id)).toEqual([`${PODCAST}:longwave`, `${OTHER}:longwave`]);
    });

    it('loses one plugin to a failure and keeps the other', async () => {
        const failing = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });
        const { service } = build([record(PODCAST, { listShows: failing }), record(OTHER)]);

        expect((await service.listShows()).map(entry => entry.pluginId)).toEqual([OTHER]);
    });

    it('asks nothing of a plugin that does not declare the capability', async () => {
        const news = { ...record('deadair.rss'), manifest: { ...manifest('deadair.rss'), capabilities: ['news'] } };
        const { service } = build([news]);

        expect(await service.listShows()).toEqual([]);
        expect(service.hasPodcasts()).toBe(false);
    });
});

describe('refreshing', () => {
    it('records each show’s newest episodes under the qualified show id', async () => {
        const listEpisodes = vi.fn(async () => [episode('ep12'), episode('ep11', { publishedAt: '2026-09-07T06:00:00.000Z' })]);
        const { service, table } = build([record(PODCAST, { listEpisodes })]);

        const summary = await service.refresh();

        expect(listEpisodes).toHaveBeenCalledWith({ showId: 'longwave', limit: REFRESH_EPISODES_PER_SHOW });
        expect(summary).toEqual({ shows: 1, listed: 2, added: 2, failed: [] });
        expect(table.recorded[0]?.[0]).toEqual({
            showId: `${PODCAST}:longwave`,
            episodeId: 'ep12',
            showTitle: 'The Long Wave',
            title: 'Episode ep12',
            audioUrl: 'https://cdn.example.com/ep12.mp3',
            audioMime: 'audio/mpeg',
            publishedAt: Date.parse('2026-09-14T06:00:00.000Z'),
            durationMs: 3_723_000,
        });
    });

    it('drops an episode that breaks the contract, and only that episode', async () => {
        const listEpisodes = vi.fn(async () => [
            episode('fine'),
            episode('', { title: 'No id' }),
            episode('no-audio', { audio: { url: 'file:///tmp/12.mp3' } }),
            episode('bad-date', { publishedAt: 'last tuesday' }),
        ]);
        const { service, table } = build([record(PODCAST, { listEpisodes })]);

        await service.refresh();

        const written = table.recorded[0] ?? [];
        expect(written.map(listing => listing.episodeId)).toEqual(['fine', 'bad-date']);
        expect(written[1]?.publishedAt).toBeUndefined();
    });

    it('costs a failing show itself, and refreshes the rest', async () => {
        const listShows = vi.fn(async () => [show('down', 'Down'), show('longwave', 'The Long Wave')]);
        const listEpisodes = vi.fn(async ({ showId }: { showId: string }) => {
            if (showId === 'down') throw new PluginError('feed is down').withCode('upstream');
            return [episode('ep12')];
        });
        const { service, table } = build([record(PODCAST, { listShows, listEpisodes })]);

        const summary = await service.refresh();

        expect(summary.failed).toEqual([`${PODCAST}:down`]);
        expect(summary.shows).toBe(2);
        expect(table.recorded.flat().map(listing => listing.showId)).toEqual([`${PODCAST}:longwave`]);
    });

    it('stops between shows when the job is being abandoned', async () => {
        const controller = new AbortController();
        controller.abort();
        const { service, table } = build([record(PODCAST)]);

        expect(await service.refresh(controller.signal)).toEqual({ shows: 0, listed: 0, added: 0, failed: [] });
        expect(table.recorded).toHaveLength(0);
    });

    it('queues a refresh rather than doing it on the request', async () => {
        const { service, jobs } = build([record(PODCAST)]);

        await service.requestRefresh();

        expect(jobs.send).toHaveBeenCalledWith('podcasts.refresh', {});
    });
});

describe('asking for an episode’s audio', () => {
    const held: PodcastEpisodeRecord = {
        id: 'row-1',
        showId: `${PODCAST}:longwave`,
        episodeId: 'ep12',
        showTitle: 'The Long Wave',
        title: 'Episode 12',
        audioUrl: 'https://cdn.example.com/12.mp3',
        seenAt: 0,
        fetchAttempts: 0,
    };

    const withRow = (row: PodcastEpisodeRecord | undefined, claims: boolean) => {
        const table = episodesTable();
        Object.assign(table.repository, { get: vi.fn(async () => row), claimFetch: vi.fn(async () => claims) });
        return table;
    };

    it('queues a fetch when the claim sticks', async () => {
        const { service, jobs } = build([record(PODCAST)], withRow(held, true));

        expect((await service.requestFetch('row-1')).fetched).toBe(false);
        expect(jobs.send).toHaveBeenCalledWith('podcasts.fetch', { episodeId: 'row-1' });
    });

    it('queues nothing when a fetch is already out, so a second press is one download', async () => {
        const { service, jobs } = build([record(PODCAST)], withRow(held, false));

        await service.requestFetch('row-1');
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('queues nothing for an episode the station already holds', async () => {
        const table = withRow({ ...held, segmentId: 'seg-1' }, true);
        const { service, jobs } = build([record(PODCAST)], table);

        expect((await service.requestFetch('row-1')).fetched).toBe(true);
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('answers 404 for an episode the station does not know', async () => {
        const { service } = build([record(PODCAST)], withRow(undefined, true));

        await expect(service.requestFetch('nope')).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('searching the directory', () => {
    const entry = (feedUrl: string) => ({ id: `dir-${feedUrl}`, title: 'The Long Wave', feedUrl, author: 'Long Wave Productions' });

    it('asks only the plugins that are directories, and tags each result with the plugin that answered', async () => {
        const searchShows = vi.fn(async () => [entry('https://longwave.example.com/feed.xml')]);
        const directory = record(PODCAST);
        Object.assign(directory.instance as object, { searchShows });
        const { service } = build([directory, record(OTHER)]);

        const page = await service.searchDirectory({ query: '  long wave ', limit: 5 });

        expect(searchShows).toHaveBeenCalledWith({ query: 'long wave', limit: 5 });
        expect(page.results).toEqual([
            {
                id: 'dir-https://longwave.example.com/feed.xml',
                pluginId: PODCAST,
                title: 'The Long Wave',
                feedUrl: 'https://longwave.example.com/feed.xml',
                author: 'Long Wave Productions',
            },
        ]);
    });

    it('drops a result nobody could subscribe to, and loses a failing directory without losing the rest', async () => {
        const failing = record(OTHER);
        Object.assign(failing.instance as object, {
            searchShows: vi.fn(async () => {
                throw new PluginError('directory is down').withCode('upstream');
            }),
        });
        const working = record(PODCAST);
        Object.assign(working.instance as object, {
            searchShows: vi.fn(async () => [entry('ftp://nowhere.example.com/feed'), entry('https://ok.example.com/feed.xml')]),
        });
        const { service } = build([failing, working]);

        expect((await service.searchDirectory({ query: 'long wave' })).results.map(result => result.feedUrl)).toEqual([
            'https://ok.example.com/feed.xml',
        ]);
    });

    it('asks nobody for blank words', async () => {
        const searchShows = vi.fn(async () => []);
        const directory = record(PODCAST);
        Object.assign(directory.instance as object, { searchShows });
        const { service } = build([directory]);

        expect(await service.searchDirectory({ query: '   ' })).toEqual({ results: [] });
        expect(searchShows).not.toHaveBeenCalled();
    });
});

describe('reading episodes', () => {
    it('answers the station’s own rows, with instants as ISO-8601 and a fetched flag', async () => {
        const table = episodesTable([
            {
                id: 'row-1',
                showId: `${PODCAST}:longwave`,
                episodeId: 'ep12',
                showTitle: 'The Long Wave',
                title: 'Episode 12',
                audioUrl: 'https://cdn.example.com/12.mp3',
                publishedAt: Date.parse('2026-09-14T06:00:00.000Z'),
                seenAt: Date.parse('2026-09-15T08:00:00.000Z'),
                fetchAttempts: 0,
                segmentId: 'seg-1',
                airedAt: Date.parse('2026-09-15T21:00:00.000Z'),
            },
        ]);
        const { service } = build([record(PODCAST)], table);

        const page = await service.readEpisodes({ showId: `${PODCAST}:longwave` });

        expect(table.list).toHaveBeenCalledWith({ showId: `${PODCAST}:longwave`, limit: 50 });
        expect(page.episodes).toEqual([
            {
                id: 'row-1',
                showId: `${PODCAST}:longwave`,
                episodeId: 'ep12',
                showTitle: 'The Long Wave',
                title: 'Episode 12',
                publishedAt: '2026-09-14T06:00:00.000Z',
                seenAt: '2026-09-15T08:00:00.000Z',
                fetched: true,
                airedAt: '2026-09-15T21:00:00.000Z',
            },
        ]);
    });
});
