import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { truncateSentences } from '@deadair/plugin-sdk';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { categoriesOf, newsTopicRules, type NewsTopicRules } from '#modules/news/news.classify.js';
import { NewsService } from '#modules/news/news.service.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import type { BreakContext } from './break.request.js';
import type { BreakStory, BreakSubject } from './break.writer.js';
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
 * ## What it is ABOUT is decided here too
 *
 * A band on the format clock may ask for a bulletin about one of the operator's categories, which
 * arrives as `context.topic` on the segment. Resolving that key, classifying the page and cutting it
 * to the category all happen HERE for the same reason the freshness window does: both writers see
 * one substrate, and the model binding and the floor cannot disagree about what a technology
 * bulletin is.
 *
 * A category that matches nothing DECLINES the slot rather than falling back to general news. That
 * is the `clean-only` advisory posture — demand a positive match, say so where an operator will see
 * it, and never air the wrong thing under the right name — and it is the same trade the freshness
 * window and the read log already make: silence is a state somebody can act on, and a general
 * bulletin read under a category's name is not.
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
    storiesMin: 'rotation.newsStoriesMin',
    storiesMax: 'rotation.newsStoriesMax',
    maxAgeHours: 'rotation.newsMaxAgeHours',
} as const;

/**
 * How many stories a bulletin reads when the operator has not said, as the ends of a RANGE.
 *
 * Three is a headline round rather than a programme: at the length a voice reads, three headlines
 * and the words around them is most of a minute, and a station that stops for two minutes of news
 * every half hour is a news station that plays records. Two and four are that, either side.
 *
 * A range because the story COUNT is a bulletin's structural length, in the way `targetMs` is a
 * production's — the word ceiling is not, being a limit almost nothing reaches. A fixed count is a
 * station whose every news bulletin is the same shape, which is the thing a listener notices without
 * being able to say why.
 */
export const DEFAULT_STORY_COUNT_MIN = 2;
export const DEFAULT_STORY_COUNT_MAX = 4;

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
export const MAX_STORY_COUNT = 8;
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
 *
 * ## A SINGLETON, injected into a scoped {@link BulletinSource}
 *
 * This is the whole of why the log exists at all, and it was a field on `BulletinSource` for as long
 * as it had been written — which meant it never remembered anything. `BulletinSource` is `asScoped()`
 * because `NewsService` is, and the job runner opens a scope per execution, so every `WriteBreakJob`
 * built a fresh source with a fresh empty log, marked three headlines and dropped them. Measured on
 * air on 19 August: ten consecutive bulletins across thirty-three minutes read the same three
 * stories — the exact failure described above, with the fix for it in the tree and inert.
 *
 * So the STATE is lifted out and registered on its own, exactly as `AdvisoryWatch` is among the
 * scoped generators and for exactly that reason: a fact of the form "the station already said this"
 * has to outlive the scope that discovered it. Making `BulletinSource` itself a singleton is the
 * wrong half of the same idea, because it would capture a scoped `NewsService` at the root.
 *
 * The unit test could not see any of this: it held one `BulletinSource` and called `storiesFor`
 * twice, which is a lifetime the container never produces. A test for a thing that must outlive a
 * scope has to build a new source per bulletin, which is what the ones below now do.
 */
@Injectable()
export class ReadLog {
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

/**
 * Says out loud when a category the clock asks for has nothing in it.
 *
 * `AdvisoryWatch`'s shape and its argument, one kind of break over: a bulletin that declines because
 * its category matched nothing is CORRECT and must not be silent about it — a station whose
 * technology band has been passing over its slot all afternoon and a station whose feeds are down
 * produce the same quiet half-hours and want opposite fixes.
 *
 * Its own singleton for `AdvisoryWatch`'s reason as well: `BulletinSource` is scoped, so an edge flag
 * on it would reset before it could suppress anything and the feed would take a row every bulletin.
 * Keyed by category, because two categories running dry are two facts.
 */
@Injectable()
export class CategoryWatch {
    private readonly reported = new Set<string>();

