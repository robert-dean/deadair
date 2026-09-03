// What a bulletin is written from. The decisions worth pinning are the ones that only exist here:
// that no other kind of break pays for a fetch, that a stale feed produces no bulletin rather than
// yesterday's, and that a headline arrives speakable so neither writer has to make it so.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';

import {
    BULLETIN_KEYS,
    BulletinSource,
    CategoryWatch,
    DEFAULT_STORY_COUNT_MAX,
    DEFAULT_STORY_COUNT_MIN,
    MAX_STORY_COUNT,
    ReadLog,
} from '../../../src/modules/director/bulletin.source.js';
import { NEWS_KIND } from '../../../src/modules/director/news.break.writer.js';
import type { NewsService } from '../../../src/modules/news/news.service.js';
import { NEWS_FEEDS_KEY } from '../../../src/modules/news/news.settings.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';

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
    /**
     * The log to read against, when a test needs one to outlive the source.
     *
     * Defaults to a fresh one, which is a source that has never read anything. Pass a shared one to
     * model what the container actually builds: `BulletinSource` is `asScoped()` and `ReadLog` is a
     * singleton, so every bulletin gets a NEW source and the SAME log.
     */
    read?: ReadLog;
    /**
     * The station's own categories.
     *
     * Defaults to none, which is what every station had before they existed and is the case most of
     * these tests are about: nothing is classified, nothing is cut, and the page is read in order.
     */
    topics?: Topic[];
    /** The edge tracker. Shared where a test needs a second bulletin to see what the first reported. */
    watch?: CategoryWatch;
    /**
     * What each feed says it IS, keyed by qualified feed id.
     *
     * Defaults to none, which is a station whose feeds are all uncategorised: every story is judged
     * on what it says, which is what most of these tests are about.
     */
    feedCategories?: Record<string, string>;
    /**
     * What each feed answers, for the cases about the station's own order.
     *
     * Only consulted when a feed was named, which is what a roster does: without one the source asks
     * for everything at once and {@link Options.items} is the whole page.
     */
    byFeed?: Record<string, NewsItem[]>;
}

/** One of the operator's categories, as the classifier will read it. */
const category = (key: string, config: Record<string, unknown>): Topic => ({
    id: `topic-${key}`,
    kind: NEWS_KIND,
    key,
    label: key === 'technology' ? 'Technology' : key,
    config,
    position: 0,
});

const activity = { record: vi.fn(async () => {}) } as unknown as ActivityRecorder;

/** The station's own feed list, as the settings row holds it: a JSON array of one-column rows. */
const roster = (...feedIds: string[]): Record<string, unknown> => ({
    [NEWS_FEEDS_KEY]: JSON.stringify(feedIds.map(feed => ({ feed }))),
});

function build(options: Options = {}, values: Record<string, unknown> = {}) {
    const fetchItems = vi.fn(async (query: { feedId?: string; limit: number; since?: string }): Promise<NewsItem[]> => {
        if (options.throws) throw new Error('the news module is gone');
        // A roster asks feed by feed, so a test about ordering has to be able to answer each one
        // differently. Everything else is one page whichever feed asked for it.
        if (query.feedId !== undefined && options.byFeed !== undefined) return options.byFeed[query.feedId] ?? [];
        return options.items ?? [item('Bridge reopens after four years')];
    });
    const feedCategories = vi.fn(async () => new Map(Object.entries(options.feedCategories ?? {})));
    const news = { hasNews: () => options.hasNews ?? true, fetchItems, feedCategories } as unknown as NewsService;

    const topics = { list: vi.fn(async () => options.topics ?? []) } as unknown as TopicRepository;
    const watch = options.watch ?? new CategoryWatch(activity, logger);

    // The count is a RANGE now and almost every case below is about something else, so it is pinned
    // to a fixed three unless the case sets its own ends. A test left to roll would pass or fail on
    // the dice rather than on what it is checking.
    const pinned = { [BULLETIN_KEYS.storiesMin]: 3, [BULLETIN_KEYS.storiesMax]: 3, ...values };

    return { source: new BulletinSource(news, options.read ?? new ReadLog(), topics, watch, config(pinned), logger), fetchItems, watch };
}

