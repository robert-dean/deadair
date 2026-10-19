import { randomUUID } from 'node:crypto';
import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import type { FinishedSpan, MetricBucket } from '@maroonedsoftware/telemetry';
import { OtlpMetricsBridge, OtlpSpanBridge, type MetricKind } from '@maroonedsoftware/telemetry/otlp';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { RecordedSpan } from '#modules/shared/trace.spans.js';
import { METRICS } from './metric.names.js';
import { OTLP_KEYS, otlpSignalUrl, resolveOtlpSettings, type OtlpSettings } from './metrics.settings.js';
import { finishedSpanOf } from './span.traces.js';

/** How long one export may take before it is given up: well inside the minute between flushes. */
export const OTLP_EXPORT_TIMEOUT_MS = 10_000;

/**
 * The most spans held between two flushes. A busy minute files a few hundred; this is room for a
 * catalog sync's burst of plugin calls, and the bound that stops a collector that is down, or traces
 * switched off before the first flush noticed, from growing a buffer.
 */
export const MAX_SPAN_BUFFER = 5000;

/**
 * How each of the station's metrics goes out. Durations as histograms, so a collector keeps their
 * count, sum and extremes; tokens and failures as counters; everything else (listeners, the library,
 * the disk, the model's queue) as a gauge.
 *
 * Counters and histograms go out CUMULATIVE: the bridge keeps each series' running total and sends it
 * whole on every flush. The flusher drains the still-open minute too (the table merges it, and Trends
 * wants it), so with delta temporality the rest of a minute flushed early went out as a second point
 * over the same interval, which a collector keeps one of. A cumulative total just grows.
 */
export function metricKind(name: string): MetricKind {
    if (name.endsWith('.ms')) return 'histogram';
    if (name.startsWith('model.tokens.') || name === METRICS.failed) return 'counter';
    return 'gauge';
}

interface Bridges {
    key: string;
    metrics: OtlpMetricsBridge;
    spans: OtlpSpanBridge;
}

/** One signal's outage, logged when it starts and when it ends. */
class Outage {
    private since: number | undefined;

    constructor(
        private readonly signal: string,
        private readonly logger: Logger,
    ) {}

    failed(endpoint: string, error: unknown): void {
        if (this.since !== undefined) return;
        this.since = Date.now();
        // The endpoint and not the headers: they are the secret this setting exists to keep.
        this.logger.warn(
            `metrics: could not send ${this.signal} to the OTLP collector at ${endpoint}, and will drop them until it can: ${errorText(error)}`,
        );
    }

    sent(): void {
        if (this.since === undefined) return;
        this.logger.info(`metrics: the OTLP collector is taking ${this.signal} again`, { gapMs: Date.now() - this.since });
        this.since = undefined;
    }

    reset(): void {
        this.since = undefined;
    }
}

/**
 * Sends each flushed minute, and the spans filed during it, to an OTLP collector when the operator has
 * named one.
 *
 * It sends what the station has just recorded for itself, not a second measurement: the minute buckets
 * the table took, and the spans the trace file took. The settings are read on every flush, so naming,
 * changing or clearing an endpoint takes effect within a minute with no restart, and the exporters are
 * rebuilt only when the endpoint or its headers actually change.
 *
 * **Nothing here may cost the station its own work.** The flusher calls this after the table write and
 * this never throws: a collector that is down is logged when it goes and when it comes back, and what
 * fell in between is not queued: a counter's or histogram's running total carries it into the next
 * export that lands, and a gauge's readings from the outage are simply gone.
 *
 * **Each process is its own `service.instance.id`**, a fresh UUID at boot. A cumulative series is
 * keyed by its resource, so a restart, or the old container still flushing beside the new one during a
 * deploy, would otherwise be one series whose total went backwards or interleaved two.
 */
