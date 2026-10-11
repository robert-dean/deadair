import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { isPluginError, type PlaybackReport } from '@deadair/plugin-sdk';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { asStreamPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';

/** One event about one served copy. JSON-safe: it is a job payload. */
export interface ReportPlaybackPayload {
    pluginId: string;
    /** The provider's own id for the record, as `track_sources.external_id` holds it. */
    trackId: string;
    report: PlaybackReport;
}

/**
 * How long a provider is given to take one report. A single request to its API, so not long.
 */
const REPORT_TIMEOUT_MS = 15_000;

/**
 * Telling the provider that served a record what became of it on air.
 *
 * Sent by {@link ProviderPlaybackReporter} off the rundown's aired edge, one job per event, so a slow or
 * failing provider never sits in front of the boundary. A failure the plugin calls retryable is
 * rethrown for the broker's retry; anything else is dropped, at info, because a report a service will
 * never take is not worth a second request.
 *
 * The plugin is looked up again here rather than trusted from the send: a provider disabled or
 * reloaded in between has nothing to report to, and that is not a failure either.
 */
@Injectable()
export class ReportPlaybackJob extends PlainJob<Partial<ReportPlaybackPayload>> {
    constructor(
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    // Partial, like every job payload here: what arrives is whatever the row holds.
    protected async execute(payload?: Partial<ReportPlaybackPayload>): Promise<void> {
        const { pluginId, trackId, report } = payload ?? {};
        if (typeof pluginId !== 'string' || typeof trackId !== 'string' || report === undefined) return;

        const record = this.registry.get(pluginId);
        const plugin = record ? asStreamPlugin(record) : undefined;
        const reportPlayback = plugin?.instance.reportPlayback;
        if (plugin === undefined || reportPlayback === undefined) return;

        try {
            await this.invoker.invoke(pluginId, 'stream.reportPlayback', async () => reportPlayback.call(plugin.instance, trackId, report), {
                timeoutMs: REPORT_TIMEOUT_MS,
            });
        } catch (error) {
            if (isPluginError(error) && error.retryable) throw error;

            this.logger.info(`playout: a provider would not take a playback report, and will not be asked again for it (${pluginId}: ${errorText(error)})`);
        }
    }
}
