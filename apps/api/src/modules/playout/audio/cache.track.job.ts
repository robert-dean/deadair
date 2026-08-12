import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { TrackCacheService } from './track.cache.service.js';

export interface CacheTrackPayload {
    /**
     * Which binding to keep a copy of, as the running order names it.
     *
     * Both optional in the type and required in practice, the way `RenderSegmentPayload.segmentId`
     * is: a job registration is typed against a payload the broker may deliver as `{}`, so neither
     * can be declared required without the mapping refusing it. The run guards on them instead.
     */
    pluginId?: string;
    externalId?: string;
}

/**
 * Fetch one record the station has just played, and keep it.
 *
 * Sent by the resolver on a cache miss and never scheduled, because there is nothing to find by
 * walking: a binding is worth a copy because the station played it, and a walk would download the
 * whole catalogue including the parts it never airs. An off-air station therefore caches nothing.
 *
 * A plain `Job` rather than a `TransactionalJob`, for the reason `ArtCacheJob` gives: a fetch of tens
 * of megabytes in the middle of a transaction would pin a runtime-pool connection and hold one
 * snapshot open for its whole length, and the writes at either end are one row each. Because it is
 * not transactional, the actor has to be installed here.
 *
 * ## Why nothing waits on this
 *
 * The play that triggered it has already been handed over through the provider. So a fetch that is
 * slow, or fails, or never runs at all costs the station one download it might have saved and never
 * an item — which is what makes it safe for this to be a background job with no deadline anyone
 * downstream cares about, and why the failure path is a row rather than an alert.
 *
 * Safe to send twice: {@link TrackCacheService.cache} claims the row before it fetches, so a record
 * that comes round again while the first download is in flight finds it claimed and does nothing.
 */
@Injectable()
export class CacheTrackJob implements Job<CacheTrackPayload> {
    constructor(
        private readonly cache: TrackCacheService,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a job is the runner's
        // per-execution scope. `ScopedContainer` is a type alias, not a token, so it can only be the
        // cast — same as RenderSegmentJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    async run(payload?: CacheTrackPayload, signal?: AbortSignal): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);

        if (!payload?.pluginId || !payload.externalId) {
            // A caller's bug rather than a station fault: this job is only ever sent, never
            // scheduled, so there is no payload-less run that means anything.
            this.logger.warn('playout: a track cache job was sent with no binding to fetch', { job: this.context.id });
            return;
        }

        // Not rethrown on a failure, and it does not throw: the service records the reason on the row
        // and answers. Letting it bubble would spend the job's one retry on a provider that is
        // usually still refusing, and the next play of the same record is a better retry than the
        // broker's because it means the station wants the bytes again.
        await this.cache.cache(payload.pluginId, payload.externalId, signal);
    }
}
