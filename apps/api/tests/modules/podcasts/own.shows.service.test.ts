// A show the station makes is a saved recipe, and what is worth pinning is that an episode is asked for
// through the same path the Productions page uses, with the show's defaults applied and the episode
// filed under it; that its own topic beats the show's standing one; and that an episode with nothing to
// be about is refused rather than made about nothing in particular.

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import type { NewsItem } from '@deadair/plugin-sdk';
import { episodeTitle, newsSourcesOf, OwnShowsService } from '../../../src/modules/podcasts/own.shows.service.js';
import type { OwnShowRecord } from '../../../src/modules/podcasts/own.show.js';

const WIND_DOWN: OwnShowRecord = {
    id: 'show-1',
    title: 'Wind-down',
    subject: 'something calm and interesting to fall asleep to',
    personaId: 'persona-1',
    targetMs: 40 * 60_000,
    writingMode: 'outlined',
    createdAt: 0,
};

/** `none` for a station with no such show, since an absent argument is the default one. */
function build(given: OwnShowRecord | 'none' = WIND_DOWN) {
    const show = given === 'none' ? undefined : given;
    const shows = {
        find: vi.fn(async () => show),
        list: vi.fn(async () => (show === undefined ? [] : [show])),
        create: vi.fn(async (write: Omit<OwnShowRecord, 'id' | 'createdAt'>) => ({ ...write, id: 'show-2', createdAt: 0 })),
        update: vi.fn(async () => show),
        remove: vi.fn(async () => show !== undefined),
    };
    const commission = vi.fn(async () => ({ id: 'prod-1' }));
    const listForShow = vi.fn(async () => ({ productions: [] }));
    const fetchItems = vi.fn(async (_query: { feedId?: string; since?: string; limit: number }): Promise<NewsItem[]> => []);
    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

    const service = new OwnShowsService(shows as never, { commission, listForShow } as never, { fetchItems } as never, config);
    return { service, shows, commission, listForShow, fetchItems };
}

