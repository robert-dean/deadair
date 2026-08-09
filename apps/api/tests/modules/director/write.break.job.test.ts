// The slow half of planting a break. Every failure here has to end as a row the director skips,
// never as an exception and never as a segment stuck `planned` forever: a break that cannot be
// written must cost the station that break and nothing else.

import { describe, expect, it, vi } from 'vitest';

import { Lineup } from '../../../src/modules/director/lineup.js';
import { WriteBreakJob } from '../../../src/modules/director/write.break.job.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { Segment } from '../../../src/modules/render/segment.repository.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const track = (title: string, artist: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId: title,
    title,
    artists: [artist],
});

const planned = (overrides: Partial<Segment> = {}): Segment =>
    ({ id: 'seg-1', kind: 'talkbreak', state: 'planned', label: 'Talk break', source: 'render', ...overrides }) as Segment;

/** A rotation with a break planted between the second and third record. */
const lineupWithBreak = async (segmentId = 'seg-1'): Promise<Lineup> => {
    const lineup = new Lineup({ id: 'lineup-1', name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
    await lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
    await lineup.insertSegments([{ segmentId, atIndex: 1 }]);
    return lineup;
};

function harness(options: { segment?: Segment; lineup?: Lineup; written?: unknown; wrote?: boolean } = {}) {
    const segments = {
        findById: vi.fn(async () => ('segment' in options ? options.segment : planned())),
        recentScripts: vi.fn(async () => []),
        writeScript: vi.fn(async () => options.wrote ?? true),
        markFailed: vi.fn(async () => {}),
    };
    const lineups = { load: vi.fn(async () => options.lineup) };
    const writers = { write: vi.fn(async () => options.written ?? { script: 'talking', label: 'Talk break: one into two' }) };
    const jobs = { send: vi.fn(async () => {}) };
    const config = { get: vi.fn((_: string, fallback: string) => fallback) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const job = new WriteBreakJob(
        lineups as never,
        segments as never,
        writers as never,
        jobs as never,
        config as never,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    return { job, segments, lineups, writers, jobs, logger };
}

describe('WriteBreakJob', () => {
    it('writes the script and sends the render', async () => {
        const { job, segments, jobs } = harness({ lineup: await lineupWithBreak() });

        await job.run({ lineupId: 'lineup-1', segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', {
            script: 'talking',
            label: 'Talk break: one into two',
            writer: 'deterministic',
        });
        expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
    });

    it('derives the neighbours from the order as it stands now', async () => {
        // Not from the payload: between planting and writing, an operator can move a line and the
        // director can commit. A stale snapshot is how a station back-announces a record it never
        // played, which is the one mistake a listener can catch it out in.
        const { job, writers } = harness({ lineup: await lineupWithBreak() });

        await job.run({ lineupId: 'lineup-1', segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'talkbreak',
                previous: { title: 'Solid Air', artist: 'John Martyn' },
                next: { title: 'Pink Moon', artist: 'Nick Drake' },
            }),
        );
    });

    it('records the reason on the row when the writer has nothing to say', async () => {
        const { job, segments, jobs } = harness({ lineup: await lineupWithBreak(), written: { reason: 'nothing to say' } });

        await job.run({ lineupId: 'lineup-1', segmentId: 'seg-1' });

        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', 'nothing to say', 'planned');
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('fails the segment when its running order has gone', async () => {
        const { job, segments } = harness({ lineup: undefined });

        await job.run({ lineupId: 'lineup-1', segmentId: 'seg-1' });

        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', expect.stringContaining('gone'), 'planned');
    });

    it('does nothing when the segment has already moved on', async () => {
        // Already rendering, already written, or deleted. All ordinary races, all the same answer.
        const { job, segments, jobs } = harness({ segment: planned({ state: 'rendering' }) });

        await job.run({ lineupId: 'lineup-1', segmentId: 'seg-1' });

        expect(segments.writeScript).not.toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('does not render when the row was claimed between the write and the save', async () => {
        const { job, jobs } = harness({ lineup: await lineupWithBreak(), wrote: false });

        await job.run({ lineupId: 'lineup-1', segmentId: 'seg-1' });

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('warns and stops on a payload with nothing to write', async () => {
        const { job, segments, logger } = harness();

        await job.run({});
        await job.run();
        await job.run({ lineupId: 'lineup-1' });

        expect(segments.findById).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(3);
    });
});
