// The tool is an adapter over `NewsService` and nothing else, so what is worth testing is the shape
// of what the model sees: that a station with no news plugin is offered no tool at all rather than
// one that always answers "there is no news", that the feed list rides along with every answer so
// naming a feed costs no second call, and that what comes back is sentences rather than links.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';

import type { NewsService } from '../../../src/modules/news/news.service.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
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
    /** The station's own categories. None by default, which is what a fresh install had. */
    topics?: Topic[];
}

/** One of the operator's categories, as the classifier reads it. */
const category = (key: string, label: string, config: Record<string, unknown>): Topic => ({
    id: `topic-${key}`,
    kind: 'news',
    key,
    label,
    config,
    position: 0,
});

function build(options: ServiceOptions = {}) {
    const listFeeds = vi.fn(async () => options.feeds ?? [{ id: FEED, pluginId: 'deadair.rss', name: 'World news', category: 'world' }]);
    const fetchItems = vi.fn(async (_query: { feedId?: string; limit: number; since?: string }): Promise<NewsItem[]> => options.stories ?? [story()]);
    const news = {
        hasNews: () => options.hasNews ?? true,
        listFeeds,
        fetchItems,
    } as unknown as NewsService;

    const topics = { list: vi.fn(async () => options.topics ?? []) } as unknown as TopicRepository;

    return { tool: new NewsTool(news, topics, logger), listFeeds, fetchItems };
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

// A DJ asking "what is happening in technology" is asking a real question, and the answer has to be
// the station's own vocabulary rather than a word the model made up — otherwise an empty list is
// indistinguishable from a category nobody defined.
describe('the station’s own categories', () => {
    const technology = category('technology', 'Technology', { labels: ['Technology'], words: ['semiconductor'] });

    it('offers no category parameter at all on a station that has named none', async () => {
        const { tool } = build();
        const [declared] = await tool.tools();

        expect(declared?.declaration.parameters.properties).not.toHaveProperty('topic');
    });

    it('offers the categories the operator wrote, by their keys', async () => {
        const { tool } = build({ topics: [technology] });
        const [declared] = await tool.tools();

        const topic = (declared?.declaration.parameters.properties as Record<string, { enum?: string[] }>).topic;
        expect(topic?.enum).toEqual(['technology']);
    });

    it('cuts the answer to the category asked for', async () => {
        const { tool } = build({
            topics: [technology],
            stories: [story({ title: 'Semiconductor plant reopens' }), story({ id: 'other', title: 'Council votes on the harbour' })],
        });
        const [declared] = await tool.tools();

        const answer = (await declared!.run({ topic: 'technology' })) as { stories: { title: string }[] };

        expect(answer.stories.map(one => one.title)).toEqual(['Semiconductor plant reopens']);
    });

    it('says an empty category is about the station rather than about the world', async () => {
        // A model that asked for technology and got nothing cannot otherwise tell "nothing has
        // happened" from "this station follows no technology feeds", and those want different next
        // moves. Widening the answer back out silently would teach it that its filter works.
        const { tool } = build({ topics: [technology], stories: [story({ title: 'Council votes on the harbour' })] });
        const [declared] = await tool.tools();

        const answer = (await declared!.run({ topic: 'technology' })) as { stories: unknown[]; note?: string };

        expect(answer.stories).toEqual([]);
        expect(answer.note).toMatch(/feeds rather than about the world/);
    });
});
