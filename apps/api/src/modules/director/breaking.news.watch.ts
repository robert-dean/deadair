import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';
import { NewsService } from '#modules/news/news.service.js';
import { feedRoster } from '#modules/news/news.settings.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { numberInRange } from '#modules/shared/setting.numbers.js';
import {
    BREAKING_KEYS,
    DEFAULT_BREAKING_COOLDOWN_MINUTES,
    DEFAULT_BREAKING_POLL_MINUTES,
    MAX_BREAKING_COOLDOWN_MINUTES,
    MAX_BREAKING_POLL_MINUTES,
    MIN_BREAKING_COOLDOWN_MINUTES,
    MIN_BREAKING_POLL_MINUTES,
} from './breaking.news.settings.js';
import { BREAKING_CONTEXT, ReadLog } from './bulletin.source.js';
import { DirectorService } from './director.service.js';
import { NEWS_KIND } from './news.break.writer.js';

/**
 * A new story on one of the operator's breaking feeds, put on air at the next boundary.
 *
 * The watcher Ideas #23 § 2 describes, with news as its first subject: a loop that asks a source
 * what is new since it last looked and posts a `BreakRequest` to the director like every other
 * producer. `WelcomeAnnouncer` is its template with the bus taken out. That one subscribes because
 * the audience it answers lives in `playout`, which sits on the far side of the module list; this
 * one reads `news`, which registers BEFORE `director`, so it imports `NewsService` and posts
 * directly, and `apps/api/CLAUDE.md` § "How work is dispatched" says a bus would be the wrong tool.
 *
 * ## "Breaking" is the operator's choice of feed
 *
 * Nothing in a story says it is urgent, and nothing here pretends to judge: a feed carries no
 * urgency field and the plugin API must not grow one, because a publisher's flag would be the plugin
 * claiming to know something it cannot. So the operator lists the feeds whose every new story is
 * worth breaking into the programme for (a publisher's own breaking-news feed, a local alerts
 * feed) under `news.breakingFeeds`. An empty list is the watch switched off, which is every station
 * that has not chosen.
 *
 * ## What is new
 *
 * The id contract the capability promises: a `NewsItem.id` is stable for one entry across calls.
 * So the watch remembers ids rather than timestamps, and a publisher that re-dates its front page
 * re-dates stories the watch has already seen. The first answer from each feed is a BASELINE and
 * posts nothing, which is what keeps a restart, a feed newly listed, or the station coming back on
 * air from announcing a whole front page as though it had all just happened. Off air the baseline
 * is dropped, for that last reason.
 *
 * A story the station has already read in an ordinary bulletin is not new to a listener whatever
 * the feed says, so the read log is asked as well. A story older than {@link BREAKING_MAX_AGE_MS} is
 * not breaking, which is the same ask expressed as `since`.
 *
 * ## One at a time, and not too often
 *
 * At most one story is posted a pass, the newest, and the rest are marked seen: an ordinary bulletin
 * will read them, and three breaking bulletins in a row is a news station. Every request goes in
 * under ONE dedupe key with the operator's cooldown, so the director holds a second breaking
 * bulletin off for that long. The director holds it rather than this class because it asks the
 * request TABLE, which survives the restart a map here would forget. A story turned away by the
 * cooldown is not retried: twenty minutes later it is not breaking any more, and the next ordinary
 * bulletin can read it.
 *
 * ## What it does not decide
 *
 * Where the break goes, whether it can be written or voiced, and whether the station is keeping
 * quiet: all of that is the director's, exactly as for the welcome. The request is `next` rather
 * than `interrupt`, because a story belongs between two records, and either of the two is rendered
 * before it is placed, so a bulletin that is not ready never reaches its slot unready.
 */

/** How old a story may be and still break into the programme. */
export const BREAKING_MAX_AGE_MS = 60 * 60_000;

/** The one dedupe key every breaking bulletin is taken under. See "One at a time" above. */
export const BREAKING_REQUEST_KEY = 'news.breaking';

/** How many stories each feed is asked for a pass. The top of a front page, which is where a new story lands. */
const PAGE_SIZE = 10;

/**
 * How long an id is remembered after it was last seen.
 *
 * Far past {@link BREAKING_MAX_AGE_MS}, so a story that stays on its feed all day is still known
 * when the publisher re-dates it in the afternoon. Bounded so the map cannot grow for ever.
 */
const SEEN_FOR_MS = 24 * 60 * 60_000;

@Injectable()
export class BreakingNewsWatch {
    private timer?: ReturnType<typeof setTimeout>;
    private running = false;
    /** Every id the watch has seen, and when it last saw it. */
    private readonly seen = new Map<string, number>();
    /** The feeds whose first answer has been taken as the baseline. */
    private readonly baselined = new Set<string>();