beforeEach(() => vi.clearAllMocks());

describe('which breaks get stories at all', () => {
    it('answers undefined for a kind that does not report, without asking anything', async () => {
        const { source, fetchItems } = build();

        expect(await source.storiesFor('talkbreak', undefined, NOW)).toBeUndefined();
        expect(await source.storiesFor('welcome', undefined, NOW)).toBeUndefined();
        expect(fetchItems).not.toHaveBeenCalled();
    });

    it('answers with no stories, rather than undefined, when the station has no news plugin', async () => {
        // The difference matters to the writer: `undefined` means "not that sort of break" and an
        // empty list means "that sort of break, and nothing to say", which is a decline.
        const { source, fetchItems } = build({ hasNews: false });

        expect(await source.storiesFor(NEWS_KIND, undefined, NOW)).toEqual({ stories: [] });
        expect(fetchItems).not.toHaveBeenCalled();
    });

    it('absorbs a failure into an empty bulletin rather than failing the break', async () => {
        const { source } = build({ throws: true });

        expect(await source.storiesFor(NEWS_KIND, undefined, NOW)).toEqual({ stories: [] });
    });
});

// A bulletin's structural length is how many stories it reads, in the way a production's is its
// `target_ms` — the word ceiling is not, being a limit almost nothing reaches. Fixed, the station's
// news is the same shape every half hour.
describe('how many stories one bulletin reads', () => {
    const rolls = (value: number) => () => value;
    const headlines = Array.from({ length: 12 }, (_, at) => item(`Story ${at}`));

    it('reads the station default range, both ends', async () => {
        const fewest = build(
            { items: headlines },
            { [BULLETIN_KEYS.storiesMin]: DEFAULT_STORY_COUNT_MIN, [BULLETIN_KEYS.storiesMax]: DEFAULT_STORY_COUNT_MAX },
        );
        const most = build(
            { items: headlines },
            { [BULLETIN_KEYS.storiesMin]: DEFAULT_STORY_COUNT_MIN, [BULLETIN_KEYS.storiesMax]: DEFAULT_STORY_COUNT_MAX },
        );

        expect((await fewest.source.storiesFor(NEWS_KIND, undefined, NOW, rolls(0)))?.stories).toHaveLength(DEFAULT_STORY_COUNT_MIN);
        expect((await most.source.storiesFor(NEWS_KIND, undefined, NOW, rolls(0.999)))?.stories).toHaveLength(DEFAULT_STORY_COUNT_MAX);
    });

    it('reads one length when both ends agree, which is how an operator asks for a fixed bulletin', async () => {
        const { source } = build({ items: headlines }, { [BULLETIN_KEYS.storiesMin]: 3, [BULLETIN_KEYS.storiesMax]: 3 });

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW, rolls(0.999)))?.stories).toHaveLength(3);
    });

    it('reads the two ends as a pair however they were typed, rather than refusing them', async () => {
        // The resolver rule: a row already stored costs the station its preference, never its
        // ability to read the news. The console refuses the pair where somebody types it.
        const { source } = build({ items: headlines }, { [BULLETIN_KEYS.storiesMin]: 5, [BULLETIN_KEYS.storiesMax]: 2 });

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW, rolls(0)))?.stories).toHaveLength(2);
    });

    it('clamps an end past the ceiling, so a typo cannot produce a ten-minute bulletin', async () => {
        const many = Array.from({ length: 40 }, (_, at) => item(`Story ${at}`));
        const { source } = build({ items: many }, { [BULLETIN_KEYS.storiesMin]: 900, [BULLETIN_KEYS.storiesMax]: 900 });

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW, rolls(0)))?.stories).toHaveLength(MAX_STORY_COUNT);
    });

    it('reaches down the page for the count it actually rolled, not for the fixed one', async () => {
        // `OVERSAMPLE` multiplies whatever was asked for. A roll that reaches past the ask and an
        // ask that reaches past the page are the same failure one step apart.
        const { source, fetchItems } = build({ items: headlines }, { [BULLETIN_KEYS.storiesMin]: 2, [BULLETIN_KEYS.storiesMax]: 4 });

        await source.storiesFor(NEWS_KIND, undefined, NOW, rolls(0.999));

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ limit: 4 * 4 }));
    });
});

