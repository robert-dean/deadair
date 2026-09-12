// The rule the rest of the station leans on is that a segment which is not `ready` is SKIPPED, not
// waited for. That makes every failure here a row in a state the director passes over, and it is
// why none of these paths rethrow: a broken renderer must cost the station a break and never
// silence.

import { describe, expect, it, vi } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';

import { RenderSegmentJob } from '../../../src/modules/render/render.segment.job.js';
import type { SegmentRepository, Segment } from '../../../src/modules/render/segment.repository.js';
import type { SpeechService } from '../../../src/modules/render/speech.service.js';
import type { MixerService } from '../../../src/modules/render/mixer.service.js';
import type { SegmentStore } from '../../../src/modules/render/segment.store.js';
import type { PadRepository } from '../../../src/modules/render/pad.repository.js';
import type { AnalysisService } from '../../../src/modules/analysis/analysis.service.js';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { AudioUrlSigner } from '../../../src/modules/playout/audio.url.signer.js';

/** Hands URLs back unsigned: what is signed and how is `AudioUrlSigner`'s own test. */
const signer = { sign: (url: string) => url } as unknown as AudioUrlSigner;

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const segment = (overrides: Partial<Segment> = {}): Segment =>
    ({
        id: 'seg-1',
        kind: 'ident',
        state: 'rendering',
        label: 'Station ident',
        script: 'You are listening to Deadair.',
        source: 'render',
        // Every real row has this, because `toSegment` fills it unconditionally. Spelled out here
        // because the cast below is what lets a fixture skip a required field.
        pads: [],
        ...overrides,
    }) as Segment;

