import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { MetricsRecorder } from '@maroonedsoftware/telemetry';
import { errorText } from '#modules/shared/error.text.js';
import { Heartbeat } from '#modules/shared/heartbeat.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { MetricsRepository } from './metrics.repository.js';
import { OtlpExport } from './otlp.export.js';

/** How often the recorder is drained into the table: once a minute, its bucket width. */
export const METRICS_FLUSH_MS = 60_000;

/** The heartbeat name, which Check-up's loops section shows beside the others. */
export const METRICS_FLUSH_HEARTBEAT = 'metrics.flush';

/**
 * Once a minute, samples every registered gauge and writes what the recorder holds.
 *
 * A module-owned loop rather than a cron job, like `OutputsSupervisor`, because what it drains is in
 * THIS process's memory: a pg-boss job could run in any worker and would find nothing there. It is the
 * only writer of minute rows.
 *
 * **A failed write drops the minute rather than keeping it.** Re-queuing the buckets would make a
 * database that is down for an hour into an hour of buffered rows in memory, written all at once when
 * it comes back, and a chart with a gap is the honest picture of that hour anyway. The failure is
 * logged once when it starts and once when it ends, not every minute in between.
 *
 * It never throws, and it beats in `finally`, so the loop is seen to be alive whether or not the
 * database is.
 */
@Injectable()
export class MetricsFlusher {
    private timer: ReturnType<typeof setInterval> | undefined;
    private flushing: Promise<void> | undefined;
    private failingSince: number | undefined;

    constructor(
        private readonly container: Container,
        private readonly recorder: MetricsRecorder,
        private readonly heartbeat: Heartbeat,
        private readonly otlp: OtlpExport,
        private readonly logger: Logger,
    ) {
        recorder.onGaugeError = (name, error) => this.logger.debug(`metrics: gauge ${name} could not be read: ${errorText(error)}`);
    }

    /** Starts the loop. The first flush is a minute away: there is nothing to write at boot. */
    start(): void {
        if (this.timer !== undefined) return;
        this.heartbeat.register(METRICS_FLUSH_HEARTBEAT);
        this.timer = setInterval(() => void this.flush(), METRICS_FLUSH_MS);
        this.timer.unref?.();
    }

    /**
     * Stops the loop and writes what is left, so the last partial minute before a deploy is kept.
     * Every producer has stopped by now: this module registers early, so it tears down late.
     */
    async stop(): Promise<void> {
        clearInterval(this.timer);
        this.timer = undefined;
        await this.flushing;
        await this.flush();
        await this.otlp.close();
        this.heartbeat.forget(METRICS_FLUSH_HEARTBEAT);
    }

    /** One pass. Overlapping passes are folded into the one already running. */
    flush(): Promise<void> {
        this.flushing ??= this.write().finally(() => {
            this.flushing = undefined;
        });
        return this.flushing;
    }

    private async write(): Promise<void> {
        try {
            await this.recorder.sampleGauges();
            const buckets = this.recorder.drain();

            if (buckets.length > 0) {
                try {
                    await inScope(this.container, scope => scope.get(MetricsRepository).upsertMinutes(buckets));
                    if (this.failingSince !== undefined) {
                        this.logger.info('metrics: writing again', { gapMs: Date.now() - this.failingSince });
                        this.failingSince = undefined;
                    }
                } catch (error) {
                    if (this.failingSince === undefined) {
                        this.failingSince = Date.now();
                        this.logger.warn(`metrics: could not write this minute, and will drop each one until it can: ${errorText(error)}`);
                    }
                }
            }

            // After the table, and whether or not the table took it: a collector is a second
            // destination for the same minute, and one being down must not cost the other. Called
            // with no buckets too, because the spans held since the last flush go out here as well.
            await this.otlp.export(buckets);
        } catch (error) {
            // Only the gauges can land here, and `sampleGauges` swallows its readers' throws, so
            // this is the loop's own safety net rather than an expected path.
            this.logger.warn(`metrics: the flush failed: ${errorText(error)}`);
        } finally {
            this.heartbeat.beat(METRICS_FLUSH_HEARTBEAT);
        }
    }
}