describe('OwnShowsService.requestEpisode', () => {
    it("asks for a production with the show's defaults, filed under the show", async () => {
        const { service, commission } = build();
        const airAt = DateTime.fromISO('2026-10-12T23:00:00Z');

        await service.requestEpisode('show-1', { airAt });

        expect(commission).toHaveBeenCalledWith(
            {
                kind: 'podcast',
                title: expect.stringMatching(/^Wind-down, /),
                brief: 'something calm and interesting to fall asleep to',
                personaId: 'persona-1',
                targetMs: 40 * 60_000,
                writingMode: 'outlined',
                scheduledFor: airAt,
            },
            { showId: 'show-1' },
        );
    });

    it("makes the episode's own topic its subject, and its title", async () => {
        const { service, commission } = build();

        await service.requestEpisode('show-1', { topic: 'lighthouses and the people who kept them' });

        expect(commission).toHaveBeenCalledWith(
            expect.objectContaining({
                brief: 'lighthouses and the people who kept them',
                title: 'Wind-down: lighthouses and the people who kept them',
            }),
            { showId: 'show-1' },
        );
    });

    it('hands pasted text over as a source to read, named if it was named', async () => {
        const { service, commission } = build();

        await service.requestEpisode('show-1', { text: '  The keeper lit the lamp at dusk.  ', sourceTitle: "A keeper's log" });
        await service.requestEpisode('show-1', { text: 'The keeper lit the lamp at dusk.' });

        expect(commission).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ sources: [{ title: "A keeper's log", text: 'The keeper lit the lamp at dusk.' }] }),
            { showId: 'show-1' },
        );
        expect(commission).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ sources: [{ title: 'Pasted text', text: 'The keeper lit the lamp at dusk.' }] }),
            {
                showId: 'show-1',
            },
        );
    });

    it('refuses an episode of a show with no subject when it is given nothing to be about', async () => {
        const { service, commission } = build({ id: 'show-3', title: 'Anything', createdAt: 0 });

        await expect(service.requestEpisode('show-3', {})).rejects.toMatchObject({ statusCode: 400 });
        expect(commission).not.toHaveBeenCalled();
    });

    it('says a show that does not exist does not', async () => {
        const { service } = build('none');

        await expect(service.requestEpisode('nope', { topic: 'anything' })).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.episodes('nope')).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('an episode made from a page', () => {
    it('hands the address over to be read, titled by it until the page is read', async () => {
        const { service, commission } = build();

        await service.requestEpisode('show-1', { url: 'https://example.com/keepers' });

        expect(commission).toHaveBeenCalledWith(
            expect.objectContaining({ sources: [{ title: 'https://example.com/keepers', url: 'https://example.com/keepers' }] }),
            { showId: 'show-1' },
        );
    });

    it('reads the page instead of the news on a show that reads the news', async () => {
        const { service, fetchItems, commission } = build({ id: 'show-4', title: 'News in depth', newsFeedIds: ['deadair.rss:world'], createdAt: 0 });

        await service.requestEpisode('show-4', { url: 'https://example.com/one-story' });

        expect(fetchItems).not.toHaveBeenCalled();
        expect(commission).toHaveBeenCalledWith(
            expect.objectContaining({ sources: [{ title: 'https://example.com/one-story', url: 'https://example.com/one-story' }] }),
            {
                showId: 'show-4',
            },
        );
    });
});

describe('a show that researches its episodes', () => {
    const RESEARCHED: OwnShowRecord = { ...WIND_DOWN, id: 'show-5', research: true };

    it('asks for an episode given nothing to read to find its own sources', async () => {
        const { service, commission } = build(RESEARCHED);

        await service.requestEpisode('show-5', { topic: 'lighthouse keepers' });

        expect(commission).toHaveBeenCalledWith(expect.objectContaining({ brief: 'lighthouse keepers', research: true }), { showId: 'show-5' });
    });

    it('reads what it was given instead when it was given something', async () => {
        const { service, commission } = build(RESEARCHED);

        await service.requestEpisode('show-5', { url: 'https://example.com/keepers' });

        expect(commission).toHaveBeenCalledWith(expect.not.objectContaining({ research: true }), { showId: 'show-5' });
    });
});

describe('OwnShowsService.create', () => {
    it('stores an empty box as nothing rather than as an empty string', async () => {
        const { service, shows } = build();

        await service.create({ title: '  News in depth ', description: '  ', subject: 'the day in depth' });

        expect(shows.create).toHaveBeenCalledWith({ title: 'News in depth', subject: 'the day in depth' });
    });
});

describe('episodeTitle', () => {
    it('names an episode with no topic after its show and the day', () => {
        expect(episodeTitle({ title: 'Wind-down' }, '', Date.UTC(2026, 9, 12, 22, 0), 'Europe/London')).toBe('Wind-down, Mon 12 Oct');
    });

    it('cuts a long topic short in the title', () => {
        const title = episodeTitle({ title: 'Wind-down' }, 'a'.repeat(400), 0, 'UTC');

        expect(title.length).toBeLessThan(140);
        expect(title.endsWith('…')).toBe(true);
    });
});

// "News in depth" over the washing up: an episode reads the station's own feeds when it is asked for,
// through the same service the bulletin reads them through, and hands the stories over to be researched.
describe('a show that reads the news', () => {
    const NEWS: OwnShowRecord = { id: 'show-4', title: 'News in depth', newsFeedIds: ['deadair.rss:world'], newsHours: 6, createdAt: 0 };
    const story = (over: Partial<NewsItem> = {}): NewsItem => ({
        id: 'story-1',
        feedId: 'world',
        feedName: 'World',
        title: 'A bridge reopens',
        content: 'The bridge reopened on Monday after two years of repairs.',
        url: 'https://example.com/bridge',
        publishedAt: '2026-10-12T08:00:00.000Z',
        ...over,
    });

    it("reads the show's feeds within its window and hands the stories over as sources", async () => {
        const { service, fetchItems, commission } = build(NEWS);
        fetchItems.mockResolvedValue([story()]);

        await service.requestEpisode('show-4', {});

        const query = fetchItems.mock.calls[0]?.[0];
        expect(query?.feedId).toBe('deadair.rss:world');
        expect(Date.now() - Date.parse(query?.since ?? '')).toBeGreaterThanOrEqual(6 * 60 * 60_000 - 1_000);
        expect(commission).toHaveBeenCalledWith(
            expect.objectContaining({
                brief: expect.stringContaining('news in depth'),
                sources: [
                    {
                        title: 'A bridge reopens',
                        url: 'https://example.com/bridge',
                        text: 'The bridge reopened on Monday after two years of repairs.',
                    },
                ],
            }),
            { showId: 'show-4' },
        );
    });

    it('reads what was pasted instead of the feeds', async () => {
        const { service, fetchItems, commission } = build(NEWS);

        await service.requestEpisode('show-4', { text: 'One story in full.' });

        expect(fetchItems).not.toHaveBeenCalled();
        expect(commission).toHaveBeenCalledWith(expect.objectContaining({ sources: [{ title: 'Pasted text', text: 'One story in full.' }] }), {
            showId: 'show-4',
        });
    });

    it('refuses an episode when the feeds had nothing in the window, rather than queue one that can only fail', async () => {
        const { service, commission } = build(NEWS);

        await expect(service.requestEpisode('show-4', {})).rejects.toMatchObject({ statusCode: 400 });
        expect(commission).not.toHaveBeenCalled();
    });
});

describe('newsSourcesOf', () => {
    const item = (id: string, publishedAt: string, over: Partial<NewsItem> = {}): NewsItem => ({
        id,
        feedId: 'world',
        feedName: 'World',
        title: `Story ${id}`,
        summary: `What happened in ${id}.`,
        url: `https://example.com/${id}`,
        publishedAt,
        ...over,
    });

    it('takes the newest stories with words in them, each once, up to the bound', () => {
        const sources = newsSourcesOf(
            [
                item('a', '2026-10-12T06:00:00Z'),
                item('b', '2026-10-12T09:00:00Z'),
                item('c', '2026-10-12T08:00:00Z', { summary: undefined }),
                item('d', '2026-10-12T07:00:00Z', { url: 'https://example.com/b' }),
            ],
            2,
        );

        expect(sources.map(source => source.title)).toEqual(['Story b', 'Story a']);
    });
});
