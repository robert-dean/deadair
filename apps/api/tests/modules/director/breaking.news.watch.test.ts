// The producer between the operator's breaking feeds and the director. Where a break goes and
// whether the station can say it are the director's, so what is tested here is what this class
// owns: which stories count as new, that each is asked for at most once, that the cooldown rides on
// every request under one key, and that an empty list is the watch switched off.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';

import { BREAKING_MAX_AGE_MS, BREAKING_REQUEST_KEY, BreakingNewsWatch } from '../../../src/modules/director/breaking.news.watch.js';
import {
    BREAKING_KEYS,
    DEFAULT_BREAKING_COOLDOWN_MINUTES,
    MIN_BREAKING_COOLDOWN_MINUTES,
} from '../../../src/modules/director/breaking.news.settings.js';
import { ReadLog } from '../../../src/modules/director/bulletin.source.js';
import type { ReadLogStore } from '../../../src/modules/director/bulletin.read.store.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { NewsService } from '../../../src/modules/news/news.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const MINUTE = 60_000;
const ALERTS = 'deadair.rss:alerts';

const story = (id: string, overrides: Partial<NewsItem> = {}): NewsItem => ({
    id,
    feedId: ALERTS,
    feedName: 'Alerts',
    title: `Story ${id}`,
    publishedAt: new Date(NOW - MINUTE).toISOString(),
    ...overrides,
});

/** The setting as the console stores it: a JSON array of one-column rows, as TEXT. */
const feeds = (...ids: string[]) => ({ [BREAKING_KEYS.feeds]: JSON.stringify(ids.map(feed => ({ feed }))) });

interface Options {
    values?: Record<string, string>;
    active?: boolean;
    result?: { accepted: boolean; reason?: string };
    read?: ReadLog;
}

function build(options: Options = {}) {
    /** What each feed answers on the next pass. Tests rewrite it between passes. */
    const pages: Record<string, NewsItem[]> = {};
    const fetchItems = vi.fn(async (query: { feedId?: string }) => pages[query.feedId ?? ''] ?? []);
    const news = { hasNews: () => true, fetchItems } as unknown as NewsService;
    const container = {
        createScopedContainer: () => ({ get: () => news, disposeAsync: async () => {} }),
    } as unknown as Container;

    const state = { active: options.active ?? true };
    const requestBreak = vi.fn(async () => options.result ?? { accepted: true, requestId: 'req-1', segmentId: 'seg-1' });
    const director = { requestBreak, status: () => ({ active: state.active }) } as unknown as DirectorService;

    const values: Record<string, string> = options.values ?? feeds(ALERTS);
    const config = { get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) } as unknown as AppConfig;
    const read = options.read ?? readLog();

    return { watch: new BreakingNewsWatch(container, director, read, config, logger), pages, fetchItems, requestBreak, state };
}

const readLog = (): ReadLog => {
    const store = { load: vi.fn(async () => new Map()), save: vi.fn(async () => {}), prune: vi.fn(async () => {}) };
    return new ReadLog(store as unknown as ReadLogStore, logger);
};

beforeEach(() => vi.clearAllMocks());

