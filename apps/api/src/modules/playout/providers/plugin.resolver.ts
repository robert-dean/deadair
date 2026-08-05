import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { MusicProviderPluginInstance } from '@deadair/plugin-sdk';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { TrackResolver } from '../playout.capability.js';
import type { RundownItem } from '../rundown.js';

/**
 * The generic path: ask the plugin that owns the track for a stream URL.
 *
 * `resolveStreamUrl` is optional in the SDK precisely because not every provider
 * has one — a "steer only" provider plays its own audio and never hands out a
 * URL — so a plugin without it simply declines here and a built-in resolver gets
 * its turn. Any future serve-capable plugin (a local library, a Subsonic server)
 * needs nothing but this.
 *
 * Goes through {@link PluginInvoker} like every other call into plugin code, so
 * a provider that hangs costs one item rather than the running order.
 */
@Injectable()
export class PluginTrackResolver extends TrackResolver {
    constructor(
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        private readonly logger: Logger,
    ) {
        super();
    }

    async resolve(item: RundownItem): Promise<string | undefined> {
        const record = this.registry.get(item.pluginId);
        if (!record || record.status !== 'active' || !record.instance) return undefined;

        const instance = record.instance as MusicProviderPluginInstance;
        if (typeof instance.resolveStreamUrl !== 'function') return undefined;

        try {
            const stream = await this.invoker.invoke(item.pluginId, 'catalog.resolveStreamUrl', async () =>
                instance.resolveStreamUrl!(item.externalId),
            );
            return stream?.url;
        } catch (error) {
            // One item's worth of failure. Returning undefined lets the next resolver
            // try, and a track nothing can resolve is skipped rather than aired as silence.
            this.logger.warn('playout: plugin could not resolve a stream url', {
                plugin: item.pluginId,
                track: item.externalId,
                error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
    }
}