@Injectable()
export class OtlpExport {
    private current: Bridges | undefined;
    /** The last stored headers and what they decrypted to, so a scope is opened only when they change. */
    private headers: { raw: string; text: string } | undefined;
    private spans: FinishedSpan[] = [];
    private droppedSpans = 0;
    private readonly metricsOutage: Outage;
    private readonly tracesOutage: Outage;
    /** This process's `service.instance.id`, the same across every exporter rebuild it makes. */
    readonly instanceId = randomUUID();

    constructor(
        private readonly container: Container,
        private readonly config: AppConfig,
        private readonly identity: StationIdentity,
        private readonly logger: Logger,
    ) {
        this.metricsOutage = new Outage('metrics', logger);
        this.tracesOutage = new Outage('traces', logger);
    }

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

    /**
     * Holds one filed span for the next flush. Synchronous and cheap, because it runs inside
     * `recordSpan`, inside the call the span describes. Spans outside a decision are not kept, and past
     * {@link MAX_SPAN_BUFFER} a span is counted and dropped.
     */
    queueSpan(span: RecordedSpan): void {
        const finished = finishedSpanOf(span);
        if (finished === undefined) return;
        if (this.spans.length >= MAX_SPAN_BUFFER) {
            this.droppedSpans += 1;
            return;
        }
        this.spans.push(finished);
    }

    /**
     * Sends the minute's buckets and every span held since the last flush, each where its switch is on.
     * Never throws.
     */
    async export(buckets: readonly MetricBucket[]): Promise<void> {
        const spans = this.spans;
        const dropped = this.droppedSpans;
        this.spans = [];
        this.droppedSpans = 0;

        const settings = await this.settings();
        if (settings === undefined || (!settings.exportMetrics && !settings.exportTraces)) {
            await this.close();
            return;
        }
        const bridges = this.bridgesFor(settings);

        if (settings.exportMetrics && buckets.length > 0) {
            try {
                await bridges.metrics.export(buckets);
                this.metricsOutage.sent();
            } catch (error) {
                this.metricsOutage.failed(settings.endpoint, error);
            }
        }

        if (settings.exportTraces && spans.length > 0) {
            if (dropped > 0) this.logger.debug(`metrics: dropped ${dropped} spans past the ${MAX_SPAN_BUFFER} held between flushes`);
            try {
                await bridges.spans.export(spans);
                this.tracesOutage.sent();
            } catch (error) {
                this.tracesOutage.failed(settings.endpoint, error);
            }
        }
    }

    /** Flushes and closes both exporters. What shutdown and a cleared endpoint both do. */
    async close(): Promise<void> {
        const current = this.current;
        this.current = undefined;
        this.metricsOutage.reset();
        this.tracesOutage.reset();
        if (current === undefined) return;
        await Promise.all(
            [current.metrics, current.spans].map(async bridge => {
                try {
                    await bridge.shutdown();
                } catch {
                    // Closing a connection to a collector that is already gone has nothing left to report.
                }
            }),
        );
    }

    private bridgesFor(settings: OtlpSettings): Bridges {
        const key = JSON.stringify([settings.endpoint, settings.headers]);
        if (this.current?.key === key) return this.current;

        void this.close();
        const common = { headers: settings.headers, timeoutMillis: OTLP_EXPORT_TIMEOUT_MS };
        const resource = this.resource();
        this.current = {
            key,
            metrics: new OtlpMetricsBridge({
                exporter: new OTLPMetricExporter({
                    ...common,
                    url: otlpSignalUrl(settings.endpoint, 'metrics'),
                }),
                resource,
                scope: 'deadair',
                kindOf: metricKind,
                temporality: 'cumulative',
            }),
            spans: new OtlpSpanBridge({
                exporter: new OTLPTraceExporter({ ...common, url: otlpSignalUrl(settings.endpoint, 'traces') }),
                resource,
                scope: 'deadair',
            }),
        };
        return this.current;
    }

    /** Who is sending: this process, and the station it airs, which used to be the instance id. */
    resource(): Resource {
        return resourceFromAttributes({
            'service.name': 'deadair',
            'service.instance.id': this.instanceId,
            'deadair.station': this.identity.stationKey,
        });
    }
}
