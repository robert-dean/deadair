import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { ArtistRef, ArtistTrack, SimilarArtist } from '@deadair/plugin-sdk';
import { asSimilarityPlugin, type SimilarityPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { errorText } from '#modules/shared/error.text.js';

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
 * ## The cache is in memory, and that is a decision
 *
 * A rotation revisits a few hundred artists, the answer changes on a scale of
 * months, and the only caller is a background refill with minutes to spend. So a
 * `Map` with a day's TTL is the whole cache and there is deliberately no table:
 * a cold start costs one upstream call per artist the station actually plays, and
 * a schema is a thing to migrate, sweep and back up forever. If something later
 * needs similarity to survive a restart or to be QUERYABLE — "which artists lead
 * to this one" is a real question — that is the day to write one, and this note
 * is why there is not one now.
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

/** How long one call into a plugin may take. Bounded well inside a refill's own budget. */
const INVOKE_TIMEOUT_MS = 12_000;

interface CacheEntry {
    at: number;
    artists: SimilarArtist[];
}

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
    private static readonly cache = new Map<string, CacheEntry>();

    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
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
    async similarTo(ref: ArtistRef, limit: number): Promise<SimilarArtist[]> {
        const key = normalizeKey(ref.name);
        if (key.length === 0) return [];

        const cached = SimilarityService.cache.get(key);
        if (cached && Date.now() - cached.at < SIMILARITY_TTL_MS) return cached.artists.slice(0, limit);

        const found: SimilarArtist[] = [];
        const seen = new Set<string>([key]);

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
                found.push(artist);
            }
        }

        this.remember(key, found);
        return found.slice(0, limit);
    }

    /**
     * Records to play by an artist.
     *
     * Asked of the plugins that can answer, in order, and the FIRST usable answer
     * wins rather than merging: unlike similarity, this is a ranked list from one
     * source and interleaving two of them produces an order neither stands behind.
     * Not cached — the caller asks about a handful of artists per refill and wants
     * the freshest ranking, where the similarity list above is asked about the same
     * artists constantly.
     */
    async topTracks(ref: ArtistRef, limit: number): Promise<ArtistTrack[]> {
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

                const usable = (tracks ?? []).filter(track => track?.title?.trim() && track.artist?.trim());
                if (usable.length > 0) return usable.slice(0, limit);
            } catch (error) {
                this.logger.info(`similarity: a plugin could not name records by "${ref.name}" (${plugin.record.id}: ${errorText(error)})`);
            }
        }

        return [];
    }

    /**
     * Hold an answer, evicting the oldest when the map is full.
     *
     * Insertion-ordered eviction rather than least-recently-used, which would need
     * a touch on every read. The distinction cannot matter at this size: the cap is
     * several times a station's whole rotation, so anything evicted has not been
     * asked about in a very long time.
     */
    private remember(key: string, artists: SimilarArtist[]): void {
        if (SimilarityService.cache.size >= SIMILARITY_CACHE_MAX) {
            const oldest = SimilarityService.cache.keys().next();
            if (!oldest.done) SimilarityService.cache.delete(oldest.value);
        }
        SimilarityService.cache.set(key, { at: Date.now(), artists });
    }

    /** Every plugin that can answer right now, in a stable order. */
    private plugins(): SimilarityPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asSimilarityPlugin).sort(byPluginId);
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

/** Highest `match` first. An entry that did not score sorts last rather than as zero. */
const byMatch = (left: SimilarArtist, right: SimilarArtist): number => (right.match ?? -1) - (left.match ?? -1);
