import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PLUGIN_CAPABILITY_CATALOG, type MusicProviderPluginInstance, type PluginManifest } from '@deadair/plugin-sdk';
import { AccessControlService, isAllVisible } from '#modules/permissions/access.control.service.js';
import { asCatalogPlugin, implementsCatalog } from '#modules/plugins/plugin.capabilities.js';
import { pluginHttpError } from '#modules/plugins/plugin.error.http.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import type { PluginRecord } from '#modules/plugins/types/plugin.record.js';
import type { CatalogPlaylist, CatalogPlaylistPage, CatalogPlaylistTracks, CatalogSourceError, CatalogTrack } from './types/playlists.types.js';

/**
 * A `ServerkitError`'s `message` is the bare status text ("Forbidden") and the
 * useful sentence lives in `details.message`.
 */
const errorText = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error);
    const details = (error as { details?: Record<string, unknown> }).details;
    const detail = details?.message;
    return typeof detail === 'string' && detail.length > 0 ? detail : error.message;
};

/**
 * Why a plugin that declares a catalog cannot be asked for one right now, or
 * `undefined` when its state is not something to report.
 *
 * The messages name the operator's next move rather than the internal state: a
 * quarantined plugin is cleared by a reload, a misconfigured one by fixing its
 * settings, and a plugin that declares a capability it does not implement is
 * its author's bug and nothing the operator can do anything about.
 */
const unavailableReason = (record: PluginRecord): string | undefined => {
    const detail = record.error ? `: ${record.error}` : '';
    switch (record.status) {
        case 'failed':
            return `quarantined after a failure${detail}. Reload the plugin once the cause is fixed`;
        case 'misconfigured':
            return `its configuration is not valid${detail}`;
        case 'active':
            // Active, but `asCatalogPlugin` still refused it: it declares `catalog`
            // and does not implement the methods.
            return 'it declares a catalog but does not implement one, so it cannot be asked for playlists';
        default:
            // `discovered` and `disabled`: never turned on, so not a fault.
            return undefined;
    }
};

/**
 * The read-only, no-database POC surface for "what could I import from a
 * plugin": every catalog-capable plugin's playlists, aggregated, and one
 * plugin's playlist tracks on demand.
 *
 * Nothing here is persisted; every answer is a live call through
 * {@link PluginInvoker}, which is what keeps a slow or crashing plugin from
 * becoming a slow or crashing request.
 */
