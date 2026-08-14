import { Injectable } from 'injectkit';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TrackAudioRepository } from '../audio/track.audio.repository.js';
import { TrackResolver } from '../playout.capability.js';
import { trackAudioUrl } from '../playout.urls.js';
import type { RundownItem } from '../rundown.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';

/**
 * Every record, as a URL on this machine.
 *
 * FIRST in {@link CompositeTrackResolver}, and the only link that answers for a catalog track: the
 * player is handed `/playout/audio/{sourceId}` whether or not the station already holds the bytes,
 * because the route behind it fetches them if it does not (see {@link TrackAudioService}). That is the
 * whole of this design — **the player never sees a provider URL** — and it is what makes the address a
 * provider minted the app's business alone.
 *
 * What it replaced was a link that answered only for records already on disk and fell through to the
 * provider otherwise. That fork was two paths for the same item, and it leaked: a provider URL is
 * fetchable only from where it was minted for, so which link answered decided whether the URL worked,
 * silently, per deployment.
 *
 * ## Why it guards on the catalog rather than on the cache
 *
 * `playable and missing_at is null`: whether the bytes are local is no longer a question worth asking
 * here, but whether the catalog still believes this copy can be served is. Declining lets
 * `Rundown.next` skip to the following item, which is the right outcome for a binding the provider has
 * dropped — and it is the seam a bench written onto `missing_at` acts through.
 */
@Injectable()
export class TrackAudioResolver extends TrackResolver {
    constructor(
        // The ROOT container, for the reason SegmentTrackResolver spells out: this is a singleton
        // reached from the pusher's loop, from a job and from a request, so it opens its own scope
        // rather than borrowing whichever one happened to build it.
        private readonly container: Container,
        private readonly baseUrl: string,
        private readonly logger: Logger,
    ) {
        super();
    }

    async resolve(item: RundownItem): Promise<string | undefined> {
        return this.resolveBinding(item.pluginId, item.externalId);
    }

    /**
     * The same question asked about a binding rather than a rundown item.
     *
     * Exists for the reason `PluginTrackResolver.resolveBinding` does: the measurement walk wants audio
     * for a catalog track and has no running order to invent an item from. It gets the same URL the
     * player gets, which is now self-sufficient — the analyzer's own fetch of it pulls the record from
     * the provider if the station has not got it yet, so there is nothing for that caller to fall back
     * to any more.
     */
    async resolveBinding(pluginId: string, externalId: string): Promise<string | undefined> {
        try {
            return await inScope(this.container, async scope => {
                const sourceId = await scope.get(TrackAudioRepository).findPlayableSourceId(pluginId, externalId);

                // A segment (its `externalId` is a segment id, which is no binding), or a copy the catalog
                // has written off. The next link answers for the first and nothing answers for the second,
                // which is what skips it.
                if (sourceId === undefined) return undefined;

                return trackAudioUrl(this.baseUrl, sourceId);
            });
        } catch (error) {
            // One item's worth of failure, handled the way the other links handle their own. There is
            // no provider link behind this one any more, so an item that fails here is skipped — which
            // is still better than handing over a URL that cannot be served.
            this.logger.warn('playout: could not resolve a record to the station audio route', {
                plugin: pluginId,
                track: externalId,
                error: errorText(error),
            });
            return undefined;
        }
    }
}
