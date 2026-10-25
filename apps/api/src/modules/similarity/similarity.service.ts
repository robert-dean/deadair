import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { ArtistRef, ArtistTrack, SimilarArtist, TrackRef } from '@deadair/plugin-sdk';
import { type SimilarityPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PROVIDER_CAPABILITIES, pluginsInOrder } from '#modules/plugins/plugin.providers.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { errorText } from '#modules/shared/error.text.js';
import { BoundedTtlMap } from '#modules/shared/bounded.ttl.map.js';
import { SimilarityStoreRepository, type StoredAnswer } from './similarity.store.repository.js';

/**
 * An artist that resembles the one asked about, and which plugin said so.
 *
 * The SDK's `SimilarArtist` with the one thing the merge used to throw away. A plugin's `match` is only
 * comparable inside its own answer, so a reason given for a neighbour ("listeners on Last.fm link them")
 * has to be able to say whose answer it was. Host-side only: a plugin never sees or sets it.
 */
export type Neighbour = SimilarArtist & {
    /** The plugin id whose answer named this artist first. */
    source: string;
};

/**
 * Who else sounds like this, out of whatever similarity plugins are installed.
 *
 * ## Two opinions are two opinions, not a conflict
 *
 * Enrichment merges in priority order because there is one right answer about a
 * release year. There is no right answer about who resembles Portishead, so this
 * merges without ranking the sources: every name any source offered is kept, and
 * `match` orders within one source's answer rather than across two. Sources score
 * on incompatible bases — co-listening, tags, editorial — and treating one
 * plugin's 0.8 as beating another's 0.6 would be arithmetic on numbers that do
 * not share a scale.
 *
 * ## What the sources said is kept, and read back first
 *
 * This used to be a `Map` with a day's TTL and deliberately no table, on the
 * argument that a cold start costs one upstream call per artist the station plays
 * and a schema is a thing to migrate forever, until something needed similarity to
 * survive a restart or to be QUERYABLE. A briefed show is that something: a model
 * handed a shortlist needs every record known for a brief's acts and their
 * neighbours in one query, deeper than any one refill asks for, and the station
 * deploys itself on every push, so the map was empty several times a day.
 *
 * So every answer to {@link similarTo} and {@link topTracks} is written through to
 * `SimilarityStoreRepository` (`0119_similarity_store.sql`), and a question is
 * answered from there while the stored answer is younger than
 * {@link STORED_ANSWER_TTL_MS} and asked for at least as many. Filled ON DEMAND:
 * nothing here walks the library, so the store holds the artists the station
 * actually airs and walks toward. The map stays in front of it for the neighbours,
 * since the similar walk asks about the same artists constantly within a day. A
 * store that cannot be read or written costs the store and never the answer.
 *
 * ## It suggests and never schedules
 *
 * Everything here is names. Whether any of it airs is settled in `PickResolver`,
 * where the dislike veto and the rotation rules live, so a similarity plugin
 * cannot put a record on air that the operator forbade.
 */

/**
 * How long an answer is trusted.
 *
 * A day, which is far shorter than the fact needs — who resembles whom moves on
 * a scale of months — and is chosen so a process that has been up for a week is
 * not still answering from the state of somebody's service last Tuesday. It costs
 * one call per artist per day at worst, against a rotation that asks about the
 * same handful all evening.
 */
export const SIMILARITY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How many artists are remembered at once.
 *
 * A station's rotation touches a few hundred artists, so this holds the whole
 * working set with room to spare. It is a bound rather than a target: the map
 * lives for the life of the process and something has to stop a long-running
 * station accumulating every artist it has ever asked about.
 */
export const SIMILARITY_CACHE_MAX = 2_000;

/**
 * How long a stored answer is trusted.
 *
 * A week where the map above trusts a day, because the two are for different
 * things. The map keeps a long-running process from answering from last Tuesday's
 * state of somebody's service; the store keeps a deploy, or a shortlist asking about
 * twenty artists at once, from asking the providers again for an answer that moves
 * on a scale of months. A week also bounds how stale a top-tracks ranking gets.
 */
export const STORED_ANSWER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long one call into a plugin may take. Bounded well inside a refill's own budget. */
const INVOKE_TIMEOUT_MS = 12_000;

@Injectable()
export class SimilarityService {
    /**
     * SINGLETON state on a SCOPED service, deliberately, and this is the one thing
     * here that would be a bug any other way.
     *
     * The service is registered scoped like every other plugin consumer, so a new
     * instance exists per job run and per request. A cache on the instance would
     * therefore be empty every time it was read, which is not a slow cache but no
     * cache at all — and it would look like one in every test that used a single
     * instance. Static, it is what the class means: one process, one memory of
     * what an upstream said.
     */
    private static readonly cache = new BoundedTtlMap<Neighbour[]>(SIMILARITY_TTL_MS, SIMILARITY_CACHE_MAX);

    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
        private readonly store: SimilarityStoreRepository,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasSimilarity(): boolean {
        return this.plugins().length > 0;
    }

