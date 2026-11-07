import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PLUGIN_CAPABILITY_ANALYSIS } from '@deadair/plugin-sdk';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { PROVIDER_CAPABILITIES, pluginInUse } from '#modules/plugins/plugin.providers.js';
import { errorText } from '#modules/shared/error.text.js';
import { TrackAudioService } from './track.audio.service.js';

export interface CacheTrackPayload {
    /**
     * Which binding to get in hand, as `track_sources.id` — the same id the served URL carries.
     *
     * Optional in the type and required in practice, the way `RenderSegmentPayload.segmentId` is: a
     * job registration is typed against a payload the broker may deliver as `{}`, so it cannot be
     * declared required without the mapping refusing it. The run guards on it instead.
     */
    sourceId?: string;
}

/**
 * Get one record's audio in hand before something asks for it.
 *
 * Never scheduled: a binding is worth fetching because it is about to air, so this is sent by the
 * ripener off the commit pass (`TrackCachePlanner`), and an off-air station therefore fetches nothing.
 * The request desk sends it too, for a listener's request it is about to place. The route works
 * without it either way, which is the difference this reshape bought: warming is an optimisation now
 * rather than the only thing that puts a record within reach.
 *
 * A plain `Job` rather than a `TransactionalJob`, for the reason `ArtCacheJob` gives: a fetch of tens
 * of megabytes in the middle of a transaction would pin a runtime-pool connection and hold one
 * snapshot open for its whole length, and the writes at either end are one row each.
 *
 * ## Why nothing waits on this
 *
 * A record whose warm never ran is fetched by the request that needs it instead, on the spot. So a
 * fetch that is slow, or fails, or never runs at all costs the first play of that record a live
 * download and never the item — which is what makes it safe for this to be a background job with no
 * deadline anyone downstream cares about, and why the failure path is a row rather than an alert.
 *
 * Safe to send twice: {@link TrackAudioService} de-duplicates by source id in memory, so a second send
 * arriving mid-download waits on the first rather than starting another.
 *
 * ## Then it asks for the record to be measured
 *
 * Once the bytes are here, and only then, it sends `catalog.analyze_track` for the same binding. A
 * record fetched ahead is about to air, and the hourly measurement walk can reach it after it has: the
 * director re-reads a measurement onto a planned item right up to air, but only one that exists. A
 * station with no analyzer in use (none installed, the chosen one quarantined, or a setting naming one
 * that is not running) sends nothing, so the missing analyzer costs one look at the plugin registry.
 * Sent after a cache hit too: the measurement job finds a measured record not due and stops, which is
 * cheaper than this job working out the same thing.
 */
@Injectable()
export class CacheTrackJob extends PlainJob<CacheTrackPayload> {
    constructor(
        private readonly audio: TrackAudioService,
        private readonly jobs: PgBossJobBroker,
        // The two things that say whether an analyzer is in use, read here rather than by asking the
        // analysis module: `analysis` registers after `playout` and already imports from it, so the
        // dependency can only run this way, and `pluginInUse` is the same rule `AnalysisService` applies.
        private readonly plugins: PluginRegistry,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: CacheTrackPayload, signal?: AbortSignal): Promise<void> {
        if (!payload?.sourceId) {
            // A caller's bug rather than a station fault: this job is only ever sent, never
            // scheduled, so there is no payload-less run that means anything.
            this.logger.warn('playout: a track cache job was sent with no binding to fetch', { job: this.context.id });
            return;
        }

        // Not rethrown on a failure, and `warm` does not throw: the service records the reason on the
        // row and answers false. Letting it bubble would spend the job's one retry on a provider that
        // is usually still refusing, and the request that actually needs the record is a better retry
        // than the broker's because it means something is waiting for the bytes.
        const got = await this.audio.warm(payload.sourceId, signal);
        if (!got || signal?.aborted) return;

        await this.askForMeasurement(payload.sourceId);
    }

    /**
     * Send the measurement of a record just put on disk, when there is anything to measure it with.
     *
     * Never throws: the fetch is what this job is for and it has already succeeded, and a send that
     * failed leaves the record to the hourly walk, which is where it was before this existed.
     */
    private async askForMeasurement(sourceId: string): Promise<void> {
        const analyzer = pluginInUse(this.plugins.list(), this.config, PROVIDER_CAPABILITIES[PLUGIN_CAPABILITY_ANALYSIS]);
        if (analyzer === undefined) return;

        await this.jobs.send('catalog.analyze_track', { sourceId }).catch((error: unknown) => {
            this.logger.warn('playout: could not ask for a cached record to be measured', { source: sourceId, error: errorText(error) });
        });
    }
}