function harness(
    options: {
        claimed?: Segment | undefined;
        speak?: () => Promise<unknown>;
        measure?: () => Promise<unknown>;
        released?: boolean;
        join?: () => Promise<unknown>;
        /** The pad the row names has been deleted since the words were written. */
        padMissing?: boolean;
        /** Settings as the STRINGS a config layer actually holds. */
        settings?: Record<string, string>;
    } = {},
) {
    const claimed = 'claimed' in options ? options.claimed : segment();

    const segments = {
        claimForRender: vi.fn(async () => claimed),
        markReady: vi.fn(async () => {}),
        markFailed: vi.fn(async () => {}),
        releaseForRetry: vi.fn(async () => options.released ?? true),
        recordLoudness: vi.fn(async () => {}),
    } as unknown as SegmentRepository;

    const speech = {
        speak: vi.fn(
            options.speak ?? (async () => ({ checksum: 'abc', ext: 'mp3', pluginId: 'deadair.kokoro', spokenText: 'You are listening to Deadair.' })),
        ),
    } as unknown as SpeechService;

    const analysis = {
        measureAudio: vi.fn(options.measure ?? (async () => ({ schemaVersion: 1, complete: true, data: { integratedLufs: -24.5 } }))),
    } as unknown as AnalysisService;

    // The join, and the two things it reaches for. Never called for a segment that hits no pad,
    // which is every fixture here that does not say otherwise.
    const mixer = {
        join: vi.fn(options.join ?? (async () => ({ mime: 'audio/flac', audio: new ReadableStream<Uint8Array>(), durationMs: 4200 }))),
    } as unknown as MixerService;

    const store = { writeStream: vi.fn(async () => 'joined-checksum') } as unknown as SegmentStore;

    const pads = {
        findById: vi.fn(async (id: string) =>
            options.padMissing
                ? undefined
                : {
                      id,
                      board: 'wisecrack',
                      name: 'rimshot',
                      label: 'Rimshot',
                      audioChecksum: 'pad-sum',
                      audioExt: 'mp3',
                      source: 'library',
                      state: 'active',
                  },
        ),
    } as unknown as PadRepository;

    const config = { get: vi.fn((key: string, fallback: string) => options.settings?.[key] ?? fallback) } as unknown as AppConfig;

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const job = new RenderSegmentJob(
        segments,
        speech,
        mixer,
        store,
        pads,
        analysis,
        config,
        signer,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    return { job, segments, speech, mixer, store, pads, analysis, logger };
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

    it('asks for the reading the segment named, beside its voice', async () => {
        const { job, speech } = harness({ claimed: segment({ voice: 'conspiracy', delivery: 'hushed' }) });

        await job.run({ segmentId: 'seg-1' });

        expect(speech.speak).toHaveBeenCalledWith({ text: 'You are listening to Deadair.', voice: 'conspiracy', delivery: 'hushed' });
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
                throw new PluginError('the engine answered HTTP 500').withCode('upstream');
            },
        });

        // Not rethrown: the console is where an operator looks, and letting this bubble would spend
        // the job's one retry on a plugin that is usually still down.
        await expect(job.run({ segmentId: 'seg-1' })).resolves.toBeUndefined();
        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', 'the engine answered HTTP 500', 'rendering');
        expect(segments.releaseForRetry).not.toHaveBeenCalled();
        expect(segments.markReady).not.toHaveBeenCalled();
    });

    it('hands the claim back rather than writing the segment off when nothing could speak yet', async () => {
        // The whole of [render-plugin-readiness](https://github.com/robert-dean/deadair/discussions/29) piece 1. `unavailable` is the window
        // where no plugin is active — a boot, or any of the reinitializations every plugin config
        // change performs — and the words on the row are untouched and still correct. Writing that
        // off spends one of three render attempts on a failure that said nothing about the segment,
        // and for a break outside the running order it ends the request outright.
        const { job, segments } = harness({
            speak: async () => {
                throw new PluginError('no active plugin can speak').withCode('unavailable');
            },
        });

        await expect(job.run({ segmentId: 'seg-1' })).resolves.toBeUndefined();
        expect(segments.releaseForRetry).toHaveBeenCalledWith('seg-1', 'no active plugin can speak');
        expect(segments.markFailed).not.toHaveBeenCalled();
        expect(segments.markReady).not.toHaveBeenCalled();
    });

    it('falls back to failing the segment when the claim cannot be handed back', async () => {
        // `releaseForRetry` is conditional on `rendering`, so a row something else has already moved
        // answers false. Leaving it there would strand a row nothing owns, which is the exact
        // failure `releaseStranded` exists to clean up — so the ordinary path takes over.
        const { job, segments } = harness({
            released: false,
            speak: async () => {
                throw new PluginError('no active plugin can speak').withCode('unavailable');
            },
        });

        await expect(job.run({ segmentId: 'seg-1' })).resolves.toBeUndefined();
        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', 'no active plugin can speak', 'rendering');
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

    it("reads the analyzer's name for the figure and not the item's", async () => {
        // `integratedLufs` here, `loudnessLufs` on the item. Reading the wrong one is invisible:
        // `data` is an unread jsonb blob, so it type-checks, and the guard above then discards
        // every measurement quietly. It did, for 612 segments.
        const { job, segments } = harness({ measure: async () => ({ schemaVersion: 1, complete: true, data: { loudnessLufs: -24.5 } }) });

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

// The join. Everything here is about one rule: it makes a break BETTER and is never what stops one
// airing. `StitchProductionJob` states it as "`ready` either way"; one row down it means that every
// way the join can fail still leaves a segment with speakable audio on it.
describe('RenderSegmentJob joining a break around a soundboard hit', () => {
    const padded = () =>
        segment({
            script: 'Ambitious. [sfx:rimshot] They played it anyway.',
            pads: [{ name: 'rimshot', padId: 'pad-1' }],
        });

    it('speaks the words either side and joins them around the pad', async () => {
        const { job, speech, mixer, segments } = harness({ claimed: padded() });

        await job.run({ segmentId: 'seg-1' });

        // Two takes, and neither of them carries the marker: the engine is never handed one.
        expect(speech.speak).toHaveBeenCalledTimes(2);
        expect(speech.speak).toHaveBeenNthCalledWith(1, { text: 'Ambitious.' });
        expect(speech.speak).toHaveBeenNthCalledWith(2, { text: 'They played it anyway.' });

        // Three parts in the order the sentence put them, with the pad in the middle.
        const [, urls] = (mixer.join as unknown as { mock: { calls: [string, string[], number][] } }).mock.calls[0]!;
        expect(urls).toHaveLength(3);
        expect(urls[1]).toContain('pad-sum');

        expect(segments.markReady).toHaveBeenCalledWith('seg-1', expect.objectContaining({ audioChecksum: 'joined-checksum', audioExt: 'flac' }));
    });

    it('reads every take of one break the same way', async () => {
        // A padded break is several takes. Hushed before the drop and ordinary after it would be two
        // breaks, so the reading goes with every take, and with the fallback that speaks it whole.
        const { job, speech } = harness({ claimed: { ...padded(), delivery: 'frantic' } });

        await job.run({ segmentId: 'seg-1' });

        expect(speech.speak).toHaveBeenNthCalledWith(1, { text: 'Ambitious.', delivery: 'frantic' });
        expect(speech.speak).toHaveBeenNthCalledWith(2, { text: 'They played it anyway.', delivery: 'frantic' });

        const fallback = harness({ claimed: { ...padded(), delivery: 'frantic' }, join: async () => undefined });
        await fallback.job.run({ segmentId: 'seg-1' });
        expect(fallback.speech.speak).toHaveBeenLastCalledWith({ text: 'Ambitious. They played it anyway.', delivery: 'frantic' });
    });

    it('records what the ENGINE was handed, which never includes the pad', async () => {
        const { job, segments } = harness({ claimed: padded() });

        await job.run({ segmentId: 'seg-1' });

        const [, ready] = (segments.markReady as unknown as { mock: { calls: [string, { spokenScript: string }][] } }).mock.calls[0]!;
        expect(ready.spokenScript).not.toContain('sfx');
    });

    it('airs the words with the cue stripped when there is no mixer at all', async () => {
        // `join` answering undefined is the ordinary state of a station that has installed no mixer.
        const { job, speech, segments } = harness({ claimed: padded(), join: async () => undefined });

        await job.run({ segmentId: 'seg-1' });

        // The fallback is ONE take of the whole script, and it must not carry the marker: this is the
        // one path where the words reaching the engine are deliberately not the words on the row.
        expect(speech.speak).toHaveBeenLastCalledWith({ text: 'Ambitious. They played it anyway.' });
        expect(segments.markReady).toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
    });

    it('airs the words when the join throws rather than failing the break', async () => {
        const { job, segments } = harness({
            claimed: padded(),
            join: async () => {
                throw new Error('the sidecar is not answering');
            },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.markReady).toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
    });

    it('airs the words when the pad has been deleted since the break was written', async () => {
        const { job, mixer, segments } = harness({ claimed: padded(), padMissing: true });

        await job.run({ segmentId: 'seg-1' });

        // No pad landed, so there is nothing for a join to be FOR. Joining the two halves anyway
        // would put a silent hole mid-sentence where the drop should have been, out of two
        // separately-trimmed takes that no longer share their prosody. One take is strictly better.
        expect(mixer.join).not.toHaveBeenCalled();
        expect(segments.markReady).toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
    });

    it('does not reach for the mixer at all for the ordinary break that hits nothing', async () => {
        const { job, mixer, speech } = harness();

        await job.run({ segmentId: 'seg-1' });

        expect(mixer.join).not.toHaveBeenCalled();
        expect(speech.speak).toHaveBeenCalledTimes(1);
    });
});

// The pad as an OVERLAY rather than a part. Zero is what the station ships — a sting, the sound
// after the line — and above zero the drop lands on the last word with nothing moved.
describe('RenderSegmentJob landing a pad under the words', () => {
    const padded = () =>
        segment({
            script: 'Ambitious. [sfx:rimshot] They played it anyway.',
            pads: [{ name: 'rimshot', padId: 'pad-1' }],
        });

    const joinArgs = (mixer: unknown) =>
        (mixer as { join: { mock: { calls: [string, string[], number, { overlays?: unknown[] }][] } } }).join.mock.calls[0]!;

    it('sends the pad as a part when nothing asked for an overlay', async () => {
        const { job, mixer } = harness({ claimed: padded() });

        await job.run({ segmentId: 'seg-1' });

        const [, urls, , options] = joinArgs(mixer);
        expect(urls).toHaveLength(3);
        expect(options.overlays ?? []).toHaveLength(0);
    });

    it('sends it as an overlay anchored to the join it sits at, pulled back under the words', async () => {
        const { job, mixer } = harness({ claimed: padded(), settings: { 'render.padUnderMs': '400' } });

        await job.run({ segmentId: 'seg-1' });

        const [, urls, , options] = joinArgs(mixer);
        // Two takes only: nothing moved to make room, which is the whole difference.
        expect(urls).toHaveLength(2);
        expect(options.overlays).toEqual([{ url: expect.stringContaining('pad-sum'), afterIndex: 0, offsetMs: -400, duckDb: 0 }]);
    });

    it('still joins when the overlay leaves only one take, because there is something to mix on', async () => {
        const { job, mixer, segments } = harness({
            claimed: segment({ script: 'Ambitious. [sfx:rimshot]', pads: [{ name: 'rimshot', padId: 'pad-1' }] }),
            settings: { 'render.padUnderMs': '400' },
        });

        await job.run({ segmentId: 'seg-1' });

        // One part is not a join UNLESS something is being mixed onto it, which it is.
        expect(mixer.join).toHaveBeenCalled();
        expect(segments.markReady).toHaveBeenCalledWith('seg-1', expect.objectContaining({ audioExt: 'flac' }));
    });

    it('leaves a hit at the very start as a part, since there are no words in front of it', async () => {
        const { job, mixer } = harness({
            claimed: segment({ script: '[sfx:airhorn] Good evening.', pads: [{ name: 'airhorn', padId: 'pad-1' }] }),
            settings: { 'render.padUnderMs': '400' },
        });

        await job.run({ segmentId: 'seg-1' });

        // An overlay anchored to a join that does not exist is refused by the mixer, which would cost
        // the break its whole join rather than its timing.
        const [, urls, , options] = joinArgs(mixer);
        expect(urls).toHaveLength(2);
        expect(options.overlays ?? []).toHaveLength(0);
    });

    it('carries the duck through, and reads it as the string a config layer holds', async () => {
        const { job, mixer } = harness({ claimed: padded(), settings: { 'render.padUnderMs': '400', 'render.padDuckDb': '-6' } });

        await job.run({ segmentId: 'seg-1' });

        const [, , , options] = joinArgs(mixer);
        expect(options.overlays?.[0]).toMatchObject({ duckDb: -6 });
    });
});