    /** Whether anything can turn an artist into records, which is what programming from this needs. */
    canNameTracks(): boolean {
        return this.plugins().some(plugin => plugin.namesTracks);
    }

    /**
     * Artists that resemble this one, from every source, best first within each.
     *
     * Deduplicated by `normalizeKey`, the same comparison the rotation keys use,
     * so "Massive Attack" from one source and "massive attack" from another are
     * one artist. The first source to name somebody wins their entry, which keeps
     * whichever ids came with it.
     */
    async similarTo(ref: ArtistRef, limit: number): Promise<Neighbour[]> {
        const key = normalizeKey(ref.name);
        if (key.length === 0) return [];

        const cached = SimilarityService.cache.get(key);
        if (cached !== undefined) return cached.slice(0, limit);

        const stored = serves(await this.read(() => this.store.neighbours(key)), limit);
        if (stored !== undefined) {
            this.remember(key, stored);
            return stored.slice(0, limit);
        }

        const found: Neighbour[] = [];
        const seen = new Set<string>([key]);
        // Whether any source answered at all, as against every one of them failing. Only an answer is
        // kept: an outage stored as "nobody resembles them" would hold for a week.
        let anyAnswered = false;

        for (const plugin of this.plugins()) {
            let answered: SimilarArtist[] | undefined;
            try {
                answered = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'similarity.similarArtists',
                    async () => plugin.instance.similarArtists(ref, limit),
                    { timeoutMs: INVOKE_TIMEOUT_MS },
                );
            } catch (error) {
                this.logger.info(`similarity: a plugin could not answer about "${ref.name}" (${plugin.record.id}: ${errorText(error)})`);
                continue;
            }
            anyAnswered = true;

            // Ordered by `match` within this source before the merge, so a source
            // that answered in its own order still contributes its best first.
            for (const artist of [...(answered ?? [])].sort(byMatch)) {
                const name = artist?.name?.trim();
                if (!name) continue;

                // The artist that was asked about is seeded into `seen`, because a
                // source naming them as similar to themselves is a wasted slot in
                // a list a model or a refill will read to the end.
                const artistKey = normalizeKey(name);
                if (artistKey.length === 0 || seen.has(artistKey)) continue;

                seen.add(artistKey);
                found.push({ ...artist, source: plugin.record.id });
            }
        }

