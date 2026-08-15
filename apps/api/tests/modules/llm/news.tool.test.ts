// The tool is an adapter over `NewsService` and nothing else, so what is worth testing is the shape
// of what the model sees: that a station with no news plugin is offered no tool at all rather than
// one that always answers "there is no news", that the feed list rides along with every answer so
// naming a feed costs no second call, and that what comes back is sentences rather than links.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';

import type { NewsService } from '../../../src/modules/news/news.service.js';
import { NewsTool } from '../../../src/modules/llm/news.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const FEED = 'deadair.rss:world';

const story = (overrides: Partial<NewsItem> = {}): NewsItem => ({
    id: `${FEED}:g1`,
    feedId: FEED,
    feedName: 'World news',
    title: 'Bridge reopens after four years',
    summary: 'The crossing reopened this morning and traffic is moving.',
    url: 'https://example.com/bridge',
    publishedAt: '2026-08-15T08:41:00.000Z',
    ...overrides,
});

interface ServiceOptions {
    hasNews?: boolean;
    feeds?: { id: string; pluginId: string; name: string; category?: string }[];
    stories?: NewsItem[];
}

function build(options: ServiceOptions = {}) {
    const listFeeds = vi.fn(async () => options.feeds ?? [{ id: FEED, pluginId: 'deadair.rss', name: 'World news', category: 'world' }]);
    const fetchItems = vi.fn(async (_query: { feedId?: string; limit: number; since?: string }): Promise<NewsItem[]> => options.stories ?? [story()]);
    const news = {
        hasNews: () => options.hasNews ?? true,
        listFeeds,
        fetchItems,
    } as unknown as NewsService;

    return { tool: new NewsTool(news, logger), listFeeds, fetchItems };
}

const only = async (tool: NewsTool) => (await tool.tools())[0]!;

describe('what is offered', () => {
    it('offers nothing at all when no news plugin is installed', async () => {
        // Not a tool that answers "there is no news": that declaration is context spent teaching the
        // model about something that cannot help it.
        const { tool } = build({ hasNews: false });

        expect(await tool.tools()).toEqual([]);
    });

    it('offers one tool that can be called with nothing at all', async () => {
        const declaration = (await only(build().tool)).declaration;

        expect(declaration.name).toBe('read_news');
        expect(declaration.parameters.required).toEqual([]);
    });
});

describe('what comes back', () => {
    it('answers with the headlines and the feeds they came from, in one call', async () => {
        const { tool } = build();

        const answer = (await (await only(tool)).run({})) as { feeds: unknown[]; stories: Record<string, unknown>[] };

        expect(answer.feeds).toEqual([{ id: FEED, name: 'World news', category: 'world' }]);
        expect(answer.stories[0]).toMatchObject({
            feedId: FEED,
            feedName: 'World news',
            title: 'Bridge reopens after four years',
            summary: 'The crossing reopened this morning and traffic is moving.',
        });
    });

    it('does not hand the model a link, which it cannot follow and should not read out', async () => {
        const { tool } = build();

        const answer = (await (await only(tool)).run({})) as { stories: Record<string, unknown>[] };

        expect(answer.stories[0]).not.toHaveProperty('url');
    });

    it('passes a named feed through as the model spelled it', async () => {
        const { tool, fetchItems } = build();

        await (await only(tool)).run({ feedId: FEED, since: '2026-08-15T00:00:00.000Z' });

        expect(fetchItems).toHaveBeenCalledWith({ feedId: FEED, limit: 10, since: '2026-08-15T00:00:00.000Z' });
    });

    it('ignores a blank argument, which is what a model filling every field produces', async () => {
        const { tool, fetchItems } = build();

        await (await only(tool)).run({ feedId: '  ', since: '' });

        expect(fetchItems).toHaveBeenCalledWith({ limit: 10 });
    });

    it('clamps a limit the model invented', async () => {
        const { tool, fetchItems } = build();

        await (await only(tool)).run({ limit: 500 });

        expect(fetchItems).toHaveBeenCalledWith({ limit: 10 });
    });

    it('reports finding nothing as an empty list rather than as a failure', async () => {
        const { tool } = build({ stories: [] });

        await expect((await only(tool)).run({})).resolves.toMatchObject({ stories: [] });
    });
});
