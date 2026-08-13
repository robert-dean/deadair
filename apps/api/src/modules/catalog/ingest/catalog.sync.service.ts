import { Injectable } from 'injectkit';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';
import { asCatalogPlugin, type CatalogPlugin } from '#modules/plugins/plugin.capabilities.js';
import { pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { CatalogResolverService } from './catalog.resolver.service.js';
import { serverkitErrorText } from '#modules/shared/error.text.js';

/**
 * Items per page. Spotify caps playlist reads at 50 and clamps anything larger,
 * so asking for more buys nothing and makes the offsets lie.
 */
const PAGE_SIZE = 50;

/**
 * Pages one plugin may serve before the walk gives up on it.
 *
 * Termination here depends on the provider honouring `offset`, which is a
 * promise made by code the host does not own. A provider that ignores it
 * returns page one forever, and this walk would never end on its own.
 * 200 pages is 10,000 items per list — far past any real library, and finite.
 */
const MAX_PAGES = 200;

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
    /** Bindings newly marked missing. `undefined` when the sweep did not run. */
    swept?: number;
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

        const summaries: PluginSyncSummary[] = [];
        for (const candidate of candidates) {
            if (signal?.aborted) {
                this.logger.info('catalog sync stopping, cancelled', { remaining: candidates.length - summaries.length });
                break;
            }
            summaries.push(await this.syncPlugin(candidate, signal));
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
     */
    private async syncPlugin(candidate: CatalogPlugin, signal?: AbortSignal): Promise<PluginSyncSummary> {
        const pluginId = candidate.record.id;
        const summary: PluginSyncSummary = { pluginId, playlists: 0, items: 0, created: 0, bound: 0, skipped: 0 };
        // Provider ids seen this run: both the sweep's input and the guard that
        // keeps one track appearing in three playlists from being ingested three times.
        const seen = new Set<string>();

        try {
            for await (const playlist of this.playlists(candidate, signal)) {
                summary.playlists++;
                if (!this.isReadable(playlist)) {
                    this.logger.debug('skipping a playlist the account may not read', { plugin: pluginId, playlist: playlist.id });
                    continue;
                }

                for await (const track of this.playlistTracks(candidate, playlist.id, signal)) {
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

        summary.swept = await this.resolver.markMissing(pluginId, [...seen]);
        this.logger.info('catalog sync finished a plugin', { plugin: pluginId, ...this.counts(summary), swept: summary.swept });
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
    private async *playlists(candidate: CatalogPlugin, signal?: AbortSignal): AsyncGenerator<ProviderPlaylist> {
        yield* this.pages(candidate, 'catalog.listPlaylists', offset => candidate.instance.listPlaylists!({ limit: PAGE_SIZE, offset }), signal);
    }

    /** Every track in one playlist, one page at a time. */
    private async *playlistTracks(candidate: CatalogPlugin, playlistId: string, signal?: AbortSignal): AsyncGenerator<ProviderTrack> {
        yield* this.pages(
            candidate,
            'catalog.getPlaylistTracks',
            offset => candidate.instance.getPlaylistTracks!(playlistId, { limit: PAGE_SIZE, offset }),
            signal,
        );
    }

    /**
     * Offset pagination over a plugin call, stopping at the first short page.
     *
     * Every call goes through `PluginInvoker`, which is what keeps a hanging
     * plugin from becoming a hanging job: the deadline and the failure breaker
     * both apply per page.
     *
     * A short page means the end. A full page that yields nothing new would
     * still advance the offset, so the only way this does not terminate is a
     * provider that ignores `offset` entirely — which {@link MAX_PAGES} covers,
     * loudly, because silently truncating a library would look exactly like a
     * successful sync.
     */
    private async *pages<T>(candidate: CatalogPlugin, op: string, fetch: (offset: number) => Promise<T[]>, signal?: AbortSignal): AsyncGenerator<T> {
        const pluginId = candidate.record.id;

        for (let page = 0; page < MAX_PAGES; page++) {
            if (signal?.aborted) return;

            const items = await this.pluginInvoker.invoke(pluginId, op, async () => fetch(page * PAGE_SIZE));
            for (const item of items) yield item;
            if (items.length < PAGE_SIZE) return;
        }

        this.logger.warn('stopped paging a plugin at the page cap; its catalog may be incomplete', { plugin: pluginId, op, cap: MAX_PAGES });
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