        this.remember(key, found);
        if (anyAnswered) {
            await this.write(() =>
                this.store.saveNeighbours(
                    key,
                    ref.name,
                    limit,
                    found.map(neighbour => ({
                        name: neighbour.name,
                        neighbourKey: normalizeKey(neighbour.name),
                        source: neighbour.source,
                        ...(neighbour.mbid === undefined ? {} : { mbid: neighbour.mbid }),
                        ...(neighbour.match === undefined ? {} : { match: neighbour.match }),
                    })),
                ),
            );
        }
        return found.slice(0, limit);
    }

    /**
     * Records to play by an artist.
     *
     * Asked of the plugins that can answer, in order, and the FIRST usable answer
     * wins rather than merging: unlike similarity, this is a ranked list from one
     * source and interleaving two of them produces an order neither stands behind.
     * Kept in the store and answered from there for {@link STORED_ANSWER_TTL_MS}. It
     * used to be asked fresh every time, for the freshest ranking, which was right
     * while a refill asked about a handful of artists for three records each; a
     * ranking a few days old is as good a list of an artist's records, and a shortlist
     * wants twenty-five of them for twenty artists at once.
     */
    async topTracks(ref: ArtistRef, limit: number): Promise<ArtistTrack[]> {
        const key = normalizeKey(ref.name);
        const stored = key.length === 0 ? undefined : serves(await this.read(() => this.store.records(key)), limit);
        if (stored !== undefined) return stored.slice(0, limit).map(({ source: _source, ...track }) => track);

        // As in `similarTo`: kept only when a source answered, even if it answered empty.
        let anyAnswered = false;
        for (const plugin of this.plugins()) {
            if (!plugin.namesTracks) continue;

            try {
                const tracks = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'similarity.artistTopTracks',
                    // Non-null because `namesTracks` is the same declaration-and-implementation
                    // check the rest of the host applies before calling an optional method.
                    async () => plugin.instance.artistTopTracks!(ref, limit),
                    { timeoutMs: INVOKE_TIMEOUT_MS },
                );

                anyAnswered = true;
                const usable = (tracks ?? []).filter(track => track?.title?.trim() && track.artist?.trim()).slice(0, limit);
                if (usable.length > 0) {
                    if (key.length > 0)
                        await this.write(() =>
                            this.store.saveRecords(
                                key,
                                ref.name,
                                limit,
                                usable.map(track => ({ ...track, source: plugin.record.id })),
                            ),
                        );
                    return usable;
                }
            } catch (error) {
                this.logger.info(`similarity: a plugin could not name records by "${ref.name}" (${plugin.record.id}: ${errorText(error)})`);
            }
        }

        if (anyAnswered && key.length > 0) await this.write(() => this.store.saveRecords(key, ref.name, limit, []));
        return [];
    }

    /**
     * Records that sound like one record, from the plugins that can say.
     *
     * {@link topTracks}' rule rather than {@link similarTo}'s: the FIRST usable answer wins, because
     * this is a ranked list from one source and two interleaved are an order neither stands behind.
     * Not cached, for the same reason: the caller asks about a handful of records per run, each a
     * different one. An empty answer is the caller's cue to fall back to the artist walk.
     */
    async similarTracks(ref: TrackRef, limit: number): Promise<ArtistTrack[]> {
        for (const plugin of this.plugins()) {
            if (!plugin.namesSimilarTracks) continue;

            try {
                const tracks = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'similarity.similarTracks',
                    // Non-null for the reason `topTracks` gives: `namesSimilarTracks` is the check.
                    async () => plugin.instance.similarTracks!(ref, limit),
                    { timeoutMs: INVOKE_TIMEOUT_MS },
                );

                const usable = (tracks ?? []).filter(track => track?.title?.trim() && track.artist?.trim());
                if (usable.length > 0) return usable.slice(0, limit);
            } catch (error) {
                this.logger.info(
                    `similarity: a plugin could not name records like "${ref.title}" by "${ref.artist}" (${plugin.record.id}: ${errorText(error)})`,
                );
            }
        }

        return [];
    }

    /** Whether anything can name records that sound like one record, as opposed to only by an artist. */
    canNameSimilarTracks(): boolean {
        return this.plugins().some(plugin => plugin.namesSimilarTracks);
    }

    /**
     * Read a stored answer, or nothing when the store cannot be read. A failed read costs the store
     * and never the answer: the sources are asked as they were before it existed.
     */
    private async read<T>(reading: () => Promise<StoredAnswer<T> | undefined>): Promise<StoredAnswer<T> | undefined> {
        try {
            return await reading();
        } catch (error) {
            this.logger.debug(`similarity: could not read what the sources said before; asking them (${errorText(error)})`);
            return undefined;
        }
    }

    /** Keep an answer, or log that it could not be kept. Never throws: the caller has its answer. */
    private async write(writing: () => Promise<void>): Promise<void> {
        try {
            await writing();
        } catch (error) {
            this.logger.debug(`similarity: could not keep what a source said (${errorText(error)})`);
        }
    }

    /**
     * Hold an answer, evicting the oldest when the map is full. The cap is several times a station's
     * whole rotation, so anything evicted has not been asked about in a very long time.
     */
    private remember(key: string, artists: Neighbour[]): void {
        SimilarityService.cache.set(key, artists);
    }

    /**
     * Every plugin that can answer right now, in the order they are asked.
     *
     * The operator's order first, then everything unlisted alphabetically,
     * which is what this sorted by before the setting existed — so an empty
     * setting is exactly the old behaviour. See `similarity.settings.ts` for
     * why the order matters to two of the three questions and barely at all to
     * the third.
     *
     * Read per call rather than cached on the instance: the service is scoped,
     * so this is once per refill, and a change then applies to the next one
     * without a reload hook.
     */
    private plugins(): SimilarityPlugin[] {
        return pluginsInOrder(this.pluginRegistry.list(), this.config, PROVIDER_CAPABILITIES.similarity);
    }

    /**
     * Forget everything remembered.
     *
     * For tests, which would otherwise leak one case's answers into the next through
     * the static map. Nothing in the app calls it: a plugin reconfigured mid-session
     * answering from yesterday's cache for up to a day is the trade the TTL already
     * makes, and a reload hook here would be a second thing to keep in step with the
     * lifecycle manager for no gain.
     */
    static forget(): void {
        SimilarityService.cache.clear();
    }
}

/**
 * The stored entries when they still serve a question for `limit`: younger than
 * {@link STORED_ANSWER_TTL_MS}, and asked for at least as many, or holding fewer than were asked for,
 * which is everything the source had. Otherwise `undefined`, and the sources are asked.
 */
function serves<T>(stored: StoredAnswer<T> | undefined, limit: number): T[] | undefined {
    if (stored === undefined || stored.ageMs >= STORED_ANSWER_TTL_MS) return undefined;
    if (stored.askedLimit < limit && stored.entries.length >= stored.askedLimit) return undefined;
    return stored.entries;
}

/** Highest `match` first. An entry that did not score sorts last rather than as zero. */
const byMatch = (left: SimilarArtist, right: SimilarArtist): number => (right.match ?? -1) - (left.match ?? -1);
