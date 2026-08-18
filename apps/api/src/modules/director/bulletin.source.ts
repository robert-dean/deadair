import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { truncateSentences } from '@deadair/plugin-sdk';
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
 * How much further down the page to reach than will be read.
 *
 * Four times, where it was two. The two was sized for dropping entries with no usable headline; this
 * has to cover that AND everything the station has already read, which on a slow feed is most of the
 * front page. A publisher who posts three stories a morning and is asked for three every half hour
 * gives the same three back all day unless the ask reaches past them — see {@link ReadLog}.
 *
 * Bounded by `MAX_NEWS_ITEMS` inside `NewsService` either way, because this number reaches somebody
 * else's server.
 */
const OVERSAMPLE = 4;

/**
 * How much of a teaser a writer is shown.
 *
 * Sized to a sentence or two, which is all a teaser ever is: the publisher wrote it to be skimmed
 * next to a headline. It is the FALLBACK now rather than the substrate — see {@link MAX_BODY_CHARS}
 * — and is left short deliberately, because a story that could not be read is not made better by
 * being quoted at greater length.
 */
const MAX_SUMMARY_CHARS = 240;

/**
 * How much of the STORY a writer is shown.
 *
 * Three times the teaser, because this is the part a bulletin is written from and one paragraph is
 * not enough to say what happened in three separate stories. Not much more than three times, because
 * the same prompt carries the persona sheet, the content rules and the recent scripts, and a model
 * given two thousand words of newspaper writes like a newspaper.
 *
 * Cut on a SENTENCE rather than on a word, which is the load-bearing half: a story that stops
 * mid-clause is something a model finishes out of its own head, and a bulletin is the one kind of
 * break where inventing the end of a sentence is a station stating something false as fact.
 */
const MAX_BODY_CHARS = 700;

/**
 * What the station has already read out, so it does not read it again.
 *
 * ## The failure
 *
 * `fetchItems` answers newest-first and this took the top three, every bulletin, with nothing
 * remembering the last one. Measured on this station: the same three stories — a soap box derby, a
 * piece about graduates and AI, and a paused construction project — went out in twenty-seven
 * consecutive bulletins across seven hours, because that is what the feed had and the freshness
 * window is twelve hours. A listener hears a station with nothing to say pretending to have news.
 *
 * ## Why memory rather than a table
 *
 * This is a WORKING SET, not a record. What was reported is already durable in
 * `deadair.script_history`, one row per bulletin, which is where "what did the station say last
 * Tuesday" is answered. What this holds is only "may I say it again", a question with a twelve-hour
 * half-life — so a restart costs at most one repeated bulletin and heals itself on the next one,
 * which is a smaller price than a migration and a sweep for a fact that expires by lunchtime. It is
 * the same split the running order makes: memory is the authority, and the row is the record.
 *
 * ## Keyed on the HEADLINE rather than on the item id
 *
 * An id is per publisher, so one story carried by two newsrooms is two ids and one thing a listener
 * hears twice. The headline is what actually gets read out, which makes it the honest key. It does
 * not catch two publishers WORDING one story differently — nothing here does, and that is a real
 * limit rather than an oversight.
 *
 * ## Marked at SELECTION, not at air
 *
 * A bulletin that is chosen and then never airs — its render failed, its slot was cut — has still
 * spent its stories. That inaccuracy is bought deliberately, exactly as `chooseFacts` buys it for a
 * break's facts: the alternative is a read-log that has to be told what happened to a segment much
 * later, which is a second writer of the same fact and a way for the two to disagree.
 */
class ReadLog {
    private readonly readAt = new Map<string, number>();

    /** Whether this headline has already gone out inside the window. */
    has(headline: string): boolean {
        return this.readAt.has(key(headline));
    }

    /** Mark everything this bulletin is about to read. */
    keep(headlines: readonly string[], now: number): void {
        for (const headline of headlines) this.readAt.set(key(headline), now);
    }

    /**
     * Drop anything older than the window it could still be offered in.
     *
     * Called on the way IN rather than when a bulletin is kept, which is the whole of the fix it
     * replaces: pruning inside {@link keep} ran only when stories were selected, so the one station
     * that needs it most — a feed so slow that every bulletin declines — was the one station whose
     * log never aged out and never let a story become sayable again.
     *
     * Pruned against the same window the fetch uses, so the log can never hold a story that could
     * still be offered, which is what keeps it bounded without a sweep of its own.
     */
    forget(before: number): void {
        for (const [seen, at] of this.readAt) {
            if (at < before) this.readAt.delete(seen);
        }
    }
}

/** A headline as the thing a listener would hear, so two spellings of one story are one story. */
const key = (headline: string): string =>
    headline
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

@Injectable()
export class BulletinSource {
    /** See {@link ReadLog}. Per station process, and deliberately not persisted. */
    private readonly read = new ReadLog();

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
            const windowMs = maxAgeHours * 3_600_000;
            const items = await this.news.fetchItems({
                ...(feed.length === 0 ? {} : { feedId: feed }),
                // Asked for more than will be read, because the cut below drops anything without a
                // usable headline and anything the station has already said, and a bulletin that
                // came up two short of what the operator asked for is a worse read than one that
                // reached a little further down the page. See `OVERSAMPLE`.
                limit: wanted * OVERSAMPLE,
                since: new Date(now - windowMs).toISOString(),
            });

            // Before the filter, so a story that has aged past the window is sayable again even on a
            // station whose every recent bulletin declined. See `ReadLog.forget`.
            this.read.forget(now - windowMs);

            const offered = items.flatMap(item => toStory(item) ?? []);
            const stories = offered.filter(story => !this.read.has(story.headline)).slice(0, wanted);

            // Nothing the station has not already said. DECLINED rather than repeated, on the same
            // argument the freshness window is on: a feed that has not moved and a station reading
            // this morning's headlines again at teatime are the same wrongness, and a listener
            // cannot tell either from the station simply being wrong. Passing over the slot is
            // something the station is built to absorb.
            //
            // Said at info rather than debug, and it is the one line here worth an operator's
            // attention: a station whose clock asks for news every half hour and whose publisher
            // posts three stories a day is silent at most bulletins, and this is what says so.
            if (stories.length === 0) {
                if (offered.length > 0)
                    this.logger.info('director: every story in the news window has already been read, so the bulletin was skipped');
                return [];
            }

            this.read.keep(
                stories.map(story => story.headline),
                now,
            );

            // At debug, because this runs on every bulletin and the interesting version of it is
            // the one where a bulletin turned out to be short.
            this.logger.debug('director: read the news for a bulletin', {
                offered: offered.length,
                using: stories.length,
                repeats: offered.length - stories.length,
                feed: feed || 'all',
            });
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
function toStory(item: { title: string; summary?: string; content?: string; feedName?: string; publishedAt?: string }): BreakStory | undefined {
    const headline = speakable(item.title);
    if (headline === undefined) return undefined;

    const summary = item.summary?.trim();
    const body = item.content?.trim();

    return {
        headline,
        ...(summary === undefined || summary.length === 0 ? {} : { summary: summary.slice(0, MAX_SUMMARY_CHARS) }),
        ...(body === undefined || body.length === 0 ? {} : { body: truncateSentences(body, MAX_BODY_CHARS) }),
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
