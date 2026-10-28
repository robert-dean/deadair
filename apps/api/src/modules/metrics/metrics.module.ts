import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { MetricsRecorder } from '@maroonedsoftware/telemetry';
import { onSpan } from '#modules/shared/trace.spans.js';
import { MetricsFlusher } from './metrics.flusher.js';
import { MetricsRepository } from './metrics.repository.js';
import { MetricsService } from './metrics.service.js';
import { metricBounds, OtlpExport } from './otlp.export.js';
import { OtlpIngest } from './otlp.ingest.js';
import { OtlpReceiveService } from './otlp.receive.service.js';
import { observeSpan } from './span.metrics.js';
import { modelPrices } from './usage.prices.js';

/** Stops reading spans at shutdown, before the last flush. */
let stopSpans: (() => void) | undefined;

/**
 * The station's numbers over time: one recorder every producer observes into, and the loop that
 * writes it to `deadair.metric_samples` once a minute.
 *
 * Producers do not import anything from here but the recorder. A module that has a number registers a
 * gauge on `MetricsRecorder` in its own `ready()`, or calls `observe` where the work happens, and this
 * module never learns what any of them are.
 *
 * Right after `DataModule`, which registers the database and the heartbeat, and EARLY on purpose:
 * shutdown runs backwards, so registering here means the flusher's last write happens after every
 * producer below it has stopped, and still before the pools close.
 */
export const MetricsModule: ServerKitModule = {
    name: 'Metrics',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singletons: one buffer per process is the point, and the flusher runs off the request path.
        // Durations keep their distribution as well as the five numbers, for the OTLP histograms; the
        // table keeps only the five, so Trends is unchanged.
        registry
            .register(MetricsRecorder)
            .useFactory(() => {
                const recorder = new MetricsRecorder();
                recorder.bucketBounds = metricBounds;
                return recorder;
            })
            .asSingleton();
        registry.register(MetricsFlusher).useClass(MetricsFlusher).asSingleton();
        registry.register(OtlpExport).useClass(OtlpExport).asSingleton();
        // One receiver per process, for its cumulative baselines and its series cap; the route's
        // service is scoped like every other.
        registry.register(OtlpIngest).useClass(OtlpIngest).asSingleton();
        registry.register(OtlpReceiveService).useClass(OtlpReceiveService).asScoped();
        registry.register(MetricsRepository).useClass(MetricsRepository).asScoped();
        // Scoped: it answers the console's routes.
        registry.register(MetricsService).useClass(MetricsService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        // Work durations, model tokens and failures, read off the spans every timed call already
        // files. Registered in ready rather than setup so nothing is counted before the flusher runs.
        // The same listener holds each span for the OTLP export, which sends them with the minute.
        const recorder = container.get(MetricsRecorder);
        const otlp = container.get(OtlpExport);
        const config = container.get(AppConfig);
        stopSpans = onSpan(span => {
            // The prices are read per span rather than once, so a price saved in Settings applies from
            // the next call. Only a model call consults them, and parsing a short list is cheap.
            observeSpan(recorder, span, model => modelPrices(config).get(model));
            otlp.queueSpan(span);
        });
        container.get(MetricsFlusher).start();
    },

    shutdown: async (container: Container) => {
        stopSpans?.();
        stopSpans = undefined;
        await container.get(MetricsFlusher).stop();
    },
};