describe('what it asks for', () => {
    it('asks only for stories fresh enough to read as news', async () => {
        const { source, fetchItems } = build({}, { [BULLETIN_KEYS.maxAgeHours]: 6 });

        await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-08-15T06:00:00.000Z' }));
    });

    it('measures that window from when the bulletin AIRS, not from now', async () => {
        const { source, fetchItems } = build({}, { [BULLETIN_KEYS.maxAgeHours]: 1 });

        await source.storiesFor(NEWS_KIND, undefined, NOW + 900_000);

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-08-15T11:15:00.000Z' }));
    });

    it('reaches further down the page than it will read, so a dropped story does not shorten the bulletin', async () => {
        // Four times rather than twice, because the ask now has to reach past everything the station
        // has already said as well as past anything with no usable headline.
        const { source, fetchItems } = build();

        await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 * 4 }));
    });

    it('reads across every feed when the station has listed none', async () => {
        const { source, fetchItems } = build();

        await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(fetchItems.mock.calls[0]?.[0]).not.toHaveProperty('feedId');
    });

    // Feed by feed rather than as one merged page, which is what makes the station's order
    // expressible at all: the service merges newest first, so one prolific publisher would
    // otherwise take every slot.
    it('asks each feed the station listed, by name', async () => {
        const { source, fetchItems } = build({}, roster('deadair.rss:world', 'deadair.rss:sport'));

        await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ feedId: 'deadair.rss:world' }));
        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ feedId: 'deadair.rss:sport' }));
        expect(fetchItems).toHaveBeenCalledTimes(2);
    });

    it('reads a feed the station listed twice only once', async () => {
        const { source, fetchItems } = build({}, roster('deadair.rss:world', 'deadair.rss:world'));

        await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(fetchItems).toHaveBeenCalledTimes(1);
    });

    it('holds a mistyped count inside its bounds instead of reading a ten-minute bulletin', async () => {
        const { source } = build(
            { items: Array.from({ length: 40 }, (_, at) => item(`Story ${at}`)) },
            { [BULLETIN_KEYS.storiesMin]: 500, [BULLETIN_KEYS.storiesMax]: 500 },
        );

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories.length).toBeLessThanOrEqual(8);
    });
});

