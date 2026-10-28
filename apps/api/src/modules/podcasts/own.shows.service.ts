import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';
import { stationZone } from '#modules/director/clock.words.js';
import { NewsService } from '#modules/news/news.service.js';
import type { NewsItem } from '@deadair/plugin-sdk';
import { ProductionsService } from '#modules/productions/productions.service.js';
import { ProductionRepository } from '#modules/productions/production.repository.js';
import type { ProductionSource } from '#modules/productions/production.js';
import type { Production, ProductionList } from '#modules/productions/types/productions.types.js';
import { DEFAULT_NEWS_HOURS, type OwnShowRecord, type OwnShowWrite } from './own.show.js';
import { OwnShowRepository } from './own.show.repository.js';
import type { OwnEpisodeRequest, OwnShow, OwnShowInput, OwnShowList } from './types/podcasts.types.js';

/** Where an episode's own subject is cut, in its title. The whole of it is still its brief. */
const TITLE_TOPIC_CHARS = 120;

/** What a source pasted with no name of its own is called. */
const PASTED = 'Pasted text';

/**
 * How many stories an episode of a news show reads, at most.
 *
 * A source's notes are bounded and so is the whole production's (`MAX_RESEARCH_NOTES`), so a seventh
 * story would be read for notes the episode then has no room for. Six stories at three or four notes each
 * fills a programme of the length a news show runs.
 */
export const NEWS_STORIES = 6;

/**
 * How many earlier editions are read for the stories they already covered.
 *
 * More than a show makes in its longest window (a week, at three editions a day, is twenty-one): an
 * edition outside the window cannot share a story with this one anyway, since the window is what bounds
 * how old a story may be.
 */
const EARLIER_EDITIONS = 30;

/** What an episode of a news show is about when neither it nor its show says. */
const NEWS_BRIEF = "Today's news in depth: a few of the day's stories explained properly, rather than many read out.";

/**
 * The shows the station makes for itself, beside the ones it carries from somebody else's feeds.
 *
 * A show is a saved recipe and every episode is a production, asked for through
 * `ProductionsService.commission`, the same path the Productions page uses. So an episode is queued,
 * researched, written, spoken, joined and aired by code that already does all of that, and a show adds
 * nothing to any of it but its defaults and the filing.
 */
@Injectable()
export class OwnShowsService {
    constructor(
        private readonly shows: OwnShowRepository,
        private readonly productions: ProductionsService,
        private readonly news: NewsService,
        private readonly config: AppConfig,
        private readonly editions: ProductionRepository,
    ) {}

    async list(): Promise<OwnShowList> {
        return { shows: (await this.shows.list()).map(view) };
    }

    async create(body: OwnShowInput): Promise<OwnShow> {
        return view(await this.shows.create(writeOf(body)));
    }

    async update(id: string, body: OwnShowInput): Promise<OwnShow> {
        const updated = await this.shows.update(id, writeOf(body));
        if (updated === undefined) throw missing(id);
        return view(updated);
    }

    async remove(id: string): Promise<void> {
        if (!(await this.shows.remove(id))) throw missing(id);
    }

    /** A show's episodes, newest first, with how far along each is. */
    async episodes(id: string): Promise<ProductionList> {
        if ((await this.shows.find(id)) === undefined) throw missing(id);
        return await this.productions.listForShow(id);
    }

