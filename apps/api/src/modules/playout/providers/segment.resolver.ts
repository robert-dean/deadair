import { Injectable } from 'injectkit';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { RENDER_PLUGIN_ID } from '#modules/render/segment.source.js';
import { TrackResolver } from '../playout.capability.js';
import type { RundownItem } from '../rundown.js';
import { segmentAudioUrl } from '../playout.urls.js';
import { AudioUrlSigner } from '../audio.url.signer.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';

/**
 * The station's own audio: a segment it can play, as a URL the player can fetch.
 *
 * The second link in {@link CompositeTrackResolver}, and the first one that is not
 * a provider. It claims an item by `pluginId` exactly as the plugin resolver does,
 * so which link answers is decided by the item itself rather than by a mode
 * somewhere: a running order holding both a Spotify track and an ident resolves
 * each through whichever can speak for it.
 *
 * Confirms the segment still has audio before handing out a URL, rather than
 * minting one and letting the player discover the 404. That costs one indexed read
 * per segment on a path that already does one per record, and it turns "the
 * station went quiet for thirty seconds" into a skip and a log line: `Rundown.next`
 * moves on to the following item when a resolver declines.
 */
@Injectable()
export class SegmentTrackResolver extends TrackResolver {
    constructor(
        // The ROOT container: this is a singleton, so InjectKit resolves its dependencies from
        // the root rather than from whichever scope built it. Worth saying out loud here,
        // because this class is reached through `Rundown` and `DirectorService` and both of
        // those can first be built from a job or a request scope. A scope opened from one of
        // those would be the child of a container disposed moments later, and the symptom
        // would be quiet: a resolve that throws is caught below and answers `undefined`, so
        // the running order would just skip the ident without saying why.
        private readonly container: Container,
        private readonly baseUrl: string,
        private readonly logger: Logger,
        private readonly signer: AudioUrlSigner,
    ) {
        super();
    }

    async resolve(item: RundownItem): Promise<string | undefined> {
        if (item.pluginId !== RENDER_PLUGIN_ID) return undefined;

        // Its own scope, like everything else the transport does off the request path: this runs
        // on the pusher's loop, which has no ambient request to borrow a connection from.
        try {
            return await inScope(this.container, async scope => {
                const segment = await scope.get(SegmentRepository).findById(item.externalId);
                if (segment?.state !== 'ready' || segment.audioChecksum === undefined) {
                    // Reachable when a segment is re-recorded or deleted between the director's commit
                    // and the hand-over, which is a window of whole tracks rather than milliseconds.
                    this.logger.warn('playout: a committed segment has no audio to play; skipping it', {
                        segment: item.externalId,
                        state: segment?.state ?? 'gone',
                    });
                    return undefined;
                }

                // Signed, because the player fetches it with no session; see `playout.audio.token.ts`.
                return this.signer.sign(segmentAudioUrl(this.baseUrl, segment.id));
            });
        } catch (error) {
            // One item's worth of failure, handled the way the plugin resolver handles its own:
            // the running order carries on without this line.
            this.logger.warn('playout: could not resolve a segment', {
                segment: item.externalId,
                error: errorText(error),
            });
            return undefined;
        }
    }
}