@Injectable()
export class PlaylistsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly accessControl: AccessControlService,
        private readonly logger: Logger,
    ) {}

    /**
     * One page aggregating every catalog-capable plugin's playlists.
     *
     * Plugins are called concurrently and settled independently: one plugin
     * throwing (a dead upstream, an expired token) must not take the whole
     * aggregated list down with it, so its failure is reported alongside the
     * others' successes rather than propagated.
     */
    async listPlaylists(): Promise<CatalogPlaylistPage> {
        const { usable: candidates, unavailable } = await this.catalogCapablePlugins();

        const settled = await Promise.allSettled(
            candidates.map(async ({ record, manifest }) => {
                const playlists = await this.pluginInvoker.invoke(record.id, 'catalog.listPlaylists', async () =>
                    (record.instance as MusicProviderPluginInstance).listPlaylists!(),
                );
                return { manifest, playlists };
            }),
        );

        const playlists: CatalogPlaylist[] = [];
        // Seeded with the plugins that could not even be called. A source the operator
        // turned on and which is not working is the single most useful thing this page
        // can say, and dropping it silently leaves an empty list whose only explanation
        // is the empty state's advice to enable a plugin that IS already enabled.
        const errors: CatalogSourceError[] = [...unavailable];

        settled.forEach((outcome, index) => {
            const { record, manifest } = candidates[index]!;
            if (outcome.status === 'fulfilled') {
                for (const playlist of outcome.value.playlists) {
                    playlists.push({
                        pluginId: record.id,
                        pluginName: manifest.name,
                        id: playlist.id,
                        name: playlist.name,
                        description: playlist.description,
                        trackCount: playlist.trackCount,
                        artworkUrl: playlist.artworkUrl,
                        permissions: playlist.permissions,
                    });
                }
                return;
            }

            const message = errorText(outcome.reason);
            this.logger.warn('catalog plugin could not list playlists', { plugin: record.id, error: message });
            errors.push({ pluginId: record.id, pluginName: manifest.name, message });
        });

        return { playlists, errors };
    }

    /**
     * @throws 403 when the actor may not view this plugin, 404 when the plugin
     *   is not installed, 501 when it does not declare/implement `catalog`,
     *   503 when it is installed but not currently active. Otherwise whatever
     *   {@link pluginHttpError} makes of a thrown `PluginError`
     *   (429/500/502/503/504): here a plugin failure IS the answer, so it
     *   propagates rather than being collected.
     */
    async getPlaylistTracks(pluginId: string, playlistId: string): Promise<CatalogPlaylistTracks> {
        const { record } = await this.requireCatalogCapable(pluginId);
        const instance = record.instance as MusicProviderPluginInstance;

        let tracks: readonly {
            id: string;
            title: string;
            artists: string[];
            album?: string;
            durationMs?: number;
            isrc?: string;
            artworkUrl?: string;
        }[];
        try {
            tracks = await this.pluginInvoker.invoke(pluginId, 'catalog.getPlaylistTracks', async () => instance.getPlaylistTracks!(playlistId));
        } catch (error) {
            throw pluginHttpError(pluginId, error);
        }

        return {
            pluginId,
            playlistId,
            tracks: tracks.map((track): CatalogTrack => ({
                id: track.id,
                title: track.title,
                artists: track.artists,
                album: track.album,
                durationMs: track.durationMs,
                isrc: track.isrc,
                artworkUrl: track.artworkUrl,
            })),
        };
    }

    /**
     * The visible-to-the-actor plugins that declare a catalog, split into the
     * ones that can be called and the ones that cannot.
     *
     * Visibility is narrowed exactly like {@link PluginsService.listPlugins}:
     * `{ all: true }` skips the filter for actors whose role already covers
     * every plugin.
     *
     * The split is what keeps a broken source from disappearing. `unavailable`
     * deliberately covers only the states the operator has already asked to be
     * working — quarantined, misconfigured, or declaring a capability it does
     * not implement. A `discovered` or `disabled` plugin is not reported: it was
     * never turned on, so calling that an error would put a permanent warning on
     * the page for a choice the operator made.
     *
     * A record with no manifest is skipped entirely, however it failed: without
     * one there is no way to know it was ever a catalog, and attributing an
     * enrichment plugin's failure to this page would be worse than silence.
     */
    private async catalogCapablePlugins(): Promise<{
        usable: { record: PluginRecord; manifest: PluginManifest }[];
        unavailable: CatalogSourceError[];
    }> {
        const visible = await this.accessControl.listVisibleIds('plugin', 'view');
        const records = this.pluginRegistry.list();
        let narrowed = records;
        if (!isAllVisible(visible)) {
            const visibleIds = new Set(visible.ids);
            narrowed = records.filter(record => visibleIds.has(record.id));
        }

        const usable: { record: PluginRecord; manifest: PluginManifest }[] = [];
        const unavailable: CatalogSourceError[] = [];

        for (const record of narrowed) {
            const catalog = asCatalogPlugin(record);
            if (catalog) {
                usable.push({ record, manifest: catalog.manifest });
                continue;
            }

            const manifest = record.manifest;
            if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_CATALOG)) continue;

            const reason = unavailableReason(record);
            if (reason) unavailable.push({ pluginId: record.id, pluginName: manifest.name, message: reason });
        }

        return { usable, unavailable };
    }

    /**
     * Narrows on top of the route policy's authentication floor, the same way
     * {@link PluginsService.getPlugin} does: the per-object `plugin:view`
     * check runs before the registry lookup, so an actor who cannot see this
     * plugin gets an identical 403 whether or not it is installed. Checking
     * after the lookup would leak the installed set through the difference
     * between 403, 404, 501 and 503.
     *
     * `listPlaylists` filters with `listVisibleIds` instead of this; that is
     * the same permission reached from the other direction, and a list must
     * omit rather than reject.
     *
     * @throws 403 not visible to the actor, 404 unknown id, 501 no catalog
     *   capability, 503 installed but not active.
     */
    private async requireCatalogCapable(pluginId: string): Promise<{ record: PluginRecord; manifest: PluginManifest }> {
        await this.accessControl.require({ namespace: 'plugin', id: pluginId }, 'view');

        const record = this.pluginRegistry.get(pluginId);
        if (!record) throw httpError(404).withDetails({ message: `plugin "${pluginId}" is not installed` });

        const manifest = record.manifest;
        if (!manifest || !manifest.capabilities.includes(PLUGIN_CAPABILITY_CATALOG)) {
            throw httpError(501).withDetails({ message: `plugin "${pluginId}" does not support a catalog` });
        }

        if (record.status !== 'active' || !record.instance) {
            const reason = record.error ? `: ${record.error}` : '';
            throw httpError(503).withDetails({ message: `plugin "${pluginId}" is not running (status: ${record.status})${reason}` });
        }

        if (!implementsCatalog(manifest, record.instance)) {
            throw httpError(501).withDetails({ message: `plugin "${pluginId}" declares a catalog but does not implement it` });
        }

        return { record, manifest };
    }
}