    constructor(
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /** The rising edge: this category had nothing in the window the bulletin could read. */
    empty(subject: BreakSubject, offered: number): void {
        if (this.reported.has(subject.key)) return;
        this.reported.add(subject.key);

        this.logger.info('director: a bulletin asked for a category with nothing in it, so the station passed over the slot', {
            topic: subject.key,
            offered,
        });
        void this.activity.record({
            module: 'director',
            kind: 'news.categoryEmpty',
            detail:
                `The clock asks for a ${subject.label} bulletin, and none of the ${offered} stories the station could read belongs to that ` +
                'category. It will pass over that slot until something does, or until the category is pointed at a feed that carries it.',
            data: { topic: subject.key, offered },
        });
    }

    /** The falling edge, so a category that fills up again is reported the next time it runs dry. */
    filled(subject: BreakSubject): void {
        if (!this.reported.delete(subject.key)) return;
        this.logger.info('director: a category the station had nothing for has stories again', { topic: subject.key });
    }
}

/** What a bulletin was given to read, and what it is about. */
export interface Bulletin {
    stories: readonly BreakStory[];
    /** The category the format clock asked for, when it asked for one. */
    subject?: BreakSubject;
}

@Injectable()
export class BulletinSource {
    constructor(
        private readonly news: NewsService,
        /** See {@link ReadLog}. A singleton beside this scoped class, and deliberately not persisted. */
        private readonly read: ReadLog,
        private readonly topics: TopicRepository,
        /** See {@link CategoryWatch}. A singleton for the same reason the read log is. */
        private readonly watch: CategoryWatch,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * What this break has to report, or `undefined` when it is not that sort of break.
     *
     * `now` is a parameter rather than a call to the clock so the staleness window is testable, and
     * because the caller already has the instant it is writing for. `random` is one for the same
     * reason: a test that cannot pin the roll is a test of nothing.
     */
    async storiesFor(
        kind: string,
        context: BreakContext | undefined,
        now: number = Date.now(),
        random: () => number = Math.random,
    ): Promise<Bulletin | undefined> {
        if (kind !== NEWS_KIND) return undefined;

        // Asked before anything else, so a station with no news plugin costs nothing and says
        // nothing: `BreakPlanner` would not have planted this break if nothing could write the kind,
        // but a plugin can be uninstalled between planting and writing.
        if (!this.news.hasNews()) return { stories: [] };

        // Picked per bulletin rather than fixed, so the station's news is not the same shape every
        // half hour. Spent immediately: `wanted` reaches both the ask below and `ReadLog`, so a
        // bulletin that asked for four has rested four whether or not it airs — the inaccuracy
        // `chooseFacts` documents, unchanged in kind by there being a range.
        const wanted = this.howManyStories(random);
        const maxAgeHours = clamp(this.config.get(BULLETIN_KEYS.maxAgeHours, DEFAULT_MAX_AGE_HOURS), 1, MAX_AGE_HOURS, DEFAULT_MAX_AGE_HOURS);
        const feed = this.config.get(BULLETIN_KEYS.feed, '').trim();

        // Every category this station holds, read once: the one this bulletin was asked for cuts the
        // page down, and the rest are what a general bulletin spreads across.
        const rules = await this.categories();
        const asked = subjectOf(context, rules);

        try {
            const windowMs = maxAgeHours * 3_600_000;
            // Asked for beside the stories rather than folded into them: what a feed IS is the
            // operator's word about the feed, and a `NewsItem` is the publisher's own entry. A
            // plugin that could not answer contributes nothing, which is a bulletin classified on
            // what its stories say — the state every station was in before feeds carried a category.
            const declared = await this.feedCategories();
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

            const offered = items.flatMap(item => toStory(item, rules, declared.get(item.feedId)) ?? []);
            const unread = offered.filter(story => !this.read.has(story.headline));

            // Cut to what this bulletin is about, or spread across whatever the categories say the
            // page holds. Two different jobs and one line, because a bulletin that was asked for a
            // category has already had its variety decided for it.
            const eligible = asked === undefined ? spread(unread) : unread.filter(story => (story.categories ?? []).includes(asked.key));
            const stories = eligible.slice(0, wanted);

            // The category is empty. DECLINED rather than filled with general news, which is the
            // whole point of asking for one: a listener cannot tell a technology bulletin that is
            // really the day's headlines from a station that has got it wrong. Said on the EDGE and
            // on the activity feed, because a slot passed over every half hour all afternoon is
            // otherwise invisible.
            if (asked !== undefined && stories.length === 0) {
                this.watch.empty(asked, offered.length);
                return { stories: [], subject: asked };
            }
            if (asked !== undefined) this.watch.filled(asked);

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
                return { stories: [] };
            }

            this.read.keep(
                stories.map(story => story.headline),
                now,
            );

            // At debug, because this runs on every bulletin and the interesting version of it is
            // the one where a bulletin turned out to be short.
            //
            // `repeats` counts what the log actually turned away. It was `offered - using`, which is
            // everything past the `wanted` cut as well — so on a full page it read `repeats=9` on
            // every bulletin whether or not one story had been heard before, and stayed pinned at 9
            // through the ten repeated bulletins above. A number that cannot move is a number that
            // cannot report the fault it is there to report.
            this.logger.debug('director: read the news for a bulletin', {
                offered: offered.length,
                using: stories.length,
                repeats: offered.length - unread.length,
                feed: feed || 'all',
                topic: asked?.key ?? 'anything',
            });
            return { stories, ...(asked === undefined ? {} : { subject: asked }) };
        } catch (error) {
            // `NewsService` already absorbs a failing plugin, so reaching here means something
            // further in broke. Still not a fault worth failing the break over: the writer declines,
            // the station passes over the slot, and the next bulletin tries again.
            this.logger.info(`director: the news could not be read for a bulletin (${errorText(error)})`);
            return { stories: [] };
        }
    }

