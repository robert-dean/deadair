import type { Container } from 'injectkit';
import { Duration } from 'luxon';
import { MetricsRecorder } from '@maroonedsoftware/telemetry';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { LlmGate } from '#modules/llm/llm.gate.js';
import { METRICS } from '#modules/metrics/metric.names.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { StorageService } from '#modules/storage/storage.service.js';

/** How often the library counts are taken: they move with a sync or an analysis pass, not by the minute. */
const LIBRARY_EVERY = Duration.fromObject({ minutes: 5 });

/** How often the disk is measured: a walk of three directories, and disk does not move fast. */
const DISK_EVERY = Duration.fromObject({ minutes: 15 });

/**
 * The numbers Check-up shows as NOW, kept as trends: the library's three counts, the model's queue and
 * the disk.
 *
 * Read the way Check-up reads them (`trackStateCounts` at the analysis schema version, the gate's
 * snapshot, the storage report), so a chart and the page beside it can never disagree about what a
 * number means. Registered here rather than in each owning module because this module already reads
 * nearly everything, and none of those modules should have to know a trend exists.
 *
 * @returns A function that unregisters every gauge.
 */
export function registerStationGauges(container: Container): () => void {
    const recorder = container.get(MetricsRecorder);
    const gate = container.get(LlmGate);

    // The three library gauges come from one query. A sampling pass reads every due gauge at once, so
    // all three ask while the first count is still in flight, and sharing THAT promise is enough: it
    // is dropped as soon as it settles, so the next pass counts again however soon it comes.
    let inFlight: Promise<{ total: number; cached: number; measured: number }> | undefined;
    const counts = () => {
        inFlight ??= inScope(container, scope =>
            scope.get(TracksRepository).trackStateCounts({ limit: 0, offset: 0, sort: 'asc', schemaVersion: ANALYSIS_SCHEMA_VERSION }),
        ).finally(() => {
            inFlight = undefined;
        });
        return inFlight;
    };

    const stops = [
        recorder.gauge(METRICS.libraryTotal, async () => (await counts()).total, { every: LIBRARY_EVERY }),
        recorder.gauge(METRICS.libraryCached, async () => (await counts()).cached, { every: LIBRARY_EVERY }),
        recorder.gauge(METRICS.libraryMeasured, async () => (await counts()).measured, { every: LIBRARY_EVERY }),
        recorder.gauge(METRICS.modelWaiting, () => gate.snapshot(Date.now()).depth),
        recorder.gauge(METRICS.diskBytes, async () => (await inScope(container, scope => scope.get(StorageService).readStorage())).totalBytes, {
            every: DISK_EVERY,
        }),
    ];
    return () => {
        for (const stop of stops) stop();
    };
}