describe('what a writer is handed', () => {
    it('puts a full stop on a headline so three do not run into one sentence', async () => {
        const { source } = build({ items: [item('Bridge reopens after four years')] });

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories).toEqual([
            expect.objectContaining({ headline: 'Bridge reopens after four years.', source: 'World news' }),
        ]);
    });

    it("takes the publisher's own name off the end, which is furniture rather than a sentence", async () => {
        const { source } = build({ items: [item('Bridge reopens after four years - BBC News'), item('Council votes | Sky News')] });

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories.map(one => one.headline)).toEqual([
            'Bridge reopens after four years.',
            'Council votes.',
        ]);
    });

    it('leaves a dash that is part of the headline alone', async () => {
        const { source } = build({ items: [item('Council votes — and then adjourns for the summer recess after four hours')] });

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories[0]?.headline).toBe(
            'Council votes — and then adjourns for the summer recess after four hours.',
        );
    });

    it('keeps the order the news came in, and cuts to the number asked for', async () => {
        const { source } = build(
            { items: [item('First'), item('Second'), item('Third')] },
            { [BULLETIN_KEYS.storiesMin]: 2, [BULLETIN_KEYS.storiesMax]: 2 },
        );

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories.map(one => one.headline)).toEqual(['First.', 'Second.']);
    });

    it('drops a story with no headline rather than reading a pause', async () => {
        const { source } = build({ items: [item('   '), item('Real')] });

        expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories.map(one => one.headline)).toEqual(['Real.']);
    });

    it('carries the teaser as background, bounded', async () => {
        const { source } = build({ items: [item('Bridge reopens', { summary: 'x'.repeat(400) })] });

        const [story] = (await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories ?? [];
        expect(story?.summary?.length).toBe(240);
    });

    // The substrate a bulletin is actually written from. A teaser is one sentence restating the
    // headline, so a break written from headline and teaser alone says the same thing twice.
    it('carries the story itself, beside the teaser rather than instead of it', async () => {
        const { source } = build({
            items: [item('Bridge reopens', { summary: 'A teaser.', content: 'The council voted to reopen the crossing this morning.' })],
        });

        const [story] = (await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories ?? [];
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

        const [story] = (await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories ?? [];
        expect(story?.body?.length).toBeLessThanOrEqual(700);
        expect(story?.body?.endsWith('session.')).toBe(true);
    });

    it('leaves the story off entirely when the page carried none', async () => {
        const { source } = build({ items: [item('Bridge reopens', { summary: 'A teaser.' })] });

        const [story] = (await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories ?? [];
        expect(story?.body).toBeUndefined();
        expect(story?.summary).toBe('A teaser.');
    });

    // Measured on this station: 21 of the 34 stories in its captured prompts had a body that opened
    // with its own headline word for word, so the writer was shown one sentence under two labels and
    // reported it twice. See `withoutEchoedHeadline`.
    describe('a story that opens by repeating its own headline', () => {
        it('takes the headline off the front of the body', async () => {
            const { source } = build({
                items: [item('Bridge reopens after four years', { content: 'Bridge reopens after four years The council voted at dawn.' })],
            });

            const [story] = (await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories ?? [];
            expect(story?.body).toBe('The council voted at dawn.');
        });

        it('takes it off the teaser too, which is the same failure one label along', async () => {
            const { source } = build({ items: [item('Bridge reopens', { summary: 'Bridge reopens — a teaser.' })] });

            expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories[0]?.summary).toBe('a teaser.');
        });

        // The raw title is what a body echoes; `speakable`'s is what the writer is shown. They are
        // different strings whenever a publisher signed its own headline.
        it('matches the raw title, tail and all, not only the headline as read', async () => {
            const { source } = build({
                items: [item('Bridge reopens - BBC News', { content: 'Bridge reopens - BBC News The council voted at dawn.' })],
            });

            const [story] = (await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories ?? [];
            expect(story).toMatchObject({ headline: 'Bridge reopens.', body: 'The council voted at dawn.' });
        });

        it('matches across whitespace the feed laid out differently', async () => {
            const { source } = build({
                items: [item('Bridge reopens after four years', { content: 'Bridge   reopens\n after  four years\n\nThe council voted at dawn.' })],
            });

            expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories[0]?.body).toBe('The council voted at dawn.');
        });

        // Only a prefix and only the whole headline, because anything looser starts cutting the lead
        // sentence off real reporting.
        it('leaves a headline quoted mid-article alone, which is prose rather than an echo', async () => {
            const body = 'The council met at dawn. Bridge reopens after four years, the notice said.';
            const { source } = build({ items: [item('Bridge reopens after four years', { content: body })] });

            expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories[0]?.body).toBe(body);
        });

        it('leaves a body that merely starts with the same few words alone', async () => {
            const body = 'Bridge reopening plans were approved by the council at dawn.';
            const { source } = build({ items: [item('Bridge reopens after four years', { content: body })] });

            expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories[0]?.body).toBe(body);
        });

        // What is left is nothing, which is the "page carried none" branch rather than an empty
        // string the writer would be shown as a story.
        it('leaves no story at all where the body was the headline and nothing else', async () => {
            const { source } = build({ items: [item('Bridge reopens', { content: 'Bridge reopens' })] });

            expect((await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories[0]?.body).toBeUndefined();
        });

        // The cut is what the writer's ceiling is spent on, so the echo has to go first or a story
        // loses its last sentence to a headline it was already shown.
        it('strips before the story is cut, so the ceiling is spent on the story', async () => {
            const headline = 'Inquiry continues into the collapse of the eastern span';
            const sentence = 'The inquiry heard from a further eleven witnesses during the afternoon session. ';
            const { source } = build({ items: [item(headline, { content: `${headline} ${sentence.repeat(20)}` })] });

            const [story] = (await source.storiesFor(NEWS_KIND, undefined, NOW))?.stories ?? [];
            expect(story?.body?.startsWith('The inquiry heard')).toBe(true);
            expect(story?.body?.endsWith('session.')).toBe(true);
        });
    });
});

// The failure measured on air: twenty-seven consecutive bulletins across seven hours read the same
// three stories, because the feed had not moved and the freshness window is twelve hours. Nothing
// remembered the previous bulletin, so "newest first, take three" gave the same three every time.
describe('what the station has already read', () => {
    const three = [item('Bridge reopens after four years'), item('Council votes on the harbour'), item('Ferry service resumes')];

    it('reads a story once and then reaches past it', async () => {
        const { source } = build({ items: [...three, item('Library extends its hours')] });

        const first = await source.storiesFor(NEWS_KIND, undefined, NOW);
        expect(first?.stories.map(story => story.headline)).toContain('Bridge reopens after four years.');

        const second = await source.storiesFor(NEWS_KIND, undefined, NOW);
        expect(second?.stories.map(story => story.headline)).toEqual(['Library extends its hours.']);
    });

    // The lifetime the container actually builds, and the one the tests above cannot see: the source
    // is `asScoped()` and the job runner opens a scope per execution, so a bulletin is written by a
    // source that has never written one before. The log has to be what carries across, which is why
    // it is registered on its own as a singleton.
    //
    // Held as a field on the source, this read the same three stories for ten consecutive bulletins
    // on air while every test above passed.
    it('reaches past what an EARLIER SOURCE read, because each bulletin gets a new one', async () => {
        const read = new ReadLog();
        const items = [...three, item('Library extends its hours')];

        const first = build({ items, read });
        expect((await first.source.storiesFor(NEWS_KIND, undefined, NOW))?.stories.map(story => story.headline)).toEqual([
            'Bridge reopens after four years.',
            'Council votes on the harbour.',
            'Ferry service resumes.',
        ]);

        const second = build({ items, read });
        expect((await second.source.storiesFor(NEWS_KIND, undefined, NOW))?.stories.map(story => story.headline)).toEqual([
            'Library extends its hours.',
        ]);

        const third = build({ items, read });
        expect(await third.source.storiesFor(NEWS_KIND, undefined, NOW)).toEqual({ stories: [] });
    });

    // `repeats` was `offered - using`, which is everything past the cut as well as everything already
    // heard — so it read the same number on a page of fresh stories as on a page of stale ones, and
    // sat at 9 through the ten repeated bulletins that should have been what gave the fault away.
    it('reports how many stories the log turned away, not how many went unused', async () => {
        const read = new ReadLog();
        const items = [...three, item('Library extends its hours')];

        await build({ items, read }).source.storiesFor(NEWS_KIND, undefined, NOW);
        vi.clearAllMocks();

        await build({ items, read }).source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(logger.debug).toHaveBeenCalledWith(
            'director: read the news for a bulletin',
            expect.objectContaining({ offered: 4, using: 1, repeats: 3 }),
        );
    });

    it('declines the slot when everything in the window has been read', async () => {
        // Silence rather than a repeat, on the same argument the freshness window is on: a listener
        // cannot tell a station reading this morning's headlines again from one that is simply wrong.
        const { source } = build({ items: three });

        await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(await source.storiesFor(NEWS_KIND, undefined, NOW)).toEqual({ stories: [] });
    });

    it('says so, at a level an operator will see', async () => {
        // The one line here worth attention: a station whose clock asks for news every half hour and
        // whose publisher posts three stories a day is silent at most bulletins, and only this says
        // why. A `debug` line would leave that looking like the news feature being broken.
        const { source } = build({ items: three });

        await source.storiesFor(NEWS_KIND, undefined, NOW);
        await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/already been read/i));
    });

    it('treats one story under two spellings as one story', async () => {
        // Two newsrooms carrying one headline is two ids and one thing a listener hears twice, which
        // is why the log is keyed on the words rather than on the publisher's id.
        const { source } = build({ items: [item('Bridge reopens after four years')] });
        await source.storiesFor(NEWS_KIND, undefined, NOW);

        const { source: same } = build();
        expect((await same.storiesFor(NEWS_KIND, undefined, NOW))?.stories).toHaveLength(1);

        const again = build({ items: [item('BRIDGE REOPENS, after four years!', { id: 'a-different-publisher' })] }, {});
        await again.source.storiesFor(NEWS_KIND, undefined, NOW);
        expect(await again.source.storiesFor(NEWS_KIND, undefined, NOW)).toEqual({ stories: [] });
    });

    it('forgets a story once it is older than the window it could be offered in', async () => {
        // The log is pruned against the same window the fetch uses, so it can never hold a story
        // that could still come back — which is what keeps it bounded without a sweep of its own.
        const { source } = build({ items: [item('Bridge reopens after four years')] }, { [BULLETIN_KEYS.maxAgeHours]: 12 });

        await source.storiesFor(NEWS_KIND, undefined, NOW);
        expect(await source.storiesFor(NEWS_KIND, undefined, NOW)).toEqual({ stories: [] });

        // A day later the entry is past the window, so the same headline is offerable again.
        const later = NOW + 25 * 3_600_000;
        expect((await source.storiesFor(NEWS_KIND, undefined, later))?.stories).toHaveLength(1);
    });
});