    /**
     * Ask a show for an episode.
     *
     * Its subject is the episode's own topic when one is given and the show's standing one otherwise;
     * pasted text becomes a source, which the research pass reads for the notes the episode may state as
     * fact. An episode with neither a subject nor anything to read is refused here, since it would be a
     * production about nothing in particular, which is what the show exists to avoid.
     *
     * A show that reads the news reads it now, when the episode is asked for, and hands the stories over
     * as its sources: the news as it stood when somebody asked is the news they asked about, and reading
     * it here keeps the research pass knowing nothing about shows. Pasted text or an address takes the
     * news's place, since an operator who gave the episode something to read meant that rather than the
     * feeds. An address is read by the research pass, through whichever plugin can open a page.
     */
    async requestEpisode(id: string, body: OwnEpisodeRequest): Promise<Production> {
        const show = await this.shows.find(id);
        if (show === undefined) throw missing(id);

        const topic = body.topic?.trim() ?? '';
        const text = body.text?.trim() ?? '';
        const url = body.url?.trim() ?? '';
        const given = text.length > 0 || url.length > 0;
        const readsNews = !given && (show.newsFeedIds?.length ?? 0) > 0;
        const brief = topic.length > 0 ? topic : (show.subject ?? (readsNews ? NEWS_BRIEF : undefined));
        if (brief === undefined && !given) {
            throw httpError(400).withDetails({
                message: `"${show.title}" has no subject of its own, so an episode needs a topic or something to read`,
            });
        }

        const sourceTitle = body.sourceTitle?.trim() ?? '';
        const sources = readsNews
            ? await this.newsSources(show)
            : [
                  // Titled by its address until the research pass reads the title the page gives itself.
                  ...(url.length === 0 ? [] : [{ title: url.slice(0, 300), url }]),
                  ...(text.length === 0 ? [] : [{ title: sourceTitle.length > 0 ? sourceTitle : PASTED, text }]),
              ];

        return await this.productions.commission(
            {
                kind: 'podcast',
                title: episodeTitle(show, topic, Date.now(), stationZone(this.config)),
                ...(brief === undefined ? {} : { brief }),
                ...(sources.length === 0 ? {} : { sources }),
                // Researched only when it was handed nothing to read: pasted text, a page or the news
                // is what it was asked to be about, and the trusted sites are for when there is none.
                ...(sources.length === 0 && show.research === true ? { research: true } : {}),
                ...(show.personaId === undefined ? {} : { personaId: show.personaId }),
                ...(show.targetMs === undefined ? {} : { targetMs: show.targetMs }),
                ...(show.writingMode === undefined ? {} : { writingMode: show.writingMode }),
                ...(body.airAt === undefined ? {} : { scheduledFor: body.airAt }),
            },
            { showId: show.id },
        );
    }

    /**
     * The newest stories on a news show's feeds, within its window, as sources. Through
     * `NewsService.fetchItems`, so a story an operator keeps off the air is kept out of the episode
     * too. Refused when there is nothing to read, rather than queueing an episode its research pass
     * would only fail.
     *
     * A story an earlier edition of this show already covered, inside the same window, is left out: the
     * noon edition re-reading the morning's is the bulletin's repeat in a longer form, and a listener
     * hears it as the station not knowing what it said. Each feed is asked for twice the stories an
     * edition reads, so there is something left after the cut. An edition that failed or was cancelled
     * never aired, so it has covered nothing. When everything on the feeds has been covered the request
     * is refused, on the bulletin's own argument: silence an operator can see beats a repeat.
     */
    private async newsSources(show: OwnShowRecord): Promise<{ title: string; url?: string; text: string }[]> {
        const hours = show.newsHours ?? DEFAULT_NEWS_HOURS;
        const sinceMs = Date.now() - hours * 60 * 60_000;
        const since = new Date(sinceMs).toISOString();

        const items: NewsItem[] = [];
        for (const feedId of show.newsFeedIds ?? []) {
            items.push(...(await this.news.fetchItems({ feedId, since, limit: NEWS_STORIES * 2 })));
        }

        const earlier = (await this.editions.forShow(show.id, EARLIER_EDITIONS))
            .filter(edition => edition.createdAt >= sinceMs && edition.state !== 'failed' && edition.state !== 'cancelled')
            .flatMap(edition => edition.sources ?? []);

        const sources = newsSourcesOf(items, NEWS_STORIES, coveredBy(earlier));
        if (sources.length === 0) {
            const why = items.length === 0 ? 'found no stories on its feeds' : 'has already covered every story on its feeds';
            throw httpError(400).withDetails({ message: `"${show.title}" ${why} in the last ${hours} hours` });
        }
        return sources;
    }
}

/**
 * What earlier editions covered, as the keys {@link newsSourcesOf} leaves out: each source's address and
 * its headline, lowercased, since one story fetched twice can come back under either.
 */
