import { Injectable } from 'injectkit';
import { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { TrackAudioRepository } from '../audio/track.audio.repository.js';
import { trackCacheEnabled } from '../audio/track.cache.settings.js';
import { TrackResolver } from '../playout.capability.js';
import { trackAudioUrl } from '../playout.urls.js';
import type { RundownItem } from '../rundown.js';

/**
 * The station's own copy of a record, when it has one — and the thing that asks for one when it does
 * not.
 *
 * FIRST in {@link CompositeTrackResolver}, ahead of the provider, which is the whole of what makes
 * the cache take effect: a hit is a URL on this machine, and a miss falls straight through to the
 * plugin resolver so the record plays exactly as it did before.
 *
 * Unlike the other two links it does not guard on `pluginId`. It answers for any binding the catalog
 * knows, because "do we have this on disk" is a question about the file rather than about who served
 * it, and a station that swapped providers for the same record still holds the same audio.
 *
 * ## Why the fetch is queued from here
 *
 * Because a boundary is the only moment the station is known to want a record. There is no walk: a
 * job is sent on a miss, this returns `undefined`, and the play it was asked about is unaffected. The
 * download the job then does is a SECOND fetch of the same binding, not a tee of the one Liquidsoap
 * is doing — see {@link TrackCacheService} — so the first play of a record costs two downloads and
 * every play after it costs none.
 *
 * Sending is cheap and sending twice is free: the job claims the row before it fetches. So this does
 * not wait for the send, and a failed send is one download not saved rather than an item lost.
 */
@Injectable()
export class CachedTrackResolver extends TrackResolver {
    constructor(
        // The ROOT container, for the reason SegmentTrackResolver spells out: this is a singleton
        // reached from the pusher's loop, from a job and from a request, so it opens its own scope
        // rather than borrowing whichever one happened to build it.
        private readonly container: Container,
        private readonly config: AppConfig,
        private readonly baseUrl: string,
        private readonly logger: Logger,
    ) {
        super();
    }

    async resolve(item: RundownItem): Promise<string | undefined> {
        return this.resolveBinding(item.pluginId, item.externalId, { queueOnMiss: true });
    }

    /**
     * The same question asked about a binding rather than about a rundown item, for the same reason
     * `PluginTrackResolver.resolveBinding` exists: the measurement walk wants audio for a catalog
     * track and has no running order to invent an item from.
     *
     * `queueOnMiss` is what keeps the walk from filling the cache. A miss there means the station has
     * never played the record, and downloading it because something wanted to MEASURE it would be the
     * walk-shaped fill this was deliberately not built as. The transport passes `true` because a miss
     * there is the station playing a record it does not hold, which is exactly when a copy is worth
     * fetching.
     */
    async resolveBinding(pluginId: string, externalId: string, options: { queueOnMiss?: boolean } = {}): Promise<string | undefined> {
        // The whole of "off": no serve, no fill, not even a read. The composite falls through to the
        // provider and the station behaves exactly as it did before there was a cache.
        if (!trackCacheEnabled(this.config)) return undefined;

        const scope = this.container.createScopedContainer();
        try {
            const binding = await scope.get(TrackAudioRepository).findByBinding(pluginId, externalId);

            // A segment, or a binding the catalog does not hold. Neither is ours: there is no
            // `track_sources` row to cache against, and the next link answers for both.
            if (binding === undefined) return undefined;

            if (binding.checksum !== undefined) return trackAudioUrl(this.baseUrl, binding.sourceId);

            // A miss, and worth asking about: no bytes, and any backoff from an earlier refusal has
            // expired. Not awaited for its outcome beyond the send itself — the record is about to
            // play through the provider either way.
            if (options.queueOnMiss === true && binding.dueForFetch) {
                await scope.get(JobBroker).send('playout.cache_track', { pluginId, externalId });
            }

            return undefined;
        } catch (error) {
            // One item's worth of failure, handled the way the other two links handle their own.
            // Declining costs nothing here: the provider answers next, so the record still plays.
            this.logger.warn('playout: could not check for a local copy of a record', {
                plugin: pluginId,
                track: externalId,
                error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        } finally {
            await scope.disposeAsync();
        }
    }
}