    /**
     * How many stories THIS bulletin reads, out of the station's range.
     *
     * The two ends are read as an unordered pair rather than refused, on the resolver rule this
     * whole file follows: a row that is already stored must cost the station its preference, never
     * its ability to read the news. The console refuses the pair where somebody types it.
     *
     */
    private howManyStories(random: () => number): number {
        const low = clamp(this.config.get(BULLETIN_KEYS.storiesMin, DEFAULT_STORY_COUNT_MIN), 1, MAX_STORY_COUNT, DEFAULT_STORY_COUNT_MIN);
        const high = clamp(this.config.get(BULLETIN_KEYS.storiesMax, DEFAULT_STORY_COUNT_MAX), 1, MAX_STORY_COUNT, DEFAULT_STORY_COUNT_MAX);

        const from = Math.min(low, high);
        const to = Math.max(low, high);

        // Inclusive at both ends, or a range of 2 to 4 never reads four and the setting says
        // something it does not mean.
        return from + Math.min(to - from, Math.floor(random() * (to - from + 1)));
    }

    /**
     * The station's own categories, as rules.
     *
     * Read per bulletin rather than held, for the reason the planner reads its bands per pass: an
     * operator who has just pointed a category at a feed should hear it on the next bulletin rather
     * than after a restart. A station that has named none answers `[]`, which classifies nothing and
     * is exactly what every station did before categories existed.
     */
    private async feedCategories(): Promise<Map<string, string>> {
        try {
            return await this.news.feedCategories();
        } catch (error) {
            // The categories() rule, one signal down: a menu that could not be read is a bulletin
            // judged on the words alone, never a slot lost.
            this.logger.info(`director: the feeds could not be asked what they are (${errorText(error)})`);
            return new Map();
        }
    }

