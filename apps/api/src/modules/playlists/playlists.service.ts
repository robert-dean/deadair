import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PLUGIN_CAPABILITY_CATALOG, type MusicProviderPluginInstance, type PluginManifest } from '@deadair/plugin-sdk';
import { AccessControlService, isAllVisible } from '#modules/permissions/access.control.service.js';
import { pluginHttpError } from '#modules/plugins/plugin.error.http.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import type { PluginRecord } from '#modules/plugins/types/plugin.record.js';
import type { CatalogPlaylist, CatalogPlaylistPage, CatalogPlaylistTracks, CatalogSourceError, CatalogTrack } from './types/playlists.types.js';

const CATALOG_METHODS = ['listPlaylists', 'getPlaylistTracks'] as const;

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
        const candidates = await this.catalogCapablePlugins();

        const settled = await Promise.allSettled(
            candidates.map(async ({ record, manifest }) => {
                const playlists = await this.pluginInvoker.invoke(record.id, 'catalog.listPlaylists', async () =>
                    (record.instance as MusicProviderPluginInstance).listPlaylists!(),
                );
                return { manifest, playlists };
            }),
        );

        const playlists: CatalogPlaylist[] = [];
        const errors: CatalogSourceError[] = [];

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

        let tracks: readonly { id: string; title: string; artists: string[]; album?: string; durationMs?: number; isrc?: string; artworkUrl?: string }[];
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
     * Active, catalog-capable, visible-to-the-actor plugin records, narrowed
     * exactly like {@link PluginsService.listPlugins}: `{ all: true }` skips
     * the filter for actors whose role already covers every plugin.
     */
    private async catalogCapablePlugins(): Promise<{ record: PluginRecord; manifest: PluginManifest }[]> {
        const visible = await this.accessControl.listVisibleIds('plugin', 'view');
        const records = this.pluginRegistry.list();
        let narrowed = records;
        if (!isAllVisible(visible)) {
            const visibleIds = new Set(visible.ids);
            narrowed = records.filter(record => visibleIds.has(record.id));
        }

        const result: { record: PluginRecord; manifest: PluginManifest }[] = [];
        for (const record of narrowed) {
            if (record.status !== 'active' || !record.manifest || !record.instance) continue;
            if (!this.implementsCatalog(record.manifest, record.instance)) continue;
            result.push({ record, manifest: record.manifest });
        }
        return result;
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

        if (!this.implementsCatalog(manifest, record.instance)) {
            throw httpError(501).withDetails({ message: `plugin "${pluginId}" declares a catalog but does not implement it` });
        }

        return { record, manifest };
    }

    /**
     * A capability counts as present only when the manifest declares it AND
     * the instance actually implements every method of it. A manifest is a
     * promise, and calling a method a plugin forgot to write is a
     * `TypeError` in the middle of a request rather than an honest "not
     * supported".
     */
    private implementsCatalog(manifest: PluginManifest, instance: unknown): boolean {
        if (!manifest.capabilities.includes(PLUGIN_CAPABILITY_CATALOG)) return false;
        return CATALOG_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
    }
}
