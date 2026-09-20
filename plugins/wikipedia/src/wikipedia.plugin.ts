import {
    Plugin,
    configString,
    type AlbumEnrichment,
    type AlbumRef,
    type AlmanacDay,
    type AlmanacEntry,
    type AlmanacPluginInstance,
    type AlmanacQuery,
    type ArtistEnrichment,
    type ArtistRef,
    type EnrichmentMatchKey,
    type EnrichmentPluginInstance,
    type PluginConnectionResult,
    type SourceDocument,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';

import { MediaWikiClient, MediaWikiRequestError } from './wikipedia.client.js';
import {
    almanacDate,
    askableDate,
    cappedPerKind,
    entriesIn,
    feedTypesFor,
    feedUrl,
    ofKinds,
    withoutDuplicates,
    type FeedType,
} from './wikipedia.almanac.js';
import {
    DEFAULT_LANGUAGE,
    PROPERTY_MUSICBRAINZ_ARTIST,
    PROPERTY_MUSICBRAINZ_RECORDING,
    PROPERTY_MUSICBRAINZ_RELEASE_GROUP,
    TEST_ARTIST_MBID,
    WIKIDATA_API,
    wikipediaApi,
} from './wikipedia.manifest.js';
import {
    articleUrl,
    asDocument,
    chooseSong,
    extractOf,
    labelOf,
    searchedIds,
    sitelinkTitle,
    songCandidate,
    songSearchTerms,
    statementQuery,
    type SongCandidate,
} from './wikipedia.resolve.js';
import type {
    MediaWikiSearchResponse,
    OnThisDayResponse,
    WikidataEntitiesResponse,
    WikidataEntity,
    WikipediaExtractResponse,
} from './wikipedia.types.js';

export { wikipediaManifest } from './wikipedia.manifest.js';

/**
 * Song candidates to weigh. A name search returns the song item, the recording
 * item, the album of the same name and a handful of unrelated pages, so this is
 * deep enough to get past the near misses and shallow enough to stay one page.
 */
const SEARCH_LIMIT = 6;

/**
 * Milliseconds below which a further request is not started.
 *
 * A resolve is a chain — identify, then look up the article — and being cut off
 * between the two spends the requests and stores nothing. Checked before each
 * step so a call that runs out of budget returns what it has rather than
 * throwing away what it already paid for.
 */
const STEP_BUDGET_MS = 2_000;

/** How long a day's entries are reused for. See {@link WikipediaPlugin.feedEntries} for why it is this long. */
const FEED_CACHE_MS = 12 * 60 * 60_000;

/**
 * How many days' entries are held at once.
 *
 * A station asks about today and, for the last minutes before midnight,
 * tomorrow; four endpoints each is the whole of what a running station touches,
 * and the ceiling is only here so a process that runs for a year does not hold
 * one.
 */
const MAX_CACHED_FEEDS = 8;

/**
 * What an identified item contributes, whichever of the three levels it is.
 *
 * The four fields mean exactly the same thing on a track, an artist and a
 * record, and this plugin fills no other, so one shape covers all three rather
 * than three near-identical ones that could drift.
 */
type IdentifiedEnrichment = Partial<Pick<TrackEnrichment, 'providerRef' | 'externalIds' | 'links' | 'documents'>>;

/**
 * Wikipedia as an enrichment source.
 *
 * ## What it contributes, and what it refuses to
 *
 * It answers with `documents` and nothing that would be spoken as it stands:
 * no `facts`, no `year`, no `genres`, no canonical spelling of anything. That
 * is the whole design. An encyclopaedia article is PROSE, and turning prose
 * into a sentence a DJ can say is a job for the host, which can check a claim
 * against the text it came from and keep the citation. A plugin composing its
 * own one-liners out of an article would be doing that unchecked, and nothing
 * downstream could tell the difference.
 *
 * It runs at priority 500 — supplementary — but the number barely matters here,
 * because there is no scalar for it to win or lose. It contributes a list, and
 * lists accumulate.
 *
 * ## How a record is found
 *
 * By id, wherever there is one. Wikidata carries the MusicBrainz id for an
 * artist (P434) and a release group (P436) as a statement, so an artist and a
 * record are found by a search that cannot match the wrong one, then followed
 * to their article through the language sitelink.
 *
 * A song is the awkward one and gets its own path, described on
 * {@link chooseSong}: a MusicBrainz RECORDING id usually resolves to a bare
 * Wikidata item with no article, because the prose about a song lives on the
 * song item, which is keyed by a work id the catalog does not hold. So the song
 * path searches by name and then refuses everything whose label is not the
 * title and whose performers do not include the artist.
 */
export class WikipediaPlugin extends Plugin implements EnrichmentPluginInstance, AlmanacPluginInstance {
    /** Supplementary. It contributes prose and no canonical field, so it competes with nobody. */
    readonly priority = 500;

    /** Every level here is reached from a name plus, where the catalog has one, an mbid. */
    readonly matchKeys: EnrichmentMatchKey[] = ['artist-title'];

    /** A day's entries and when they were read, keyed by language, date and endpoint. See {@link feedEntries}. */
    private readonly days = new Map<string, { at: number; entries: AlmanacEntry[] }>();

    private wikidata?: MediaWikiClient;
    private wikipedia?: MediaWikiClient;
    private language = DEFAULT_LANGUAGE;
    private includeSongArticles = true;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        const contactEmail = configString(config.contactEmail) ?? '';
        this.language = (configString(config.language) ?? DEFAULT_LANGUAGE).toLowerCase();
        this.includeSongArticles = config.includeSongArticles !== false;

        // No contact address means no client at all rather than a client that
        // will eventually be blocked: Wikimedia's policy is explicit that an
        // unidentified caller may be cut off without notice, and one clear
        // config error beats an outage nobody can explain.
        this.wikidata = contactEmail.length > 0 ? new MediaWikiClient(this.host, WIKIDATA_API, contactEmail) : undefined;
        this.wikipedia = contactEmail.length > 0 ? new MediaWikiClient(this.host, wikipediaApi(this.language), contactEmail) : undefined;

        this.host.logger.info('wikipedia enrichment ready', {
            configured: this.wikidata !== undefined,
            language: this.language,
            songArticles: this.includeSongArticles,
        });
    }

    protected async onUnload(): Promise<void> {
        this.wikidata = undefined;
        this.wikipedia = undefined;
        // A map a plugin forgets lives in the API server until a restart, which
        // is what in-process plugins make cheap to get wrong.
        this.days.clear();
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (!this.wikidata || !this.wikipedia) {
            return { ok: false, message: 'Add a contact email address. Wikimedia asks every client to identify itself.' };
        }

        try {
            const id = await this.identify(PROPERTY_MUSICBRAINZ_ARTIST, TEST_ARTIST_MBID);
            if (!id) return { ok: false, message: 'Wikidata answered, but not with the artist it was asked about. Check the network path.' };

            const article = await this.articleFor(id);
            if (!article) {
                return { ok: true, message: `Connected to Wikidata, but that artist has no ${this.language} article. Check the language code.` };
            }

            return { ok: true, message: `Connected. Reading the ${this.language} Wikipedia.` };
        } catch (error) {
            const reason = error instanceof MediaWikiRequestError ? `HTTP ${error.status}` : 'the request failed';
            return { ok: false, message: `Could not reach Wikimedia: ${reason}.` };
        }
    }

    /**
     * The article about a song.
     *
     * Two routes, tried in that order and both bounded: the recording id when
     * Wikidata happens to have an item with an article for it, which is
     * uncommon and free to check because the id is already in hand, and then
     * the name search that {@link chooseSong} judges.
     */
    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        if (!this.wikidata || !this.includeSongArticles) return {};

        // No `providerRef` shortcut here, unlike the two below: `TrackRef` has
        // no field for one, so a song is identified from scratch every time the
        // host asks. It asks once per storage TTL, so that is a search every
        // three months rather than every pass.
        const id = await this.songId(ref);
        if (!id) return {};

        return await this.enrichmentFor(id);
    }

    /** The article about an artist, found by their MusicBrainz id and nothing else. */
    async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
        if (!this.wikidata) return {};

        const id = (await this.knownId(ref.providerRef)) ?? (ref.mbid ? await this.identify(PROPERTY_MUSICBRAINZ_ARTIST, ref.mbid) : undefined);
        if (!id) return {};

        return await this.enrichmentFor(id);
    }

    /** The article about a record, found by its MusicBrainz release-group id. */
    async enrichAlbum(ref: AlbumRef): Promise<Partial<AlbumEnrichment>> {
        if (!this.wikidata) return {};

        const id =
            (await this.knownId(ref.providerRef)) ?? (ref.mbid ? await this.identify(PROPERTY_MUSICBRAINZ_RELEASE_GROUP, ref.mbid) : undefined);
        if (!id) return {};

        return await this.enrichmentFor(id);
    }

    /**
     * What happened on that date, out of the edition's "on this day" feed.
     *
     * `undefined` for every way of having nothing — a plugin with no contact
     * address, an edition that does not publish the feed, a service that is
     * down — because they are one outcome to the station and the log line is
     * where the difference lives. A date the feed knows nothing about is the
     * same answer and is not a failure: the 29th of February is a thin day
     * everywhere.
     *
     * The budget check is before the first request rather than after, for
     * `plugins/weather`'s reason: being cut off mid-request costs the request
     * and leaves nothing to show for it.
     */
    async getDay(query: AlmanacQuery): Promise<AlmanacDay | undefined> {
        const host = this.host;
        if (!this.wikipedia) return undefined;

        const date = askableDate(query.month, query.day);
        if (date === undefined) {
            host.logger.debug('wikipedia: that is not a date', { month: query.month, day: query.day });
            return undefined;
        }

        const fetched: AlmanacEntry[] = [];
        for (const type of feedTypesFor(query.kinds)) {
            const entries = await this.feedEntries(type, date.month, date.day);
            if (entries !== undefined) fetched.push(...entries);
        }

        // Nothing at all is nothing to say, and is told apart from a day whose
        // entries were all filtered away by the caller's own kinds: this one is
        // usually a service that did not answer, and the line above it said so.
        if (fetched.length === 0) return undefined;

        const entries = cappedPerKind(ofKinds(withoutDuplicates(fetched), query.kinds), query.limit);
        return { date: almanacDate(date.month, date.day), entries };
    }

    /**
     * One endpoint's entries, fetched once a day and then remembered.
     *
     * In memory rather than `host.storage`, which is the right lifetime: an
     * operator saving the form reinitializes the plugin, and what they have
     * usually just changed is the language — so a day parsed out of another
     * edition must not survive it. Small because it holds what came out of the
     * parse rather than the response: the whole day is 1.4 MB on the wire and a
     * few kilobytes of sentences afterwards.
     *
     * The window is half a day because that is the shape of the mistake it can
     * make. The day's page is edited occasionally and a station holding a
     * yesterday's copy of it says something slightly out of date rather than
     * something false, so the reuse is worth far more than the freshness — and
     * a station asks about at most two dates, today's and, in the last minutes
     * before midnight, tomorrow's.
     */
    private async feedEntries(type: FeedType, month: number, day: number): Promise<AlmanacEntry[] | undefined> {
        const host = this.host;
        const key = `${this.language}|${almanacDate(month, day)}|${type}`;

        const held = this.days.get(key);
        if (held !== undefined && Date.now() - held.at <= FEED_CACHE_MS) return held.entries;
        if (held !== undefined) this.days.delete(key);

        if (host.remainingMs() < STEP_BUDGET_MS) {
            host.logger.debug('wikipedia: not enough of the call left to read the day', { type });
            return undefined;
        }

        try {
            const response = await this.wikipedia!.getUrl<OnThisDayResponse>(feedUrl(this.language, type, month, day));
            const entries = entriesIn(response);

            // Kept even when empty, which is the point of remembering: an
            // edition that answers 200 with nothing would otherwise be asked
            // again at every break for the rest of the day.
            this.forget();
            this.days.set(key, { at: Date.now(), entries });

            return entries;
        } catch (error) {
            // A 404 is the edition not publishing this feed at all, which is
            // the one failure here an operator can act on — and it is reported
            // rather than thrown, because a thrown one would fail the whole
            // invocation on every break for a station that simply has to change
            // its language or stop asking.
            const status = error instanceof MediaWikiRequestError ? error.status : undefined;
            if (status === undefined) throw error;

            host.logger.info('wikipedia: the day could not be read', { language: this.language, type, status });
            return undefined;
        }
    }

    /** The oldest day, dropped, so a station that runs for months holds a handful rather than a year. */
    private forget(): void {
        while (this.days.size >= MAX_CACHED_FEEDS) {
            const oldest = this.days.keys().next().value;
            if (oldest === undefined) return;
            this.days.delete(oldest);
        }
    }

    /**
     * The id this plugin resolved last time, when the host has handed it back.
     *
     * `async` for the shape of the call sites rather than because it waits on
     * anything: it sits in a `??` chain beside two lookups that do.
     */
    private async knownId(providerRef: string | undefined): Promise<string | undefined> {
        const id = providerRef?.trim();
        return await Promise.resolve(id && /^Q\d+$/.test(id) ? id : undefined);
    }

    /** One search for a statement, which is what turns a MusicBrainz id into a Q-id. */
    private async identify(property: string, mbid: string): Promise<string | undefined> {
        const response = await this.wikidata!.get<MediaWikiSearchResponse>({
            action: 'query',
            list: 'search',
            srsearch: statementQuery(property, mbid),
            srlimit: '1',
        });

        return searchedIds(response, 1)[0];
    }

    /** The recording id first, then the name search. See {@link chooseSong}. */
    private async songId(ref: TrackRef): Promise<string | undefined> {
        if (ref.mbid) {
            const recording = await this.identify(PROPERTY_MUSICBRAINZ_RECORDING, ref.mbid);
            // Only worth taking when it actually reaches an article. A recording
            // item with no sitelink is the ordinary case and is not an answer:
            // returning it would store a `providerRef` that resolves to nothing
            // and stop the name search from ever running for this track.
            if (recording && (await this.hasArticle(recording))) return recording;
        }

        const terms = songSearchTerms(ref.title, ref.artist);
        if (!terms || this.host.remainingMs() < STEP_BUDGET_MS) return undefined;

        const response = await this.wikidata!.get<MediaWikiSearchResponse>({
            action: 'query',
            list: 'search',
            srsearch: terms,
            srlimit: String(SEARCH_LIMIT),
        });

        const ids = searchedIds(response, SEARCH_LIMIT);
        if (ids.length === 0 || this.host.remainingMs() < STEP_BUDGET_MS) return undefined;

        const entities = await this.entities(ids, 'labels|sitelinks|claims');
        const candidates = ids.map(id => songCandidate(id, entities.get(id), this.language));

        return chooseSong(candidates, await this.performerLabels(candidates), ref.title, ref.artist)?.id;
    }

    /**
     * The labels of every performer named by a candidate, in one request.
     *
     * The extra round trip is what makes the name search safe to use at all:
     * without it the only evidence that a found item is this artist's song is
     * that the artist's name was in the query, which a search engine treats as
     * a hint rather than a condition.
     */
    private async performerLabels(candidates: SongCandidate[]): Promise<Map<string, string>> {
        const ids = [...new Set(candidates.flatMap(candidate => candidate.performerIds))];
        if (ids.length === 0 || this.host.remainingMs() < STEP_BUDGET_MS) return new Map();

        const entities = await this.entities(ids.slice(0, 50), 'labels');
        const labels = new Map<string, string>();
        for (const [id, entity] of entities) {
            const label = labelOf(entity, this.language);
            if (label) labels.set(id, label);
        }

        return labels;
    }

    /** Whether an item is linked to an article in the configured edition. */
    private async hasArticle(id: string): Promise<boolean> {
        return (await this.articleFor(id)) !== undefined;
    }

    /** One item's article title in the configured edition. */
    private async articleFor(id: string): Promise<string | undefined> {
        const entities = await this.entities([id], 'sitelinks');
        return sitelinkTitle(entities.get(id), this.language);
    }

    /** One `wbgetentities` call, however many ids it is asked about. */
    private async entities(ids: string[], props: string): Promise<Map<string, WikidataEntity>> {
        if (ids.length === 0) return new Map();

        const response = await this.wikidata!.get<WikidataEntitiesResponse>({
            action: 'wbgetentities',
            ids: ids.join('|'),
            props,
            // Sitelinks for every edition would be several hundred entries per
            // artist, and one of them is wanted. Harmless when `props` does not
            // ask for sitelinks at all.
            sitefilter: `${this.language}wiki`,
            languages: `${this.language}|en`,
        });

        return new Map(Object.entries(response.entities ?? {}));
    }

    /**
     * An identified item as what this plugin contributes: the article, a link
     * to it, and the Wikidata id under both the ref it will be asked by next
     * time and the external id anything else can use.
     *
     * An item with no article in this language still answers with its ids. It
     * is a real identification and worth remembering, and it saves the next
     * pass the search that found it.
     */
    private async enrichmentFor(id: string): Promise<IdentifiedEnrichment> {
        const base = { providerRef: id, externalIds: [{ source: 'wikidata', id }] };
        if (this.host.remainingMs() < STEP_BUDGET_MS) return base;

        const title = await this.articleFor(id);
        if (!title) return base;

        const link = { label: 'Wikipedia', url: articleUrl(this.language, title) };
        if (this.host.remainingMs() < STEP_BUDGET_MS) return { ...base, links: [link] };

        const document = await this.article(title);

        return document ? { ...base, links: [link], documents: [document] } : { ...base, links: [link] };
    }

    /** The prose itself. `redirects=1` so a title that moved still answers. */
    private async article(title: string): Promise<SourceDocument | undefined> {
        const response = await this.wikipedia!.get<WikipediaExtractResponse>({
            action: 'query',
            prop: 'extracts',
            explaintext: '1',
            exsectionformat: 'plain',
            redirects: '1',
            titles: title,
        });

        const article = extractOf(response);
        return article ? asDocument(this.language, article, new Date().toISOString()) : undefined;
    }
}
