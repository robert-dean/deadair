import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { NewsService } from '#modules/news/news.service.js';
import { errorText } from '#modules/shared/error.text.js';
import type { BreakStory } from './break.writer.js';
import { NEWS_KIND } from './news.break.writer.js';

/**
 * The stories a bulletin is written from, fetched once and handed to whichever writer takes it.
 *
 * This is the `EnrichmentReadService.factsForTracks` of the news: everything that has to be decided
 * ONCE — which feeds, how many stories, how old is too old, and what a headline looks like when it
 * is read out loud — is decided here, so the model binding and the floor underneath it see exactly
 * the same substrate. A writer that fetched its own would make the floor do network I/O, which is
 * the one thing a floor must not do.
 *
 * ## Only for a kind that reports
 *
 * `storiesFor` answers `undefined` for every other kind, which is what keeps `WriteBreakJob` free
 * of a branch about news. It is a real answer rather than politeness: reading a feed costs a
 * request, and a talk break has no use for one.
 *
 * ## Nothing here throws
 *
 * A publisher that is down, no plugin installed, nothing published since breakfast: all of them
 * answer with no stories, and the writer for the kind then declines. That is a slot the station
 * passes over, which is exactly what a segment that is not `ready` already costs it. The one thing
 * this must never do is put a bulletin on air that announces itself and then says nothing.
 */

/** The `deadair.settings` keys. In `rotation`, beside the station's other words. */
export const BULLETIN_KEYS = {
    feed: 'rotation.newsFeed',
    stories: 'rotation.newsStories',
    maxAgeHours: 'rotation.newsMaxAgeHours',
} as const;

/**
 * How many stories a bulletin reads when the operator has not said.
 *
 * Three is a headline round rather than a programme: at the length a voice reads, three headlines
 * and the words around them is most of a minute, and a station that stops for two minutes of news
 * every half hour is a news station that plays records.
 */
export const DEFAULT_STORY_COUNT = 3;

/**
 * How old a story may be and still be read as news, in hours.
 *
 * Twelve, because the failure is specific and bad: a feed that has not moved since yesterday
 * afternoon otherwise has the station reading last night's headlines as if they had just happened,
 * and a listener cannot tell that from the station being wrong. Silence on that boundary is better,
 * which is the same trade `segments.claims_item_id` makes about a forward promise.
 */
export const DEFAULT_MAX_AGE_HOURS = 12;

/** Ceilings, so a typo in a settings box cannot produce a ten-minute bulletin. */
const MAX_STORY_COUNT = 8;
const MAX_AGE_HOURS = 168;

/**
 * How much of a summary a writer is shown.
 *
 * The model gets these as raw material and the floor never reads them, so this is sized to a
 * sentence or two of context rather than to an article. A paragraph per story would also crowd out
 * the persona sheet and the content rules in the same prompt.
 */
const MAX_SUMMARY_CHARS = 240;

@Injectable()
export class BulletinSource {
    constructor(
        private readonly news: NewsService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * What this break has to report, or `undefined` when it is not that sort of break.
     *
     * `now` is a parameter rather than a call to the clock so the staleness window is testable, and
     * because the caller already has the instant it is writing for.
     */
    async storiesFor(kind: string, now: number = Date.now()): Promise<readonly BreakStory[] | undefined> {
        if (kind !== NEWS_KIND) return undefined;

        // Asked before anything else, so a station with no news plugin costs nothing and says
        // nothing: `BreakPlanner` would not have planted this break if nothing could write the kind,
        // but a plugin can be uninstalled between planting and writing.
        if (!this.news.hasNews()) return [];

        const wanted = clamp(this.config.get(BULLETIN_KEYS.stories, DEFAULT_STORY_COUNT), 1, MAX_STORY_COUNT, DEFAULT_STORY_COUNT);
        const maxAgeHours = clamp(this.config.get(BULLETIN_KEYS.maxAgeHours, DEFAULT_MAX_AGE_HOURS), 1, MAX_AGE_HOURS, DEFAULT_MAX_AGE_HOURS);
        const feed = this.config.get(BULLETIN_KEYS.feed, '').trim();

        try {
            const items = await this.news.fetchItems({
                ...(feed.length === 0 ? {} : { feedId: feed }),
                // Asked for more than will be read, because the cut below drops anything without a
                // usable headline and a bulletin that came up two short of what the operator asked
                // for is a worse read than one that reached a little further down the page.
                limit: wanted * 2,
                since: new Date(now - maxAgeHours * 3_600_000).toISOString(),
            });

            const stories = items.flatMap(item => toStory(item) ?? []).slice(0, wanted);

            // At debug, because this runs on every bulletin and the interesting version of it is
            // the one where a bulletin turned out to be short.
            this.logger.debug('director: read the news for a bulletin', { offered: items.length, using: stories.length, feed: feed || 'all' });
            return stories;
        } catch (error) {
            // `NewsService` already absorbs a failing plugin, so reaching here means something
            // further in broke. Still not a fault worth failing the break over: the writer declines,
            // the station passes over the slot, and the next bulletin tries again.
            this.logger.info(`director: the news could not be read for a bulletin (${errorText(error)})`);
            return [];
        }
    }
}

/** One story, or nothing when there is no headline worth reading. */
function toStory(item: { title: string; summary?: string; feedName?: string; publishedAt?: string }): BreakStory | undefined {
    const headline = speakable(item.title);
    if (headline === undefined) return undefined;

    const summary = item.summary?.trim();

    return {
        headline,
        ...(summary === undefined || summary.length === 0 ? {} : { summary: summary.slice(0, MAX_SUMMARY_CHARS) }),
        ...(item.feedName === undefined ? {} : { source: item.feedName }),
        ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
    };
}

/**
 * How long a trailing "— Publisher" tail may be before it is taken to be part of the headline.
 *
 * Publishers append their own name to a headline for a browser tab, and it is read out as part of
 * the sentence by anything that does not take it off. Bounded rather than greedy because a dash is
 * ordinary punctuation in a headline — "Council votes — and adjourns" is a sentence, not a byline —
 * and the difference between the two is length.
 */
const MAX_PUBLISHER_TAIL = 30;

/** A separator followed by a short tail, at the very end. Built from the bound so the two agree. */
const PUBLISHER_TAIL = new RegExp(`\\s+[-–—|]\\s+[^-–—|]{1,${MAX_PUBLISHER_TAIL}}$`, 'u');

/**
 * A headline as something a voice can read.
 *
 * Whitespace collapsed, the publisher's own furniture taken off the end, and a full stop put on it
 * so three headlines in a row do not run into one sentence. Done here rather than in either writer,
 * so the model and the floor are reading the same words.
 */
function speakable(title: string): string | undefined {
    let text = title.replace(/\s+/g, ' ').trim();
    if (text.length === 0) return undefined;

    // A trailing separator plus a short tail: " - BBC News", " | Sky News", " — The Guardian".
    text = text.replace(PUBLISHER_TAIL, '').trim();
    if (text.length === 0) return undefined;

    return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** A setting read as a whole number inside its bounds, or the default when it is not one. */
function clamp(value: number, low: number, high: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;

    return Math.min(Math.max(Math.floor(parsed), low), high);
}
