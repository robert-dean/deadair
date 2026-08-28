import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';
import { asCatalogPlugin, type CatalogPlugin } from '#modules/plugins/plugin.capabilities.js';
import { pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { CatalogResolverService } from './catalog.resolver.service.js';
import { resolveSweepMaxPercent, SWEEP_MAX_PERCENT_KEY, type SweepOutcome } from './catalog.sweep.guard.js';
import { serverkitErrorText } from '#modules/shared/error.text.js';
import { PLUGIN_PAGE_SIZE, pluginPages } from '#modules/plugins/plugin.paging.js';

/** What one plugin's walk produced. */
export interface PluginSyncSummary {
    pluginId: string;
    /** Playlists read. They are the enumeration path, never persisted. */
    playlists: number;
    /** Provider items seen, including repeats across playlists. */
    items: number;
    /** Canonical tracks that did not exist before this run. */
    created: number;
    /** Distinct provider tracks bound, i.e. `items` less the repeats. */
    bound: number;
    /** Items that could not become catalog rows, by reason. */
    skipped: number;
    /**
     * What the missing sweep did, or declined to do. `undefined` when it did not run at all, which
     * is every walk that ended early — see {@link CatalogSyncService.syncPlugin}.
     *
     * One field rather than a count beside a refusal, because those are two spellings of the same
     * fact and two spellings of one fact eventually disagree.
     */
    sweep?: SweepOutcome;
    /** Why the walk ended early, if it did. */
    error?: string;
}

/**
 * Fills the local catalog from every plugin that can be browsed.
 *
 * The shape of this is dictated by what a provider will actually tell you.
 * `MusicProviderCatalog` has no "list everything" — the methods are search, get
 * one, list playlists, get a playlist's tracks — so playlists are the only
 * enumeration path there is, and "the catalog" means everything reachable
 * through the connected account's playlists.
 *
 * Nothing about the playlists themselves is written. `deadair.playlists` is for
 * playlists deadair owns; a provider's own are read live and pass through as
 * `CatalogPlaylist` (see `PlaylistsService`). This walks them and keeps the
 * tracks.
 *
 * Everything here is sequential — plugins one at a time, pages one at a time —
 * which is the point rather than an oversight. The upstreams are rate limited,
 * a job has no user waiting on it, and fanning out would spend the plugin's
 * whole rate budget in the first second of an hourly run.
 *
 * Uses `PluginRegistry` and `PluginInvoker` directly rather than
 * `PlaylistsService`: that one calls every plugin concurrently, reads only the
 * first page, and flattens failures into `CatalogSourceError` entries — which
 * would cost this the per-plugin success signal the missing sweep depends on.
 */
@Injectable()
export class CatalogSyncService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly resolver: CatalogResolverService,
        private readonly jobBroker: JobBroker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Walks every catalog-capable plugin, or just one.
     *
     * A plugin that throws is reported and stepped over: one dead upstream must
     * not cost the run every other provider's catalog.
     *
     * @param pluginId - Narrows to a single plugin. Absent means all of them.
     * @param signal - Checked between plugins and between pages, so a shutdown
     *   or a cancellation stops within one page rather than one run.
     */
    async syncAll(pluginId?: string, signal?: AbortSignal): Promise<PluginSyncSummary[]> {
        const candidates = this.catalogPlugins(pluginId);
        if (candidates.length === 0) {
            // Routine, not exceptional: the runner starts before
            // `PluginsModule.ready` initializes plugins, so an early run
            // legitimately sees none.
            this.logger.info('catalog sync found no catalog-capable plugins', { requested: pluginId });
            return [];
        }

        // Read once for the whole run rather than per plugin. `AppConfig` is a live
        // view, so a setting edited between two providers would otherwise judge
        // them by two different rules within one run, and the log would give
        // nobody a way to work out which.
        const maxPercent = resolveSweepMaxPercent(this.config.get(SWEEP_MAX_PERCENT_KEY));

        const summaries: PluginSyncSummary[] = [];
        for (const candidate of candidates) {
            if (signal?.aborted) {
                this.logger.info('catalog sync stopping, cancelled', { remaining: candidates.length - summaries.length });
                break;
            }
            summaries.push(await this.syncPlugin(candidate, maxPercent, signal));
        }

        await this.retryPlaceholders(summaries);
        await this.enrichNewTracks(summaries);
        await this.cacheNewArt(summaries);
        return summaries;
    }

    /**
     * Asks the art sweep to run, on the same "only if this changed something"
     * rule as its two siblings: a walk that created nothing brought in no new
     * cover, and the ten-minute schedule already covers everything else.
     *
     * Best-effort for the same reason, and more so than either of them: art is
     * a nicety, and until it is cached the console simply shows the provider's
     * own URL as it always has.
     */
    private async cacheNewArt(summaries: readonly PluginSyncSummary[]): Promise<void> {
        const created = summaries.reduce((total, summary) => total + summary.created, 0);
        if (created === 0) return;

        try {
            await this.jobBroker.send('catalog.cache_art', {});
        } catch (error) {
            this.logger.warn('could not queue the art cache pass', { error: serverkitErrorText(error), created });
        }
    }

    /**
     * Asks the enrichment walk to run, on the same "only if this changed
     * something" rule as {@link retryPlaceholders} and for the same reason: a
     * track that already exists is either enriched or already queued by the
     * cron, and a run that created nothing has given the walk no new work.
     *
     * Best-effort in the same way, too. The enqueue is not atomic with the rows
     * just written, and enrichment is the least urgent thing this station does:
     * the quarter-hourly schedule picks up anything a failed send missed.
     */
    private async enrichNewTracks(summaries: readonly PluginSyncSummary[]): Promise<void> {
        const created = summaries.reduce((total, summary) => total + summary.created, 0);
        if (created === 0) return;

        try {
            await this.jobBroker.send('catalog.enrich', {});
        } catch (error) {
            this.logger.warn('could not queue the enrichment pass', { error: serverkitErrorText(error), created });
        }
    }

    /**
     * Asks the placeholder pass to run, but only if this walk gave it something
     * new to work with.
     *
     * Unresolved playlist rows can only start resolving when the library gains
     * tracks it did not have, so a run that created none has changed no answer
     * and the pass would re-read the same rows to the same conclusion.
     *
     * Best-effort on purpose. The enqueue is not in a transaction with the rows
     * just written (a plain job's `PgBossConnectionProvider` is the pooled one),
     * so it cannot be atomic with them, and a failure to send is not worth
     * failing a successful sync over: the next run that creates anything sends
     * again, and the placeholders are unharmed by waiting.
     */
    private async retryPlaceholders(summaries: readonly PluginSyncSummary[]): Promise<void> {
        const created = summaries.reduce((total, summary) => total + summary.created, 0);
        if (created === 0) return;

        try {
            await this.jobBroker.send('catalog.resolve_placeholders', {});
        } catch (error) {
            this.logger.warn('could not queue the placeholder pass', { error: serverkitErrorText(error), created });
        }
    }

    /**
     * One plugin's walk: every readable playlist, every page of it, every track
     * ingested, then the sweep for what this plugin stopped offering.
     *
     * The sweep runs only on a clean walk. A walk that threw saw an unknown
     * fraction of the library, and marking everything it missed as missing would
     * turn one failed HTTP page into a catalog-wide outage.
     *
     * **There are three ways a walk is not clean and only two of them announce
     * themselves.** A throw and a cancellation both arrive here as control flow.
     * A walk that ran out of pages does not: `pluginPages` yields its last item
     * and returns like any other, so for as long as this existed a provider that
     * ignores `offset`, or a library past ten thousand items, produced a
     * summary indistinguishable from a complete run and swept everything the cap
     * cut off. That is the third one, and `truncated` is how it gets here.
     */
    private async syncPlugin(candidate: CatalogPlugin, maxPercent: number, signal?: AbortSignal): Promise<PluginSyncSummary> {
        const pluginId = candidate.record.id;
        const summary: PluginSyncSummary = { pluginId, playlists: 0, items: 0, created: 0, bound: 0, skipped: 0 };
        // Provider ids seen this run: both the sweep's input and the guard that
        // keeps one track appearing in three playlists from being ingested three times.
        const seen = new Set<string>();
        // Set by any page walk that stopped at the cap — the playlist list or any
        // one playlist's tracks. One flag for the whole plugin rather than one per
        // generator, because the question it answers is about this walk's evidence
        // as a whole and any single truncation ruins it.
        let truncated = false;
        const onTruncated = () => {
            truncated = true;
        };

        try {
            for await (const playlist of this.playlists(candidate, onTruncated, signal)) {
                summary.playlists++;
                if (!this.isReadable(playlist)) {
                    this.logger.debug('skipping a playlist the account may not read', { plugin: pluginId, playlist: playlist.id });
                    continue;
                }

                for await (const track of this.playlistTracks(candidate, playlist.id, onTruncated, signal)) {
                    summary.items++;
                    if (seen.has(track.id)) continue;
                    seen.add(track.id);
                    await this.ingest(pluginId, track, summary);
                }
            }
        } catch (error) {
            summary.error = serverkitErrorText(error);
            this.logger.warn('catalog sync could not finish a plugin', { plugin: pluginId, error: summary.error, ...this.counts(summary) });
            return summary;
        }

        if (signal?.aborted) {
            // Same reasoning as a throw: a cancelled walk is a partial one, and
            // a partial walk must not be read as "this is the whole library".
            summary.error = 'cancelled';
            return summary;
        }

        if (truncated) {
            // And the same again. `pluginPages` has already said so at `warn`
            // with the plugin and the operation; what is recorded here is the
            // consequence, which is that this run gets no opinion about what the
            // provider stopped offering.
            summary.error = 'truncated';
            this.logger.warn('catalog sync stopped at the page cap, so it will not sweep this plugin', {
                plugin: pluginId,
                ...this.counts(summary),
            });
            return summary;
        }

        const sweep = await this.resolver.markMissing(pluginId, [...seen], maxPercent);
        summary.sweep = sweep;

        if (sweep.kind === 'refused' && sweep.reason === 'too-many') {
            // At `warn` and once, on the bench's rule: the station has just
            // declined to do something it was asked to, and nothing else will
            // mention it. The job turns this into a feed entry as well, because
            // the operator who needs to know is not reading logs.
            this.logger.warn('catalog sync recognised too little of a library to sweep it', {
                plugin: pluginId,
                known: sweep.known,
                unseen: sweep.unseen,
                ...this.counts(summary),
            });
            return summary;
        }

        this.logger.info('catalog sync finished a plugin', {
            plugin: pluginId,
            ...this.counts(summary),
            swept: sweep.kind === 'swept' ? sweep.swept : 0,
        });
        return summary;
    }

    private async ingest(pluginId: string, track: ProviderTrack, summary: PluginSyncSummary): Promise<void> {
        const result = await this.resolver.ingestTrack(pluginId, track);
        if (result.status === 'skipped') {
            summary.skipped++;
            this.logger.debug('skipping an item that cannot become a catalog row', {
                plugin: pluginId,
                external: track.id,
                title: track.title,
                reason: result.reason,
            });
            return;
        }
        summary.bound++;
        if (result.created) summary.created++;
    }

    /** Every playlist the plugin offers, one page at a time. */
    private async *playlists(candidate: CatalogPlugin, onTruncated: () => void, signal?: AbortSignal): AsyncGenerator<ProviderPlaylist> {
        yield* this.pages(
            candidate,
            'catalog.listPlaylists',
            offset => candidate.instance.listPlaylists!({ limit: PLUGIN_PAGE_SIZE, offset }),
            onTruncated,
            signal,
        );
    }

    /** Every track in one playlist, one page at a time. */
    private async *playlistTracks(
        candidate: CatalogPlugin,
        playlistId: string,
        onTruncated: () => void,
        signal?: AbortSignal,
    ): AsyncGenerator<ProviderTrack> {
        yield* this.pages(
            candidate,
            'catalog.getPlaylistTracks',
            offset => candidate.instance.getPlaylistTracks!(playlistId, { limit: PLUGIN_PAGE_SIZE, offset }),
            onTruncated,
            signal,
        );
    }

    /**
     * {@link pluginPages} for this walk: the plugin's id, what an operator loses if it is cut short,
     * and how the caller finds out that it was.
     *
     * `onTruncated` is required here rather than optional as it is on the request, because this walk
     * is the caller that cannot afford to omit it. See {@link syncPlugin}.
     */
    private pages<T>(
        candidate: CatalogPlugin,
        op: string,
        fetch: (offset: number) => Promise<T[]>,
        onTruncated: () => void,
        signal?: AbortSignal,
    ): AsyncGenerator<T> {
        return pluginPages(
            this.pluginInvoker,
            this.logger,
            { pluginId: candidate.record.id, op, incomplete: 'its catalog', onTruncated, signal },
            fetch,
        );
    }

    /**
     * Whether it is worth asking for this playlist's tracks.
     *
     * Absent permissions and empty permissions are different answers, and the
     * SDK is explicit about it: `undefined` means the provider did not say (most
     * of them), while `[]` means it was asked and permits nothing. Only an
     * explicit list that omits `read` is a refusal — treating "did not say" as
     * one would skip every playlist on every provider that has no such concept.
     */
    private isReadable(playlist: ProviderPlaylist): boolean {
        return playlist.permissions === undefined || playlist.permissions.includes('read');
    }

    /** Active, catalog-capable plugins, optionally narrowed to one id. */
    private catalogPlugins(pluginId?: string): CatalogPlugin[] {
        return pluginsWith(pluginId ? [this.pluginRegistry.get(pluginId)] : this.pluginRegistry.list(), asCatalogPlugin);
    }

    private counts(summary: PluginSyncSummary): Record<string, number> {
        return {
            playlists: summary.playlists,
            items: summary.items,
            bound: summary.bound,
            created: summary.created,
            skipped: summary.skipped,
        };
    }
}
