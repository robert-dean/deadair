import { Injectable } from 'injectkit';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { RENDER_PLUGIN_ID } from '#modules/render/segment.source.js';
import { TrackResolver } from '../playout.capability.js';
import type { RundownItem } from '../rundown.js';
import { segmentAudioUrl } from '../playout.urls.js';

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
        private readonly container: Container,
        private readonly baseUrl: string,
        private readonly logger: Logger,
    ) {
        super();
    }

    /**
     * The container scopes are opened from, and deliberately not the injected one.
     *
     * This is a singleton reached through `Rundown` and `DirectorService`, both of
     * which can themselves first be built from a job or request scope. The
     * container it was constructed with is then a scope that is disposed moments
     * later, so every scope opened from it is the child of a dead one whose
     * transaction has already committed.
     *
     * `DirectorService` had exactly this and it logged `Transaction is already
     * committed` on a third of boots. Here it would be quieter and worse: a
     * resolve that throws is caught below and answers `undefined`, so the running
     * order would simply skip the segment and the station would miss the ident
     * without saying why.
     */
    private root?: Container;

    /** Hand over the root container. Called by `PlayoutModule.ready` before the pusher starts. */
    useRootContainer(root: Container): void {
        this.root = root;
    }

    async resolve(item: RundownItem): Promise<string | undefined> {
        if (item.pluginId !== RENDER_PLUGIN_ID) return undefined;

        // Its own scope, like everything else the transport does off the request path: this runs
        // on the pusher's loop, which has no ambient request to borrow a connection from. Opened
        // from the ROOT, for the reason on {@link root}.
        const scope = (this.root ?? this.container).createScopedContainer();
        try {
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

            return segmentAudioUrl(this.baseUrl, segment.id);
        } catch (error) {
            // One item's worth of failure, handled the way the plugin resolver handles its own:
            // the running order carries on without this line.
            this.logger.warn('playout: could not resolve a segment', {
                segment: item.externalId,
                error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        } finally {
            await scope.disposeAsync();
        }
    }
}
