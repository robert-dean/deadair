import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import type { BreakWriteResult } from './break.writer.registry.js';

/**
 * How long every model writer has to have been failing before the feed says so.
 *
 * An hour, because one failed break is a model that was busy and the floor covering for it is the
 * station working as designed. What is worth an operator's attention is the station having spoken in
 * its own fallback phrasing all evening without anybody being told the model is gone.
 */
export const FLOOR_AFTER_MS = 60 * 60_000;

/** And at least this many breaks in that time, so one failure an hour ago and one now is not a pattern. */
export const FLOOR_AFTER_BREAKS = 3;

/** What the attention list reads: when the run of fallbacks began, and how many breaks it covers. */
export interface FloorReading {
    since: number;
    breaks: number;
}

/**
 * Says out loud when breaks have been falling to the floor because the model is not answering.
 *
 * Each fall-through already reaches the feed as `break.degraded`, one row per break, and that is the
 * right record of a single break. It does not add up to the sentence an operator needs, which is
 * "the model has not written anything for an hour", and a station whose model has gone quietly speaks
 * in its fallback phrasing with nothing else to say so: the 10-minute generation budget and the floor
 * under every kind keep it on air, which is exactly why nobody notices.
 *
 * ## What counts
 *
 * Only a break where a model writer FAILED (threw: timed out, unavailable, errored) and the floor wrote
 * it. A model that declined a script for its content is the model working, and the retry and the floor
 * are the designed answer to it. A break the model wrote clears the run, whatever happened before.
 *
 * ## Its own singleton, and why
 *
 * For `AdvisoryWatch`'s reason: the job that observes this is scoped, so the run has to live somewhere
 * that outlives one write. Edges only, like every `station_events` producer, and it never throws.
 */
@Injectable()
export class BreakFloorWatch {
    private run?: FloorReading;
    private reported = false;

    constructor(
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /**
     * One written break, and which writers its kind has, in the order they are asked.
     *
     * A kind with a single writer has no model in front of its floor, so it says nothing either way.
     */
    observe(result: BreakWriteResult, writers: readonly string[], now: number = Date.now()): void {
        if (result.writer === undefined || writers.length < 2) return;

        const floor = writers[writers.length - 1];
        if (result.writer !== floor) {
            this.clear();
            return;
        }

        const modelFailed = result.attempts.some(attempt => attempt.writer !== floor && attempt.outcome === 'failed');
        if (!modelFailed) return;

        this.run = this.run === undefined ? { since: now, breaks: 1 } : { since: this.run.since, breaks: this.run.breaks + 1 };
        if (this.reported || now - this.run.since < FLOOR_AFTER_MS || this.run.breaks < FLOOR_AFTER_BREAKS) return;

        this.reported = true;
        const minutes = Math.round((now - this.run.since) / 60_000);
        this.logger.warn('director: breaks have been falling to the floor because the model is not answering', { minutes, breaks: this.run.breaks });
        void this.activity.record({
            module: 'director',
            kind: 'break.floor',
            severity: 'warn',
            detail:
                `The model has not written a break for ${minutes} minutes: the last ${this.run.breaks} were written in the station's own ` +
                'phrasing because the model failed to answer. Check that the model is running and reachable.',
            data: { since: new Date(this.run.since).toISOString(), breaks: this.run.breaks },
        });
    }

    /** The run in progress once it has been reported, for the attention list. Absent otherwise. */
    reading(): FloorReading | undefined {
        return this.reported ? this.run : undefined;
    }

    /** The falling edge: a model wrote a break. */
    private clear(): void {
        const wasReported = this.reported;
        this.run = undefined;
        this.reported = false;
        if (!wasReported) return;

        this.logger.info('director: the model is writing breaks again');
        void this.activity.record({
            module: 'director',
            kind: 'break.floorCleared',
            detail: 'The model is writing breaks again.',
        });
    }
}