// What a band asks for, and what the station does when it cannot have it. The failure both halves
// are shaped against is the same one: a listener cannot tell a technology bulletin that is really
// the day's headlines from a station that has got it wrong.
describe('what the bulletin is about', () => {
    const technology = category('technology', { labels: ['Technology'], words: ['semiconductor'] });
    const sport = category('sport', { labels: ['Sport'] });

    const page = [
        item('Council votes on the harbour'),
        item('Semiconductor plant reopens'),
        item('United win at the death', { categories: ['Sport'] }),
    ];

    it('reads only what belongs to the category the clock asked for', async () => {
        const { source } = build({ items: page, topics: [technology, sport] });

        const bulletin = await source.storiesFor(NEWS_KIND, { topic: 'technology' }, NOW);

        expect(bulletin?.stories.map(story => story.headline)).toEqual(['Semiconductor plant reopens.']);
        expect(bulletin?.subject).toEqual({ key: 'technology', label: 'Technology' });
    });

    it('reads a story because of the FEED it came from, whatever the story itself says', async () => {
        // The strongest of the three signals, and the only one that does not travel with a story:
        // the operator said this feed IS sport, on the feed, and nothing in the headline says so.
        const { source } = build({
            items: [item('Late drama at the death', { feedId: 'deadair.rss:back-pages' })],
            topics: [technology, sport],
            feedCategories: { 'deadair.rss:back-pages': 'sport' },
        });

        const bulletin = await source.storiesFor(NEWS_KIND, { topic: 'sport' }, NOW);

        expect(bulletin?.stories.map(story => story.headline)).toEqual(['Late drama at the death.']);
    });

    it('DECLINES a category with nothing in it rather than reading general news under its name', async () => {
        // The `clean-only` posture: demand a positive match, and pass over the slot when there is
        // none. Reading the harbour story out as a technology bulletin is the one outcome a listener
        // cannot tell from the station being broken.
        const { source } = build({ items: [item('Council votes on the harbour')], topics: [technology] });

        const bulletin = await source.storiesFor(NEWS_KIND, { topic: 'technology' }, NOW);

        expect(bulletin?.stories).toEqual([]);
        // The subject still travels, so the writer's decline and the row both say which category it
        // was: a slot passed over with no reason attached is what this whole feature is avoiding.
        expect(bulletin?.subject).toEqual({ key: 'technology', label: 'Technology' });
    });

    it('says an empty category out loud once, and again only after it has filled', async () => {
        // A producer writes on EDGES: a row per bulletin would make the activity feed a log file
        // with a primary key, and the station asks for one of these every half hour.
        const watch = new CategoryWatch(activity, logger);
        const dry = { items: [item('Council votes on the harbour')], topics: [technology], watch };

        await build(dry).source.storiesFor(NEWS_KIND, { topic: 'technology' }, NOW);
        await build(dry).source.storiesFor(NEWS_KIND, { topic: 'technology' }, NOW + 1_800_000);

        expect(activity.record).toHaveBeenCalledTimes(1);
        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'news.categoryEmpty' }));

        // It filled, and then ran dry again: two facts, two rows.
        await build({ items: page, topics: [technology], watch }).source.storiesFor(NEWS_KIND, { topic: 'technology' }, NOW + 3_600_000);
        await build(dry).source.storiesFor(NEWS_KIND, { topic: 'technology' }, NOW + 5_400_000);

        expect(activity.record).toHaveBeenCalledTimes(2);
    });

    it('covers whatever it finds when the band asked for nothing', async () => {
        const { source } = build({ items: page, topics: [technology, sport] });

        const bulletin = await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(bulletin?.stories).toHaveLength(3);
        expect(bulletin?.subject).toBeUndefined();
    });

    it('covers whatever it finds when the band names a category the station no longer holds', async () => {
        // Unreachable through the console, since deleting a category takes its bands with it. A row
        // edited by hand gets a general bulletin rather than a slot that can never be filled.
        const { source } = build({ items: page, topics: [technology] });

        const bulletin = await source.storiesFor(NEWS_KIND, { topic: 'gardening' }, NOW);

        expect(bulletin?.stories).toHaveLength(3);
        expect(bulletin?.subject).toBeUndefined();
    });

    it('spreads an unbriefed bulletin across categories rather than reading three of one', async () => {
        // A wire is newest-first, so three sport stories land together at teatime and the station
        // reads a sports bulletin it never announced as one.
        const sporty = [
            item('United win at the death', { categories: ['Sport'] }),
            item('City drop two points', { categories: ['Sport'] }),
            item('Rovers appoint a manager', { categories: ['Sport'] }),
            item('Semiconductor plant reopens'),
        ];
        const { source } = build({ items: sporty, topics: [technology, sport] });

        const bulletin = await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(bulletin?.stories.map(story => story.headline)).toEqual([
            'United win at the death.',
            'Semiconductor plant reopens.',
            'City drop two points.',
        ]);
    });

    it('keeps a story no category claims, and takes it in its turn', async () => {
        // Most stations will have categories covering a fraction of what their feeds carry, so
        // dropping the rest would silently narrow every bulletin to whatever happened to be
        // classified.
        const { source } = build({ items: page, topics: [technology] });

        const bulletin = await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(bulletin?.stories.map(story => story.headline)).toContain('Council votes on the harbour.');
    });

    it('tells a writer which of the station’s own categories a story belongs to', async () => {
        // The station's vocabulary, not the publisher's labels: what a writer might act on is "this
        // is one of ours and it is technology", never "the wire filed it under Gadgets".
        const { source } = build({ items: [item('Semiconductor plant reopens', { categories: ['Gadgets'] })], topics: [technology] });

        const bulletin = await source.storiesFor(NEWS_KIND, undefined, NOW);

        expect(bulletin?.stories[0]?.categories).toEqual(['technology']);
    });
});

