// A station whose model has gone quietly keeps talking in its own fallback phrasing, which is the
// floor working and the reason nobody notices. What this pins is that the feed says so once, after
// a run rather than a blip, only for a model that FAILED rather than one that declined, and says so
// again when the model is back.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { BreakFloorWatch, FLOOR_AFTER_MS } from '../../../src/modules/director/break.floor.watch.js';
import type { BreakWriteResult, WriteAttempt } from '../../../src/modules/director/break.writer.registry.js';

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const WRITERS = ['model-talk', 'talk'];

function watch() {
    const activity = { record: vi.fn(async () => {}) };
    return { subject: new BreakFloorWatch(activity as never, quiet), activity };
}

const attempt = (writer: string, outcome: WriteAttempt['outcome']): WriteAttempt => ({ writer, outcome, durationMs: 10 });

/** The floor wrote it after the model threw. */
const fellToFloor = (): BreakWriteResult => ({
    writer: 'talk',
    written: { label: 'x', script: 'x' } as never,
    attempts: [attempt('model-talk', 'failed'), attempt('talk', 'written')],
});

/** The model wrote it. */
const modelWrote = (): BreakWriteResult => ({
    writer: 'model-talk',
    written: { label: 'x', script: 'x' } as never,
    attempts: [attempt('model-talk', 'written')],
});

const kinds = (activity: { record: ReturnType<typeof vi.fn> }) => activity.record.mock.calls.map(call => (call[0] as { kind: string }).kind);

describe('BreakFloorWatch', () => {
    it('says nothing about a model that failed for less than the window', () => {
        const { subject, activity } = watch();

        subject.observe(fellToFloor(), WRITERS, 0);
        subject.observe(fellToFloor(), WRITERS, 10 * 60_000);
        subject.observe(fellToFloor(), WRITERS, 20 * 60_000);

        expect(activity.record).not.toHaveBeenCalled();
        expect(subject.reading()).toBeUndefined();
    });

    it('says so once the model has failed every break for the window, and only once', () => {
        const { subject, activity } = watch();

        subject.observe(fellToFloor(), WRITERS, 0);
        subject.observe(fellToFloor(), WRITERS, 30 * 60_000);
        subject.observe(fellToFloor(), WRITERS, FLOOR_AFTER_MS);
        subject.observe(fellToFloor(), WRITERS, FLOOR_AFTER_MS + 60_000);

        expect(kinds(activity)).toEqual(['break.floor']);
        expect(subject.reading()).toEqual({ since: 0, breaks: 4 });
    });

    it('says the model is back on the first break it writes, and starts counting again from nothing', () => {
        const { subject, activity } = watch();

        for (const at of [0, 30 * 60_000, FLOOR_AFTER_MS]) subject.observe(fellToFloor(), WRITERS, at);
        subject.observe(modelWrote(), WRITERS, FLOOR_AFTER_MS + 1);

        expect(kinds(activity)).toEqual(['break.floor', 'break.floorCleared']);
        expect(subject.reading()).toBeUndefined();
    });

    it('does not count a model that declined for content, which is the model working', () => {
        const { subject, activity } = watch();
        const declined: BreakWriteResult = {
            writer: 'talk',
            written: { label: 'x', script: 'x' } as never,
            attempts: [attempt('model-talk', 'declined'), attempt('talk', 'written')],
        };

        for (const at of [0, 30 * 60_000, FLOOR_AFTER_MS, FLOOR_AFTER_MS * 2]) subject.observe(declined, WRITERS, at);

        expect(activity.record).not.toHaveBeenCalled();
    });

    it('ignores a kind with no model in front of its floor', () => {
        const { subject, activity } = watch();
        const only = { writer: 'jingle', written: {} as never, attempts: [attempt('jingle', 'written')] };

        for (const at of [0, 30 * 60_000, FLOOR_AFTER_MS]) subject.observe(only, ['jingle'], at);

        expect(activity.record).not.toHaveBeenCalled();
    });
});
