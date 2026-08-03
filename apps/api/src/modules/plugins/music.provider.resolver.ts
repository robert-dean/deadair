import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { httpError } from '@maroonedsoftware/errors';
import {
    PLUGIN_CAPABILITY_CATALOG,
    PLUGIN_CAPABILITY_OAUTH,
    PLUGIN_CAPABILITY_PLAYOUT,
    type MusicProviderCatalog,
    type MusicProviderOAuth,
    type MusicProviderPlayout,
    type MusicProviderPluginInstance,
    type PluginManifest,
} from '@deadair/plugin-sdk';
import { DB } from '../data/db.js';
import { PluginInvoker } from './plugin.invoker.js';
import { PluginRegistry } from './plugin.registry.js';

/** `deadair.settings` key holding the plugin id of the station's music provider. */
export const MUSIC_PROVIDER_SETTING_KEY = 'music.provider';

/**
 * The station's active music provider, as the rest of the app sees it.
 *
 * The capability surfaces are host-owned wrappers, never the plugin's own
 * object: every method on them goes through {@link PluginInvoker}, so a caller
 * cannot accidentally hand the process to third-party code with no timeout.
 */
export interface ActiveMusicProvider {
    pluginId: string;
    manifest: PluginManifest;
    /** Present when the provider declares and implements `catalog`. */
    catalog?: MusicProviderCatalog;
    /** Present when the provider declares and implements `playout`. */
    playout?: MusicProviderPlayout;
    /** Present when the provider declares and implements `oauth`. */
    oauth?: MusicProviderOAuth;
}

/**
 * Resolves "the music provider" to a live, wrapped instance.
 *
 * This is the seam that keeps vendor names out of the application: domain code
 * asks for a catalog, not for Spotify. Which plugin that is comes from one
 * station setting, so changing provider is a settings write rather than a code
 * change.
 */
@Injectable()
export class MusicProviderResolver {
    constructor(
        private readonly db: Kysely<DB>,
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
    ) {}

    /** The configured provider's plugin id, or `undefined` when the station has not chosen one. */
    async getSelectedPluginId(): Promise<string | undefined> {
        const row = await this.db.selectFrom('deadair.settings').select('value').where('key', '=', MUSIC_PROVIDER_SETTING_KEY).executeTakeFirst();
        const value = row?.value?.trim();
        return value ? value : undefined;
    }

    /**
     * The active provider.
     *
     * @throws 409 when no provider is selected or the selected one is not
     *   installed, and 503 when it is installed but not currently active.
     */
    async resolve(): Promise<ActiveMusicProvider> {
        const pluginId = await this.getSelectedPluginId();
        if (pluginId === undefined) {
            throw httpError(409).withDetails({
                message: `no music provider is selected; set the "${MUSIC_PROVIDER_SETTING_KEY}" setting to a plugin id`,
            });
        }

        const record = this.pluginRegistry.get(pluginId);
        if (!record) {
            throw httpError(409).withDetails({ message: `music provider "${pluginId}" is not installed` });
        }
        if (record.status !== 'active' || !record.instance || !record.manifest) {
            const reason = record.error ? `: ${record.error}` : '';
            throw httpError(503).withDetails({ message: `music provider "${pluginId}" is not active (status: ${record.status})${reason}` });
        }

        const manifest = record.manifest;
        const instance = record.instance as MusicProviderPluginInstance;

        return {
            pluginId,
            manifest,
            catalog: this.wrapCatalog(pluginId, manifest, instance),
            playout: this.wrapPlayout(pluginId, manifest, instance),
            oauth: this.wrapOAuth(pluginId, manifest, instance),
        };
    }

    /** Like {@link MusicProviderResolver.resolve}, but `undefined` instead of throwing. */
    async tryResolve(): Promise<ActiveMusicProvider | undefined> {
        try {
            return await this.resolve();
        } catch {
            return undefined;
        }
    }

    /** @throws 501 when the active provider cannot be searched or browsed. */
    async requireCatalog(): Promise<MusicProviderCatalog> {
        const provider = await this.resolve();
        if (!provider.catalog) {
            throw httpError(501).withDetails({ message: `music provider "${provider.pluginId}" does not provide a catalog` });
        }
        return provider.catalog;
    }