    constructor(
        private readonly container: Container,
        private readonly director: DirectorService,
        private readonly read: ReadLog,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Begin watching. Idempotent. */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.schedule();
    }

    /** Stop watching. A pass already in flight finishes, and nothing follows it. */
    stop(): void {
        this.running = false;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    /**
     * One look at every breaking feed, and at most one request.
     *
     * Public, with `now` a parameter, so a test can drive passes without a timer. Never throws: it is
     * called from a timer with nobody to hand a rejection to.
     */
    async pass(now: number = Date.now()): Promise<void> {
        try {
            await this.look(now);
        } catch (error) {
            this.logger.warn(`director: the breaking news could not be read (${errorText(error)})`);
        }
    }

    /**
     * The next pass, after however long the setting says NOW.
     *
     * A timeout re-armed after each pass rather than an interval, so a changed setting is obeyed
     * from the next pass without a restart and a slow pass never overlaps the one after it.
     */
    private schedule(): void {
        if (!this.running) return;

        this.timer = setTimeout(() => {
            void this.pass().finally(() => this.schedule());
        }, this.pollMs());
        this.timer.unref?.();
    }

    private async look(now: number): Promise<void> {
        const feeds = feedRoster(this.config, BREAKING_KEYS.feeds);

        // Off, or off air. The baseline goes with either, so switching back on or going back on air
        // starts from what the feeds hold then rather than announcing everything since.
        if (feeds.length === 0 || !this.director.status().active) {
            this.baselined.clear();
            return;
        }

        for (const [id, at] of this.seen) {
            if (at < now - SEEN_FOR_MS) this.seen.delete(id);
        }

        const since = new Date(now - BREAKING_MAX_AGE_MS).toISOString();
        const pages = await inScope(this.container, async scope => {
            const news = scope.get(NewsService);
            if (!news.hasNews()) return [];

            const read: Array<{ feedId: string; items: NewsItem[] }> = [];
            for (const feedId of feeds) {
                read.push({ feedId, items: await news.fetchItems({ feedId, limit: PAGE_SIZE, since, headlinesOnly: true }) });
            }
            return read;
        });

        await this.read.ready();

        const arrived: NewsItem[] = [];
        for (const { feedId, items } of pages) {
            const first = !this.baselined.has(feedId);
            this.baselined.add(feedId);

            for (const item of items) {
                const known = this.seen.has(item.id);
                this.seen.set(item.id, now);
                if (first || known || this.read.has(item.title)) continue;

                arrived.push(item);
            }
        }

        const story = newest(arrived);
        if (story === undefined) return;

        if (arrived.length > 1) {
            this.logger.debug('director: more than one breaking story arrived at once, so only the newest was asked for', {
                arrived: arrived.length,
            });
        }

        const result = await this.director.requestBreak({
            kind: NEWS_KIND,
            urgency: 'next',
            source: 'news',
            reason: `a new story on ${story.feedName ?? 'a breaking feed'}`,
            key: BREAKING_REQUEST_KEY,
            cooldownMs: this.cooldownMs(),
            context: {
                [BREAKING_CONTEXT.headline]: story.title,
                ...(story.feedId === undefined ? {} : { [BREAKING_CONTEXT.feedId]: story.feedId }),
                [BREAKING_CONTEXT.itemId]: story.id,
            },
        });

        if (result.accepted) this.logger.info('director: asked the station to read a breaking story', { feed: story.feedId, story: story.id });
        else this.logger.debug(`director: a breaking story was not put on air (${result.reason ?? 'the station said nothing'})`);
    }

    private pollMs(): number {
        return (
            numberInRange(
                this.config.get(BREAKING_KEYS.pollMinutes, DEFAULT_BREAKING_POLL_MINUTES),
                DEFAULT_BREAKING_POLL_MINUTES,
                { min: MIN_BREAKING_POLL_MINUTES, max: MAX_BREAKING_POLL_MINUTES },
                Math.floor,
            ) * 60_000
        );
    }

    private cooldownMs(): number {
        return (
            numberInRange(
                this.config.get(BREAKING_KEYS.cooldownMinutes, DEFAULT_BREAKING_COOLDOWN_MINUTES),
                DEFAULT_BREAKING_COOLDOWN_MINUTES,
                { min: MIN_BREAKING_COOLDOWN_MINUTES, max: MAX_BREAKING_COOLDOWN_MINUTES },
                Math.floor,
            ) * 60_000
        );
    }
}

/** The most recently published of these, or the first when none says when it was published. */
function newest(items: readonly NewsItem[]): NewsItem | undefined {
    let best: NewsItem | undefined;
    let bestAt = Number.NEGATIVE_INFINITY;

    for (const item of items) {
        const at = item.publishedAt === undefined ? Number.NaN : Date.parse(item.publishedAt);
        const when = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
        if (best === undefined || when > bestAt) {
            best = item;
            bestAt = when;
        }
    }

    return best;
}
