import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { OtlpPayloadError } from '@maroonedsoftware/telemetry';
import { MetricsRepository } from './metrics.repository.js';
import { otlpReceiveIsOn, resolveOtlpMaxSeriesPerName } from './metrics.settings.js';
import { OtlpIngest } from './otlp.ingest.js';
import type { OtlpExportResponse, OtlpMetricsExport } from './types/metrics.types.js';

/**
 * Other services' metrics, written into the station's own table beside its own.
 *
 * Received rows carry `source: 'otlp'`, and their names are whatever the sender called them, so the
 * Trends tab lists them apart from the station's. Each request is folded into minute buckets and
 * upserted like a flush, so a sender exporting every ten seconds still costs one row per series per
 * minute.
 *
 * The answer is OTLP's own: an empty object when every point was taken, `partialSuccess` with a count
 * when some were not (over the cap, or a kind the station does not read). Senders log that rather than
 * retrying, which is what dropped points should cause.
 */
@Injectable()
export class OtlpReceiveService {
    constructor(
        private readonly config: AppConfig,
        private readonly ingest: OtlpIngest,
        private readonly metrics: MetricsRepository,
    ) {}

    async receive(body: OtlpMetricsExport): Promise<OtlpExportResponse> {
        // Not found rather than forbidden: until an operator turns this on, there is nothing here.
        if (!otlpReceiveIsOn(this.config)) throw httpError(404);

        let result;
        try {
            result = this.ingest.receive(body, resolveOtlpMaxSeriesPerName(this.config));
        } catch (error) {
            if (error instanceof OtlpPayloadError) throw httpError(400).withDetails({ message: error.message });
            throw error;
        }

        if (result.buckets.length > 0) await this.metrics.upsertMinutes(result.buckets, 'otlp');

        const rejected = result.dropped + result.unsupported;
        if (rejected === 0) return {};
        return {
            partialSuccess: {
                rejectedDataPoints: String(rejected),
                errorMessage: [
                    result.dropped > 0 ? `${result.dropped} over the station's series limit` : undefined,
                    result.unsupported > 0
                        ? `${result.unsupported} of a kind it does not read (exponential histograms, summaries) or malformed`
                        : undefined,
                ]
                    .filter(part => part !== undefined)
                    .join('; '),
            },
        };
    }
}
