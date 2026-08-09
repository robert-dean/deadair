// The rule the rest of the station leans on is that a segment which is not `ready` is SKIPPED, not
// waited for. That makes every failure here a row in a state the director passes over, and it is
// why none of these paths rethrow: a broken renderer must cost the station a break and never
// silence.

import { describe, expect, it, vi } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';

import { RenderSegmentJob } from '../../../src/modules/render/render.segment.job.js';
import type { SegmentRepository, Segment } from '../../../src/modules/render/segment.repository.js';
import type { SpeechService } from '../../../src/modules/render/speech.service.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const segment = (overrides: Partial<Segment> = {}): Segment =>
    ({
        id: 'seg-1',
        kind: 'ident',
        state: 'rendering',
        label: 'Station ident',
        script: 'You are listening to Deadair.',
        source: 'render',
        ...overrides,
    }) as Segment;

function harness(options: { claimed?: Segment | undefined; speak?: () => Promise<unknown> } = {}) {
    const claimed = 'claimed' in options ? options.claimed : segment();

    const segments = {
        claimForRender: vi.fn(async () => claimed),
        markReady: vi.fn(async () => {}),
        markFailed: vi.fn(async () => {}),
    } as unknown as SegmentRepository;

    const speech = {
        speak: vi.fn(options.speak ?? (async () => ({ checksum: 'abc', ext: 'mp3', pluginId: 'deadair.kokoro' }))),
    } as unknown as SpeechService;

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const job = new RenderSegmentJob(segments, speech, { id: 'job-1' } as never, {} as never, logger as never);

    return { job, segments, speech, logger };
}

describe('RenderSegmentJob', () => {
    it('speaks the script and marks the segment ready', async () => {
        const { job, segments, speech } = harness();

        await job.run({ segmentId: 'seg-1' });

        expect(speech.speak).toHaveBeenCalledWith({ text: 'You are listening to Deadair.' });
        expect(segments.markReady).toHaveBeenCalledWith('seg-1', { audioChecksum: 'abc', audioExt: 'mp3' });
        expect(segments.markFailed).not.toHaveBeenCalled();
    });

    it('asks for the voice the segment named', async () => {
        const { job, speech } = harness({ claimed: segment({ voice: 'newsreader' }) });

        await job.run({ segmentId: 'seg-1' });

        expect(speech.speak).toHaveBeenCalledWith({ text: 'You are listening to Deadair.', voice: 'newsreader' });
    });

    it('does nothing when the claim is refused, because somebody else has it', async () => {
        // The retry guard: `claimForRender` is a conditional update, so a second attempt arriving
        // mid-synthesis finds the row already `rendering` and stops rather than paying twice for
        // the same audio and racing to write the same row.
        const { job, speech, segments } = harness({ claimed: undefined });

        await job.run({ segmentId: 'seg-1' });

        expect(speech.speak).not.toHaveBeenCalled();
        expect(segments.markReady).not.toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
    });

    it('records the reason on the row when the plugin fails, and does not rethrow', async () => {
        const { job, segments } = harness({
            speak: async () => {
                throw new PluginError('no active plugin can speak').withCode('unavailable');
            },
        });

        // Not rethrown: the console is where an operator looks, and letting this bubble would spend
        // the job's one retry on a plugin that is usually still down.
        await expect(job.run({ segmentId: 'seg-1' })).resolves.toBeUndefined();
        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', 'no active plugin can speak', 'rendering');
        expect(segments.markReady).not.toHaveBeenCalled();
    });

    it('fails a segment planned with no script rather than asking the engine to say nothing', async () => {
        const { job, segments, speech } = harness({ claimed: segment({ script: '   ' }) });

        await job.run({ segmentId: 'seg-1' });

        expect(speech.speak).not.toHaveBeenCalled();
        // `failed` rather than back to `planned`, so it is visible in the console instead of being
        // retried forever by anything that walks planned segments.
        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', expect.stringContaining('no script'), 'rendering');
    });

    it('does not leave a segment stuck in rendering when the run is abandoned', async () => {
        const { job, segments, speech } = harness();

        await job.run({ segmentId: 'seg-1' }, AbortSignal.abort());

        expect(speech.speak).not.toHaveBeenCalled();
        // Stuck in `rendering` would be worse than failed: nothing would ever claim it again.
        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', expect.stringContaining('abandoned'), 'rendering');
    });

    it('warns and stops on a payload with nothing to render', async () => {
        const { job, segments, logger } = harness();

        await job.run({});
        await job.run();

        expect(segments.claimForRender).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });
});
