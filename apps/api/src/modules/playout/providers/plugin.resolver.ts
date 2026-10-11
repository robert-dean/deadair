import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { isPluginError } from '@deadair/plugin-sdk';
import { asStreamPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { TrackResolver } from '../playout.capability.js';
import type { RundownItem } from '../rundown.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The provider refused for a reason that belongs to the ACCOUNT, not to the record it was asked about.
 *
 * `unavailable` and `rate_limited` are the two codes that say so: the account is busy streaming somewhere
 * else, its quota is spent, the host's own rate bucket is empty, or the plugin was disposed mid-call by a
 * settings save. Every one of those answers differently a few minutes later and says nothing about this
 * copy, so the caller backs off without counting it toward writing the copy off. Otherwise one hour
 * of a shared account playing on somebody's phone would bench every record the station asked for in
 * that hour, and the hourly sync would un-bench them only to have them benched again.
 *
 * Thrown rather than returned as `undefined`, because `undefined` already means "no URL for this
 * binding", which is a fact about the record.
 */
export class ProviderBusy extends Error {
    constructor(
        readonly pluginId: string,
        readonly reason: string,
        /** What the provider asked for, when it said. The caller's own backoff applies otherwise. */
        readonly retryAfterMs?: number,
    ) {
        super(`the provider is busy: ${reason}`);
        this.name = 'ProviderBusy';
    }
}

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
        return this.resolveBinding(item.pluginId, item.externalId);
    }

    /**
     * The same question, asked about a binding rather than about a rundown item.
     *
     * Split out because a second caller wants it and is not the transport: the
     * analysis walk needs audio for a catalog track, and everything above reads
     * only these two fields anyway. A caller that had to build a `RundownItem`
     * to ask would be inventing an id, a title and an artist list for something
     * that will never be handed to a player, and the next person to read it
     * would reasonably wonder what running order it belonged to.
     *
     * `pluginId` + `externalId` is the key of `deadair.track_sources`, so this is
     * the natural shape of the question in the first place.
     *
     * Throws {@link ProviderBusy} for an account-wide refusal, and answers `undefined` for every other
     * failure.
     */
    async resolveBinding(pluginId: string, externalId: string): Promise<string | undefined> {
        const record = this.registry.get(pluginId);
        const plugin = record ? asStreamPlugin(record) : undefined;
        if (!plugin) return undefined;

        const instance = plugin.instance;
        if (typeof instance.resolveStreamUrl !== 'function') return undefined;

        try {
            const stream = await this.invoker.invoke(pluginId, 'stream.resolveStreamUrl', async () => instance.resolveStreamUrl!(externalId));
            return stream?.url;
        } catch (error) {
            if (isPluginError(error) && (error.code === 'unavailable' || error.code === 'rate_limited')) {
                throw new ProviderBusy(pluginId, errorText(error), error.retryAfterMs);
            }

            // One item's worth of failure. Returning undefined lets the next resolver
            // try, and a track nothing can resolve is skipped rather than aired as silence.
            this.logger.warn('playout: plugin could not resolve a stream url', {
                plugin: pluginId,
                track: externalId,
                error: errorText(error),
            });
            return undefined;
        }
    }
}