export function coveredBy(sources: readonly Pick<ProductionSource, 'title' | 'url'>[]): Set<string> {
    const keys = new Set<string>();
    for (const source of sources) {
        if (source.url !== undefined) keys.add(source.url.toLowerCase());
        keys.add(source.title.toLowerCase());
    }
    return keys;
}

/**
 * Stories as sources, newest first: one per story that has words in it beyond its headline, the same
 * story twice taken once, none an earlier edition {@link coveredBy}, and no more than {@link NEWS_STORIES}.
 */
export function newsSourcesOf(
    items: readonly NewsItem[],
    most = NEWS_STORIES,
    covered: ReadonlySet<string> = new Set(),
): { title: string; url?: string; text: string }[] {
    const seen = new Set<string>();
    const newest = [...items].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    const sources: { title: string; url?: string; text: string }[] = [];

    for (const item of newest) {
        if (sources.length >= most) break;
        const text = (item.content ?? item.summary ?? '').trim();
        if (text.length === 0) continue;

        const key = (item.url ?? item.title).toLowerCase();
        if (seen.has(key)) continue;
        // The headline as it would have been stored, cut where a source's title is cut.
        if (covered.has(key) || covered.has(item.title.slice(0, 300).toLowerCase())) continue;
        seen.add(key);

        sources.push({
            title: item.title.slice(0, 300),
            ...(item.url === undefined ? {} : { url: item.url.slice(0, 2000) }),
            text: text.slice(0, 20_000),
        });
    }

    return sources;
}

/**
 * What an episode is called: the show and its topic, or the show and the day when it has none of its
 * own. The topic is cut short for the title only; the whole of it is the episode's brief.
 */
export function episodeTitle(show: Pick<OwnShowRecord, 'title'>, topic: string, at: number, zone: string): string {
    if (topic.length > 0) {
        const short = topic.length > TITLE_TOPIC_CHARS ? `${topic.slice(0, TITLE_TOPIC_CHARS).trimEnd()}…` : topic;
        return `${show.title}: ${short}`.slice(0, 300);
    }

    const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at));
    return `${show.title}, ${day}`.slice(0, 300);
}

const missing = (id: string) => httpError(404).withDetails({ message: `show "${id}" does not exist` });

/** What the operator sent, trimmed, with an empty box as nothing. */
function writeOf(body: OwnShowInput): OwnShowWrite {
    const optional = (value: string | undefined): string | undefined => {
        const trimmed = value?.trim() ?? '';
        return trimmed.length === 0 ? undefined : trimmed;
    };
    const description = optional(body.description);
    const subject = optional(body.subject);
    const personaId = optional(body.personaId);
    const feeds = (body.newsFeedIds ?? []).map(feed => feed.trim()).filter(feed => feed.length > 0);

    return {
        title: body.title.trim(),
        ...(description === undefined ? {} : { description }),
        ...(subject === undefined ? {} : { subject }),
        ...(personaId === undefined ? {} : { personaId }),
        ...(body.targetMs === undefined ? {} : { targetMs: body.targetMs }),
        ...(body.writingMode === undefined ? {} : { writingMode: body.writingMode }),
        ...(feeds.length === 0 ? {} : { newsFeedIds: feeds }),
        ...(body.newsHours === undefined ? {} : { newsHours: body.newsHours }),
        ...(body.research === true ? { research: true as const } : {}),
    };
}

function view(show: OwnShowRecord): OwnShow {
    return {
        id: show.id,
        title: show.title,
        ...(show.description === undefined ? {} : { description: show.description }),
        ...(show.subject === undefined ? {} : { subject: show.subject }),
        ...(show.personaId === undefined ? {} : { personaId: show.personaId }),
        ...(show.targetMs === undefined ? {} : { targetMs: show.targetMs }),
        ...(show.writingMode === undefined ? {} : { writingMode: show.writingMode }),
        ...(show.newsFeedIds === undefined ? {} : { newsFeedIds: [...show.newsFeedIds] }),
        ...(show.newsHours === undefined ? {} : { newsHours: show.newsHours }),
        ...(show.research === true ? { research: true } : {}),
        createdAt: DateTime.fromMillis(show.createdAt),
    };
}