    /** @throws 501 when the active provider does not own its own audio output. */
    async requirePlayout(): Promise<MusicProviderPlayout> {
        const provider = await this.resolve();
        if (!provider.playout) {
            throw httpError(501).withDetails({ message: `music provider "${provider.pluginId}" does not provide playout` });
        }
        return provider.playout;
    }

    /** @throws 501 when the active provider has no authorisation flow. */
    async requireOAuth(): Promise<MusicProviderOAuth> {
        const provider = await this.resolve();
        if (!provider.oauth) {
            throw httpError(501).withDetails({ message: `music provider "${provider.pluginId}" does not support OAuth` });
        }
        return provider.oauth;
    }

    /**
     * A capability counts as present only when the manifest declares it AND the
     * instance actually implements every method of it. A manifest is a promise,
     * and calling a method a plugin forgot to write is a `TypeError` in the
     * middle of a request rather than an honest "not supported".
     */
    private implements(manifest: PluginManifest, capability: string, instance: MusicProviderPluginInstance, methods: readonly string[]): boolean {
        if (!manifest.capabilities.includes(capability)) return false;
        return methods.every(method => typeof (instance as unknown as Record<string, unknown>)[method] === 'function');
    }

    private wrapCatalog(pluginId: string, manifest: PluginManifest, instance: MusicProviderPluginInstance): MusicProviderCatalog | undefined {
        const methods = ['searchTracks', 'getTrack', 'listPlaylists', 'getPlaylistTracks'] as const;
        if (!this.implements(manifest, PLUGIN_CAPABILITY_CATALOG, instance, methods)) return undefined;

        const catalog: MusicProviderCatalog = {
            searchTracks: (query, options) =>
                this.pluginInvoker.invoke(pluginId, 'catalog.searchTracks', async () => instance.searchTracks!(query, options)),
            getTrack: trackId => this.pluginInvoker.invoke(pluginId, 'catalog.getTrack', async () => instance.getTrack!(trackId)),
            listPlaylists: options => this.pluginInvoker.invoke(pluginId, 'catalog.listPlaylists', async () => instance.listPlaylists!(options)),
            getPlaylistTracks: (playlistId, options) =>
                this.pluginInvoker.invoke(pluginId, 'catalog.getPlaylistTracks', async () => instance.getPlaylistTracks!(playlistId, options)),
        };

        // Optional even within the capability: a steer-only provider plays audio
        // itself and never hands out a URL.
        if (typeof instance.resolveStreamUrl === 'function') {
            catalog.resolveStreamUrl = trackId =>
                this.pluginInvoker.invoke(pluginId, 'catalog.resolveStreamUrl', async () => instance.resolveStreamUrl!(trackId));
        }

        return catalog;
    }

    private wrapPlayout(pluginId: string, manifest: PluginManifest, instance: MusicProviderPluginInstance): MusicProviderPlayout | undefined {
        const methods = ['enqueue', 'play', 'pause', 'skip', 'getPlaybackState'] as const;
        if (!this.implements(manifest, PLUGIN_CAPABILITY_PLAYOUT, instance, methods)) return undefined;

        return {
            enqueue: trackIds => this.pluginInvoker.invoke(pluginId, 'playout.enqueue', async () => instance.enqueue!(trackIds)),
            play: trackId => this.pluginInvoker.invoke(pluginId, 'playout.play', async () => instance.play!(trackId)),
            pause: () => this.pluginInvoker.invoke(pluginId, 'playout.pause', async () => instance.pause!()),
            skip: () => this.pluginInvoker.invoke(pluginId, 'playout.skip', async () => instance.skip!()),
            getPlaybackState: () => this.pluginInvoker.invoke(pluginId, 'playout.getPlaybackState', async () => instance.getPlaybackState!()),
        };
    }

    private wrapOAuth(pluginId: string, manifest: PluginManifest, instance: MusicProviderPluginInstance): MusicProviderOAuth | undefined {
        const methods = ['getAuthorizeUrl', 'handleCallback'] as const;
        if (!this.implements(manifest, PLUGIN_CAPABILITY_OAUTH, instance, methods)) return undefined;

        return {
            getAuthorizeUrl: state => this.pluginInvoker.invoke(pluginId, 'oauth.getAuthorizeUrl', async () => instance.getAuthorizeUrl!(state)),
            handleCallback: params => this.pluginInvoker.invoke(pluginId, 'oauth.handleCallback', async () => instance.handleCallback!(params)),
        };
    }
}
