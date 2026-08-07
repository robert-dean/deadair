import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { asStreamPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { TrackResolver } from '../playout.capability.js';
import type { RundownItem } from '../rundown.js';

/**
 * The generic path: ask the plugin that owns the track for a stream URL.
 *
 * Every source answers here, including the ones that cannot mint a URL of their
 * own: Spotify's audio is encrypted on the CDN, so its plugin lends a login to
 * the shim beside Liquidsoap and returns the URL that comes back. Which is the
 * point — where the audio comes from is the provider's business, and this asks
 * the same question of all of them.
 *
 * `resolveStreamUrl` stays optional in the SDK because a "steer only" provider
 * plays its own audio and hands over nothing at all. One without it declines
 * here, and its items are skipped rather than aired as silence.
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
        const plugin = record ? asStreamPlugin(record) : undefined;
        if (!plugin) return undefined;

        const instance = plugin.instance;
        if (typeof instance.resolveStreamUrl !== 'function') return undefined;

        try {
            const stream = await this.invoker.invoke(item.pluginId, 'stream.resolveStreamUrl', async () =>
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
