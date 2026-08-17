// The rule the rest of the station leans on is that a segment which is not `ready` is SKIPPED, not
// waited for. That makes every failure here a row in a state the director passes over, and it is
// why none of these paths rethrow: a broken renderer must cost the station a break and never
// silence.

import { describe, expect, it, vi } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';

import { RenderSegmentJob } from '../../../src/modules/render/render.segment.job.js';
import type { SegmentRepository, Segment } from '../../../src/modules/render/segment.repository.js';
import type { SpeechService } from '../../../src/modules/render/speech.service.js';
import type { AnalysisService } from '../../../src/modules/analysis/analysis.service.js';
import type { AppConfig } from '@maroonedsoftware/appconfig';

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

function harness(
    options: {
        claimed?: Segment | undefined;
        speak?: () => Promise<unknown>;
        measure?: () => Promise<unknown>;
    } = {},
) {
    const claimed = 'claimed' in options ? options.claimed : segment();

    const segments = {
        claimForRender: vi.fn(async () => claimed),
        markReady: vi.fn(async () => {}),
        markFailed: vi.fn(async () => {}),
        recordLoudness: vi.fn(async () => {}),
    } as unknown as SegmentRepository;

    const speech = {
        speak: vi.fn(
            options.speak ?? (async () => ({ checksum: 'abc', ext: 'mp3', pluginId: 'deadair.kokoro', spokenText: 'You are listening to Deadair.' })),
        ),
    } as unknown as SpeechService;

    const analysis = {
        measureAudio: vi.fn(options.measure ?? (async () => ({ schemaVersion: 1, complete: true, data: { loudnessLufs: -24.5 } }))),
    } as unknown as AnalysisService;

    const config = { get: vi.fn((_key: string, fallback: string) => fallback) } as unknown as AppConfig;

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const job = new RenderSegmentJob(segments, speech, analysis, config, { id: 'job-1' } as never, {} as never, logger as never);

    return { job, segments, speech, analysis, logger };
}

describe('RenderSegmentJob', () => {
    it('speaks the script and marks the segment ready', async () => {
        const { job, segments, speech } = harness();

        await job.run({ segmentId: 'seg-1' });

        expect(speech.speak).toHaveBeenCalledWith({ text: 'You are listening to Deadair.' });
        expect(segments.markReady).toHaveBeenCalledWith('seg-1', {
            audioChecksum: 'abc',
            audioExt: 'mp3',
            spokenScript: 'You are listening to Deadair.',
        });
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

// A speech engine aims at no level, so this is the only thing that can say where the station's own
// voice actually landed. Everything here is about it never costing the break: the measurement runs
// after the row is airable, and every way it can fail is a break at the assumed level rather than
// no break.
describe('RenderSegmentJob: measuring what it made', () => {
    it('measures the audio and writes the loudness down', async () => {
        const { job, segments, analysis } = harness();

        await job.run({ segmentId: 'seg-1' });

        expect(analysis.measureAudio).toHaveBeenCalledWith('seg-1', expect.stringContaining('seg-1'));
        expect(segments.recordLoudness).toHaveBeenCalledWith('seg-1', -24.5);
    });

    it('marks the segment ready before it measures it', async () => {
        // The ordering is the whole design: a break is airable the moment the audio exists, and a
        // round trip to a sidecar that may be slow or absent must not hold that up.
        const order: string[] = [];
        const { job, segments, analysis } = harness();
        vi.mocked(segments.markReady).mockImplementation(async () => void order.push('ready'));
        vi.mocked(analysis.measureAudio).mockImplementation(async () => {
            order.push('measured');
            return undefined;
        });

        await job.run({ segmentId: 'seg-1' });

        expect(order).toEqual(['ready', 'measured']);
    });

    it('leaves the segment alone when there is no analyzer', async () => {
        // A station with none is an ordinary state, not a fault: `speechGainFor` falls back to an
        // assumed speech level and the break airs.
        const { job, segments } = harness({ measure: async () => undefined });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.recordLoudness).not.toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
    });

    it('ignores a measurement that carries no loudness', async () => {
        // Allowed by the contract -- the cue points are required and the loudness is not -- and
        // what near-silence legitimately produces.
        const { job, segments } = harness({ measure: async () => ({ schemaVersion: 1, complete: true, data: {} }) });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.recordLoudness).not.toHaveBeenCalled();
    });

    it('costs the break nothing when the measurement throws', async () => {
        const { job, segments, logger } = harness({
            measure: async () => {
                throw new Error('the analyzer is not there');
            },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.markReady).toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not measure'), expect.anything());
    });
});
