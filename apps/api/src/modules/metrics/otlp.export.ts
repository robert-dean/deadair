import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import type { MetricBucket } from '@maroonedsoftware/telemetry';
import { OtlpMetricsBridge, type MetricKind } from '@maroonedsoftware/telemetry/otlp';
import { OTLPMetricExporter, AggregationTemporalityPreference } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { METRICS } from './metric.names.js';
import { OTLP_KEYS, otlpSignalUrl, resolveOtlpSettings, type OtlpSettings } from './metrics.settings.js';

/** How long one export may take before it is given up: well inside the minute between flushes. */
export const OTLP_EXPORT_TIMEOUT_MS = 10_000;

/**
 * How each of the station's metrics goes out. Durations as histograms, so a collector keeps their
 * count, sum and extremes; tokens and failures as counters; everything else (listeners, the library,
 * the disk, the model's queue) as a gauge.
 */
export function metricKind(name: string): MetricKind {
    if (name.endsWith('.ms')) return 'histogram';
    if (name.startsWith('model.tokens.') || name === METRICS.failed) return 'counter';
    return 'gauge';
}

/**
 * Sends each flushed minute to an OTLP collector, when the operator has named one.
 *
 * It sends the buckets the station has just written for itself, not a second measurement: one
 * recorder, two destinations. The settings are read on every flush, so naming, changing or clearing
 * an endpoint takes effect within a minute with no restart, and the exporter is rebuilt only when the
 * endpoint or its headers actually change.
 *
 * **Nothing here may cost the station its own write.** The flusher calls this after the table write
 * and this never throws: a collector that is down is logged when it goes and when it comes back, and
 * the minutes in between are dropped rather than queued, which is the flusher's own rule for its own
 * table and the same argument (a buffer growing for as long as something else is broken).
 */
@Injectable()
export class OtlpExport {
    private current: { key: string; bridge: OtlpMetricsBridge } | undefined;
    private failingSince: number | undefined;
    /** The last stored headers and what they decrypted to, so a scope is opened only when they change. */
    private headers: { raw: string; text: string } | undefined;

    constructor(
        private readonly container: Container,
        private readonly config: AppConfig,
        private readonly identity: StationIdentity,
        private readonly logger: Logger,
    ) {}

    /**
     * The settings as they stand now, or `undefined` when nothing is to be sent.
     *
     * `EncryptionProvider` is scoped and this is a singleton, which InjectKit refuses to wire directly
     * (a singleton holding a scoped instance would keep using it after its scope is disposed). So the
     * headers are decrypted in a scope of their own, and only when the stored value changes.
     */
    async settings(): Promise<OtlpSettings | undefined> {
        const raw = String(this.config.get(OTLP_KEYS.headers, ''));
        if (this.headers?.raw !== raw) {
            const text =
                raw.length === 0
                    ? ''
                    : await inScope(this.container, async scope => {
                          try {
                              return scope.get(EncryptionProvider).decrypt(raw);
                          } catch {
                              return raw;
                          }
                      });
            this.headers = { raw, text };
        }
        const text = this.headers.text;
        return resolveOtlpSettings(this.config, () => text);
    }

    /** Sends the buckets if an endpoint is set and metrics are switched on. Never throws. */
    async exportMetrics(buckets: readonly MetricBucket[]): Promise<void> {
        const settings = await this.settings();
        if (settings === undefined || !settings.exportMetrics) {
            await this.close();
            return;
        }
        if (buckets.length === 0) return;

        try {
            await this.bridgeFor(settings).export(buckets);
            if (this.failingSince !== undefined) {
                this.logger.info('metrics: the OTLP collector is taking metrics again', { gapMs: Date.now() - this.failingSince });
                this.failingSince = undefined;
            }
        } catch (error) {
            if (this.failingSince === undefined) {
                this.failingSince = Date.now();
                // The endpoint and not the headers: they are the secret this setting exists to keep.
                this.logger.warn(
                    `metrics: could not send to the OTLP collector at ${settings.endpoint}, and will drop each minute until it can: ${errorText(error)}`,
                );
            }
        }
    }

    /** Flushes and closes the exporter. What shutdown and a cleared endpoint both do. */
    async close(): Promise<void> {
        const current = this.current;
        this.current = undefined;
        this.failingSince = undefined;
        if (current === undefined) return;
        try {
            await current.bridge.shutdown();
        } catch {
            // Closing a connection to a collector that is already gone has nothing left to report.
        }
    }

    private bridgeFor(settings: OtlpSettings): OtlpMetricsBridge {
        const key = JSON.stringify([settings.endpoint, settings.headers]);
        if (this.current?.key === key) return this.current.bridge;

        void this.close();
        const exporter = new OTLPMetricExporter({
            url: otlpSignalUrl(settings.endpoint, 'metrics'),
            headers: settings.headers,
            timeoutMillis: OTLP_EXPORT_TIMEOUT_MS,
            temporalityPreference: AggregationTemporalityPreference.DELTA,
        });
        const bridge = new OtlpMetricsBridge({ exporter, resource: this.resource(), scope: 'deadair', kindOf: metricKind });
        this.current = { key, bridge };
        return bridge;
    }

    private resource(): Resource {
        return resourceFromAttributes({ 'service.name': 'deadair', 'service.instance.id': this.identity.stationKey });
    }
}