describe('BreakingNewsWatch', () => {
    it('takes the first answer as the baseline, then asks for a new story once, at the next boundary', async () => {
        const { watch, pages, requestBreak } = build();
        pages[ALERTS] = [story('a'), story('b')];

        await watch.pass(NOW);
        expect(requestBreak).not.toHaveBeenCalled();

        pages[ALERTS] = [story('c'), story('a'), story('b')];
        await watch.pass(NOW + 5 * MINUTE);

        expect(requestBreak).toHaveBeenCalledTimes(1);
        expect(requestBreak).toHaveBeenCalledWith({
            kind: 'news',
            urgency: 'next',
            source: 'news',
            reason: 'a new story on Alerts',
            key: BREAKING_REQUEST_KEY,
            cooldownMs: DEFAULT_BREAKING_COOLDOWN_MINUTES * MINUTE,
            context: { headline: 'Story c', feedId: ALERTS, itemId: 'c' },
        });
    });

    it('never asks for the same id twice, even re-dated', async () => {
        const { watch, pages, requestBreak } = build();
        pages[ALERTS] = [];
        await watch.pass(NOW);

        pages[ALERTS] = [story('c')];
        await watch.pass(NOW + 5 * MINUTE);
        pages[ALERTS] = [story('c', { publishedAt: new Date(NOW + 9 * MINUTE).toISOString() })];
        await watch.pass(NOW + 10 * MINUTE);

        expect(requestBreak).toHaveBeenCalledTimes(1);
    });

    it('does not retry a story the cooldown turned away', async () => {
        // The director holds the cooldown against the request table; what this class owns is that a
        // story it held off is gone rather than queued, since twenty minutes on it is not breaking.
        const { watch, pages, requestBreak } = build({ result: { accepted: false, reason: 'the station already took a news recently' } });
        pages[ALERTS] = [];
        await watch.pass(NOW);

        pages[ALERTS] = [story('c')];
        await watch.pass(NOW + 5 * MINUTE);
        await watch.pass(NOW + 10 * MINUTE);

        expect(requestBreak).toHaveBeenCalledTimes(1);
    });

    it('sends the cooldown from the setting, as text, clamped to its floor', async () => {
        const { watch, pages, requestBreak } = build({ values: { ...feeds(ALERTS), [BREAKING_KEYS.cooldownMinutes]: '1' } });
        pages[ALERTS] = [];
        await watch.pass(NOW);
        pages[ALERTS] = [story('c')];
        await watch.pass(NOW + 5 * MINUTE);

        expect(requestBreak).toHaveBeenCalledWith(expect.objectContaining({ cooldownMs: MIN_BREAKING_COOLDOWN_MINUTES * MINUTE }));
    });

    it('asks for only the newest when several arrive at once', async () => {
        const { watch, pages, requestBreak } = build();
        pages[ALERTS] = [];
        await watch.pass(NOW);

        pages[ALERTS] = [
            story('old', { publishedAt: new Date(NOW - 10 * MINUTE).toISOString() }),
            story('new', { publishedAt: new Date(NOW).toISOString() }),
        ];
        await watch.pass(NOW + 5 * MINUTE);
        await watch.pass(NOW + 10 * MINUTE);

        expect(requestBreak).toHaveBeenCalledTimes(1);
        expect(requestBreak).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ itemId: 'new' }) }));
    });

    it('skips a story an ordinary bulletin has already read', async () => {
        const read = readLog();
        await read.keep(['Story c'], NOW);
        const { watch, pages, requestBreak } = build({ read });
        pages[ALERTS] = [];
        await watch.pass(NOW);

        pages[ALERTS] = [story('c')];
        await watch.pass(NOW + 5 * MINUTE);

        expect(requestBreak).not.toHaveBeenCalled();
    });

    it('asks only for what was published inside the breaking window, headlines only', async () => {
        const { watch, fetchItems } = build();

        await watch.pass(NOW);

        expect(fetchItems).toHaveBeenCalledWith({
            feedId: ALERTS,
            limit: 10,
            since: new Date(NOW - BREAKING_MAX_AGE_MS).toISOString(),
            headlinesOnly: true,
        });
    });

    it('is off, and asks nobody anything, when the list is empty', async () => {
        const { watch, fetchItems, requestBreak } = build({ values: {} });

        await watch.pass(NOW);
        await watch.pass(NOW + 5 * MINUTE);

        expect(fetchItems).not.toHaveBeenCalled();
        expect(requestBreak).not.toHaveBeenCalled();
    });

    it('asks nothing off air, and starts from a fresh baseline when the station comes back', async () => {
        const { watch, pages, fetchItems, requestBreak, state } = build();
        pages[ALERTS] = [];
        await watch.pass(NOW);

        state.active = false;
        pages[ALERTS] = [story('c')];
        await watch.pass(NOW + 5 * MINUTE);
        expect(fetchItems).toHaveBeenCalledTimes(1);

        // Back on air: what arrived while it was off is the new baseline, not a story to break in with.
        state.active = true;
        await watch.pass(NOW + 10 * MINUTE);

        expect(requestBreak).not.toHaveBeenCalled();
    });

    it('cannot take its timer down with a throw', async () => {
        const { watch, fetchItems } = build();
        fetchItems.mockRejectedValueOnce(new Error('the news module is gone'));

        await expect(watch.pass(NOW)).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});
