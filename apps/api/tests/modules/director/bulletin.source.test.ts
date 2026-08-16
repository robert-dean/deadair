// What a bulletin is written from. The decisions worth pinning are the ones that only exist here:
// that no other kind of break pays for a fetch, that a stale feed produces no bulletin rather than
// yesterday's, and that a headline arrives speakable so neither writer has to make it so.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';

import { BULLETIN_KEYS, BulletinSource, DEFAULT_STORY_COUNT } from '../../../src/modules/director/bulletin.source.js';
import { NEWS_KIND } from '../../../src/modules/director/news.break.writer.js';
import type { NewsService } from '../../../src/modules/news/news.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

const item = (title: string, overrides: Partial<NewsItem> = {}): NewsItem => ({
    id: `id-${title}`,
    feedId: 'deadair.rss:world',
    feedName: 'World news',
    title,
    publishedAt: '2026-08-15T11:00:00.000Z',
    ...overrides,
});

interface Options {
    hasNews?: boolean;
    items?: NewsItem[];
    throws?: boolean;
}

function build(options: Options = {}, values: Record<string, unknown> = {}) {
    const fetchItems = vi.fn(async (_query: { feedId?: string; limit: number; since?: string }): Promise<NewsItem[]> => {
        if (options.throws) throw new Error('the news module is gone');
        return options.items ?? [item('Bridge reopens after four years')];
    });
    const news = { hasNews: () => options.hasNews ?? true, fetchItems } as unknown as NewsService;

    return { source: new BulletinSource(news, config(values), logger), fetchItems };
}

beforeEach(() => vi.clearAllMocks());

describe('which breaks get stories at all', () => {
    it('answers undefined for a kind that does not report, without asking anything', async () => {
        const { source, fetchItems } = build();

        expect(await source.storiesFor('talkbreak', NOW)).toBeUndefined();
        expect(await source.storiesFor('welcome', NOW)).toBeUndefined();
        expect(fetchItems).not.toHaveBeenCalled();
    });

    it('answers with no stories, rather than undefined, when the station has no news plugin', async () => {
        // The difference matters to the writer: `undefined` means "not that sort of break" and an
        // empty list means "that sort of break, and nothing to say", which is a decline.
        const { source, fetchItems } = build({ hasNews: false });

        expect(await source.storiesFor(NEWS_KIND, NOW)).toEqual([]);
        expect(fetchItems).not.toHaveBeenCalled();
    });

    it('absorbs a failure into an empty bulletin rather than failing the break', async () => {
        const { source } = build({ throws: true });

        expect(await source.storiesFor(NEWS_KIND, NOW)).toEqual([]);
    });
});

describe('what it asks for', () => {
    it('asks only for stories fresh enough to read as news', async () => {
        const { source, fetchItems } = build({}, { [BULLETIN_KEYS.maxAgeHours]: 6 });

        await source.storiesFor(NEWS_KIND, NOW);

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-08-15T06:00:00.000Z' }));
    });

    it('measures that window from when the bulletin AIRS, not from now', async () => {
        const { source, fetchItems } = build({}, { [BULLETIN_KEYS.maxAgeHours]: 1 });

        await source.storiesFor(NEWS_KIND, NOW + 900_000);

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-08-15T11:15:00.000Z' }));
    });

    it('reaches further down the page than it will read, so a dropped story does not shorten the bulletin', async () => {
        const { source, fetchItems } = build();

        await source.storiesFor(NEWS_KIND, NOW);

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ limit: DEFAULT_STORY_COUNT * 2 }));
    });

    it('reads across every feed unless the operator named one', async () => {
        const { source, fetchItems } = build();
        await source.storiesFor(NEWS_KIND, NOW);
        expect(fetchItems.mock.calls[0]?.[0]).not.toHaveProperty('feedId');

        const named = build({}, { [BULLETIN_KEYS.feed]: 'deadair.rss:world' });
        await named.source.storiesFor(NEWS_KIND, NOW);
        expect(named.fetchItems).toHaveBeenCalledWith(expect.objectContaining({ feedId: 'deadair.rss:world' }));
    });

    it('holds a mistyped count inside its bounds instead of reading a ten-minute bulletin', async () => {
        const { source } = build({ items: Array.from({ length: 40 }, (_, at) => item(`Story ${at}`)) }, { [BULLETIN_KEYS.stories]: 500 });

        expect((await source.storiesFor(NEWS_KIND, NOW))?.length).toBeLessThanOrEqual(8);
    });
});