/**
 * The station's refusal to read something is enforced in `NewsService`, before a story reaches here
 * at all, which is why there is no test of a withheld story below. What this checks is the half that
 * IS this file's: an off-air category is a rule rather than a subject, so nothing here ever hands a
 * writer one, gives one a turn in the spread, or lets a band be filled by one.
 */
describe('a category the station keeps off the air', () => {
    const shopping = category('shopping', { offAir: true, labels: ['Deals'], words: ['discount code'] });

    it('is never stamped on a story, however well it matches', async () => {
        const { source } = build({
            topics: [shopping],
            items: [item('Save on tents with this discount code', { categories: ['Deals'] })],
        });

        const bulletin = await source.storiesFor(NEWS_KIND, undefined, NOW);

        // The story is here only because this test stubs the service that would have withheld it.
        // What matters is that it arrives uncategorised: a writer is never told it is one of ours.
        expect(bulletin?.stories[0]?.categories).toEqual([]);
    });

    it('cannot be what a bulletin was asked for, so a band pointed at one reads generally', async () => {
        const { source } = build({
            topics: [shopping],
            items: [item('Council reopens the bridge')],
        });

        const bulletin = await source.storiesFor(NEWS_KIND, { topic: 'shopping' }, NOW);

        expect(bulletin?.subject).toBeUndefined();
        expect(bulletin?.stories.map(story => story.headline)).toEqual(['Council reopens the bridge.']);
    });
});