    private async categories(): Promise<NewsTopicRules[]> {
        try {
            return (await this.topics.list(NEWS_KIND)).map(newsTopicRules);
        } catch (error) {
            // A read that failed is a station with no categories for this bulletin, which is a
            // general bulletin — never a reason to lose the slot. A band that asked for a category
            // then finds nothing carrying it and declines, which is the honest outcome.
            this.logger.info(`director: the news categories could not be read (${errorText(error)})`);
            return [];
        }
    }
}

/**
 * Which category this bulletin was asked for, out of the context its band stamped.
 *
 * A key naming a category the station no longer holds answers `undefined`, so the bulletin covers
 * whatever it finds. That cannot happen through the console — deleting a category takes its bands
 * with it — so reaching here means somebody edited a row by hand, and a general bulletin is a better
 * answer than a slot that can never be filled again.
 *
 * A category marked OFF AIR is treated exactly the same way, and it is the case that can actually
 * arrive: a band written before the switch was turned on still points at it. Such a category is a
 * rule about what the station will not say rather than a subject, `categoriesOf` never stamps one on
 * a story, and a subject resolved here would therefore claim the slot and then decline it on every
 * pass, forever, reporting an empty category each time. Answering `undefined` turns that into an
 * ordinary general bulletin.
 */
function subjectOf(context: BreakContext | undefined, rules: readonly NewsTopicRules[]): BreakSubject | undefined {
    const key = typeof context?.topic === 'string' ? context.topic.trim() : '';
    if (key.length === 0) return undefined;

    const held = rules.find(rule => rule.key === key && !rule.offAir);
    return held === undefined ? undefined : { key: held.key, label: held.label };
}

/**
 * The page, ordered so one category cannot take the whole bulletin while others go unread.
 *
 * A round over the categories represented, newest first within each, then everything that follows.
 * The failure it fixes is ordinary rather than exotic: a wire is newest-first, three sport stories
 * land together at teatime, and the station reads a sports bulletin it never announced as one.
 *
 * A story with no category is kept and takes its turn, because most stations will have categories
 * that cover a fraction of what their feeds carry — dropping the rest would silently narrow every
 * bulletin to whatever happened to be classified.
 */
function spread(stories: readonly BreakStory[]): readonly BreakStory[] {
    const first: BreakStory[] = [];
    const rest: BreakStory[] = [];
    const used = new Set<string>();

    for (const story of stories) {
        // The strongest match, which `categoriesOf` already sorted to the front: what a listener
        // would call this story is the category that claimed it most confidently.
        const category = story.categories?.[0];
        if (category === undefined || !used.has(category)) {
            if (category !== undefined) used.add(category);
            first.push(story);
            continue;
        }

        rest.push(story);
    }

    // Everything is kept and only the ORDER changes, so a bulletin on a page where one category
    // holds every story still gets its full count: the second and third sport stories are behind
    // everything else rather than dropped.
    return [...first, ...rest];
}

/** One story, or nothing when there is no headline worth reading. */
function toStory(
    item: { title: string; summary?: string; content?: string; feedName?: string; feedId?: string; publishedAt?: string; categories?: string[] },
    rules: readonly NewsTopicRules[],
    /** What the feed this came from says it is, which outranks anything the story says about itself. */
    feedCategory: string | undefined,
): BreakStory | undefined {
    const headline = speakable(item.title);
    if (headline === undefined) return undefined;

    // Both stripped of the headline where they open with it, and stripped before either is cut, so
    // the cut spends its characters on the story rather than on a sentence the writer is shown
    // twice. See {@link withoutEchoedHeadline}.
    const summary = withoutEchoedHeadline(item.summary?.trim(), item.title, headline);
    const body = withoutEchoedHeadline(item.content?.trim(), item.title, headline);

    return {
        headline,
        ...(summary === undefined || summary.length === 0 ? {} : { summary: summary.slice(0, MAX_SUMMARY_CHARS) }),
        ...(body === undefined || body.length === 0 ? {} : { body: truncateSentences(body, MAX_BODY_CHARS) }),
        ...(item.feedName === undefined ? {} : { source: item.feedName }),
        ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
        // The station's OWN categories, strongest match first — not the publisher's labels, which
        // are one of the three things those are judged on. Classified here so both writers and the
        // cut below read one answer.
        categories: categoriesOf({ ...item, ...(feedCategory === undefined ? {} : { feedCategory }) }, rules).map(match => match.key),
    };
}

/**
 * A story's text with the headline taken off the front, where it opened with it.
 *
 * ## Why this is here
 *
 * The writer is shown a headline and, underneath it, the story — two labels which the prompt leans
 * on hard, because one is the published sentence and the other is what happened. **21 of the 34
 * stories in this station's captured prompts had a body that BEGAN with its own headline, word for
 * word**, so what the writer actually saw under two labels was one sentence twice. Asked to report
 * what the text says, a model reports it: that is most of the headline-then-restatement the aired
 * bulletins are full of, and no amount of prompt is going to talk a writer out of reading something
 * it was shown.
 *
 * It comes from an aggregator. A feed whose links point at the aggregator rather than at the
 * publisher gives the article fetcher the aggregator's own page, whose prose is the headline
 * followed by other outlets' headlines. But nothing here detects that, deliberately — the echo is
 * worth removing wherever it comes from, and a publisher who opens an article with its own title is
 * just as well served.
 *
 * ## What it will not do
 *
 * Only a PREFIX, and only the whole headline. A headline quoted in the middle of an article is the
 * article referring to itself and is prose; a body that merely shares its first few words with the
 * headline is the ordinary case of a story that starts where its title does. Both are left alone,
 * because the failure this removes is exact duplication and anything looser starts cutting the lead
 * sentence off real reporting.
 *
 * Both forms of the title are tried, since they differ: the RAW one is what a body echoes, and
 * {@link speakable}'s is what the writer is shown after the publisher's tail comes off.
 */
function withoutEchoedHeadline(text: string | undefined, title: string, headline: string): string | undefined {
    if (text === undefined || text.length === 0) return text;

    const flat = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
    const subject = flat(text);

    for (const candidate of [title, headline.replace(/[.!?]$/, '')]) {
        const prefix = flat(candidate);
        if (prefix.length === 0 || !subject.startsWith(prefix)) continue;

        // Counted on the FLATTENED text and then cut from the original, so the characters the
        // flattening collapsed are not left behind: a body indented under its own headline has
        // several spaces where the comparison saw one. Walking the original until it has spent the
        // prefix's worth of non-space characters is what keeps the two in step.
        return spendPrefix(text, prefix.length).replace(/^[\s\p{Pd}:;,.·|—–]+/u, '');
    }

    return text;
}

/** The original text past a prefix measured on its whitespace-collapsed form. See {@link withoutEchoedHeadline}. */
function spendPrefix(text: string, length: number): string {
    let spent = 0;
    let index = 0;
    let wasSpace = false;

    while (index < text.length && spent < length) {
        const isSpace = /\s/.test(text[index] as string);
        // A run of whitespace is one character to the comparison, so only the first of it is spent.
        if (!isSpace || !wasSpace) spent += 1;
        wasSpace = isSpace;
        index += 1;
    }

    return text.slice(index);
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