describe('what a writer is handed', () => {
    it('puts a full stop on a headline so three do not run into one sentence', async () => {
        const { source } = build({ items: [item('Bridge reopens after four years')] });

        expect(await source.storiesFor(NEWS_KIND, NOW)).toEqual([
            expect.objectContaining({ headline: 'Bridge reopens after four years.', source: 'World news' }),
        ]);
    });

    it("takes the publisher's own name off the end, which is furniture rather than a sentence", async () => {
        const { source } = build({ items: [item('Bridge reopens after four years - BBC News'), item('Council votes | Sky News')] });

        expect((await source.storiesFor(NEWS_KIND, NOW))?.map(one => one.headline)).toEqual(['Bridge reopens after four years.', 'Council votes.']);
    });

    it('leaves a dash that is part of the headline alone', async () => {
        const { source } = build({ items: [item('Council votes — and then adjourns for the summer recess after four hours')] });

        expect((await source.storiesFor(NEWS_KIND, NOW))?.[0]?.headline).toBe(
            'Council votes — and then adjourns for the summer recess after four hours.',
        );
    });

    it('keeps the order the news came in, and cuts to the number asked for', async () => {
        const { source } = build({ items: [item('First'), item('Second'), item('Third')] }, { [BULLETIN_KEYS.stories]: 2 });

        expect((await source.storiesFor(NEWS_KIND, NOW))?.map(one => one.headline)).toEqual(['First.', 'Second.']);
    });

    it('drops a story with no headline rather than reading a pause', async () => {
        const { source } = build({ items: [item('   '), item('Real')] });

        expect((await source.storiesFor(NEWS_KIND, NOW))?.map(one => one.headline)).toEqual(['Real.']);
    });

    it('carries the teaser as background, bounded', async () => {
        const { source } = build({ items: [item('Bridge reopens', { summary: 'x'.repeat(400) })] });

        const [story] = (await source.storiesFor(NEWS_KIND, NOW)) ?? [];
        expect(story?.summary?.length).toBe(240);
    });

    // The substrate a bulletin is actually written from. A teaser is one sentence restating the
    // headline, so a break written from headline and teaser alone says the same thing twice.
    it('carries the story itself, beside the teaser rather than instead of it', async () => {
        const { source } = build({
            items: [item('Bridge reopens', { summary: 'A teaser.', content: 'The council voted to reopen the crossing this morning.' })],
        });

        const [story] = (await source.storiesFor(NEWS_KIND, NOW)) ?? [];
        expect(story).toMatchObject({
            headline: 'Bridge reopens.',
            summary: 'A teaser.',
            body: 'The council voted to reopen the crossing this morning.',
        });
    });

    // A story that stops mid-clause is something a model finishes out of its own head, and a
    // bulletin is the one break where inventing the end of a sentence states something false.
    it('cuts a long story on a sentence rather than mid-clause', async () => {
        const sentence = 'The inquiry heard from a further eleven witnesses during the afternoon session. ';
        const { source } = build({ items: [item('Inquiry continues', { content: sentence.repeat(20) })] });

        const [story] = (await source.storiesFor(NEWS_KIND, NOW)) ?? [];
        expect(story?.body?.length).toBeLessThanOrEqual(700);
        expect(story?.body?.endsWith('session.')).toBe(true);
    });

    it('leaves the story off entirely when the page carried none', async () => {
        const { source } = build({ items: [item('Bridge reopens', { summary: 'A teaser.' })] });

        const [story] = (await source.storiesFor(NEWS_KIND, NOW)) ?? [];
        expect(story?.body).toBeUndefined();
        expect(story?.summary).toBe('A teaser.');
    });
});
