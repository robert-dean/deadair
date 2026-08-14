// What one pass does to one track, and what it does when it cannot.
//
// The through-line is that almost nothing here is an error. A station with no analyzer, a track
// whose provider is between reloads, a file that will not decode -- all of them are states the walk
// carries on through, because an unmeasured track still plays. The two things it must NOT do are
// take a track out of the queue for a day over a transient problem, and pay for the same failed
// decode on every pass forever. Those pull in opposite directions and the split between them is the
// substance of the file.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { ANALYSIS_SCHEMA_VERSION, PluginError, type TrackAnalysis } from '@deadair/plugin-sdk';

import { AnalysisService } from '../../../src/modules/analysis/analysis.service.js';
import type { AnalysableTrack } from '../../../src/modules/analysis/analysis.repository.js';

const stubLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const track = (n: number): AnalysableTrack => ({
    trackId: `track-${n}`,
    title: `Track ${n}`,
    artistName: 'An Artist',
    pluginId: 'deadair.spotify',
    externalId: `spotify-${n}`,
    durationMs: 214_000,
});

const measurement = (overrides: Partial<TrackAnalysis> = {}): TrackAnalysis => ({
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    complete: true,
    data: { cueIn: 180, introEnd: 12_400, outroStart: 198_200, cueOut: 213_600 },
    analyzer: 'deadair-analysis/0.1.0',
    ...overrides,
});

interface HarnessOptions {
    /** Plugins the registry reports as analysis-capable. */
    analyzers?: string[];
    /** `analysis.pluginId`. */
    configured?: string;
    /** `analysis.concurrency`. */
    concurrency?: number;
    /** `analysis.providerPaceMs`. Zero by default, so an ordinary test does not wait on anything. */
    providerPaceMs?: number;
    /** `analysis.localPaceMs`. Zero by default, for the same reason. */
    localPaceMs?: number;
    pending?: AnalysableTrack[];
    /** What `analyzeTrack` does. Default: a good measurement. */
    analyze?: (ref: { trackId: string }) => Promise<TrackAnalysis>;
    /** What the station's audio route answers for a binding. Default: a URL for everything. */
    resolveUrl?: (pluginId: string, externalId: string) => Promise<string | undefined>;
    /** Whether `TrackAudioService.has` reports a binding as already on this machine. Default: no. */
    hasLocalAudio?: (pluginId: string, externalId: string) => Promise<boolean>;
}

function build(options: HarnessOptions = {}) {
    const analyzerIds = options.analyzers ?? ['deadair.analyzer'];

    const analyzeTrack = vi.fn(options.analyze ?? (async () => measurement()));
    const recordAnalysis = vi.fn(async () => {});
    const recordFailure = vi.fn(async () => {});

    // Every id gets an instance; `asAnalysisPlugin` checks status, manifest and method.
    const records = analyzerIds.map(id => ({
        id,
        status: 'active',
        manifest: { id, capabilities: ['analysis'] },
        instance: { analyzeTrack },
    }));

    const repository = {
        listTracksNeedingAnalysis: vi.fn(async () => options.pending ?? [track(1)]),
        recordAnalysis,
        recordFailure,
    };

    const registry = { list: () => records };

    const invoker = {
        // The real invoker wraps in a deadline and flattens errors; what matters here is
        // that the service goes through it at all and that a rejection reaches the catch.
        invoke: vi.fn(async (_id: string, _op: string, fn: () => Promise<unknown>) => fn()),
    };

    // The station's own audio route. Self-sufficient by construction: it answers a URL for any
    // playable binding, and the fetch behind it pulls the record from the provider if the station has
    // not got it yet, so there is nothing for the walk to fall back to.
    const trackAudio = {
        resolveBinding: vi.fn(options.resolveUrl ?? (async () => 'http://station.test/playout/audio/source-1')),
    };

    // What tells the walk a track needs no provider fetch. Not local by default, matching the
    // provider-pace behaviour every test wrote against before locality existed.
    const audioService = {
        has: vi.fn(options.hasLocalAudio ?? (async () => false)),
    };

    const config = {
        get: vi.fn((key: string, fallback: unknown) => {
            if (key === 'analysis.pluginId') return options.configured ?? '';
            if (key === 'analysis.concurrency') return options.concurrency ?? 1;
            if (key === 'analysis.providerPaceMs') return options.providerPaceMs ?? 0;
            if (key === 'analysis.localPaceMs') return options.localPaceMs ?? 0;
            return fallback;
        }),
    } as unknown as AppConfig;

    const logger = stubLogger();

    const service = new AnalysisService(
        repository as never,
        registry as never,
        invoker as never,
        trackAudio as never,
        audioService as never,
        config,
        logger,
    );

    return { service, repository, registry, invoker, trackAudio, audioService, logger, analyzeTrack, recordAnalysis, recordFailure };
}

describe('choosing an analyzer', () => {
    it('does nothing, quietly, when no plugin can measure', async () => {
        // An ordinary state, not a fault: every track still plays, unmeasured.
        const { service, repository, logger } = build({ analyzers: [] });

        expect(await service.analysePending(50, undefined)).toEqual({ scanned: 0, measured: 0, failed: 0, incomplete: 0 });
        expect(repository.listTracksNeedingAnalysis).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(vi.mocked(logger.info).mock.calls[0]?.[1]).toMatchObject({ reason: expect.stringContaining('install and enable') });
    });

    it('refuses to guess between several and says which they are', async () => {
        const { service, logger } = build({ analyzers: ['deadair.analyzer', 'other.analyzer'] });

        expect((await service.analysePending(50, undefined)).scanned).toBe(0);
        expect(vi.mocked(logger.info).mock.calls[0]?.[1]).toMatchObject({
            reason: expect.stringContaining('deadair.analyzer, other.analyzer'),
        });
    });

    it('does not fall back when the named analyzer is not running', async () => {
        const { service, logger } = build({ analyzers: ['deadair.analyzer'], configured: 'gone.analyzer' });

        expect((await service.analysePending(50, undefined)).scanned).toBe(0);
        expect(vi.mocked(logger.info).mock.calls[0]?.[1]).toMatchObject({ reason: expect.stringContaining('gone.analyzer') });
    });
});

describe('measuring a track', () => {
    it('asks for the current schema version, so a stale row is picked up', async () => {
        const { service, repository } = build();
        await service.analysePending(50, undefined);

        expect(repository.listTracksNeedingAnalysis).toHaveBeenCalledWith(ANALYSIS_SCHEMA_VERSION, 50);
    });

    it('resolves the audio itself and hands the analyzer a url', async () => {
        // A plugin cannot ask another plugin for a stream URL, so this is the host's job.
        const { service, trackAudio, analyzeTrack } = build();
        await service.analysePending(50, undefined);

        expect(trackAudio.resolveBinding).toHaveBeenCalledWith('deadair.spotify', 'spotify-1');
        expect(analyzeTrack).toHaveBeenCalledWith({
            trackId: 'track-1',
            audioUrl: 'http://station.test/playout/audio/source-1',
            durationMs: 214_000,
        });
    });

    // The measurement and the play now read the same bytes through the same URL, which is what stops a
    // provider re-encode putting the cue points out.
    it('measures through the station route rather than a provider url', async () => {
        const { service, analyzeTrack } = build();
        await service.analysePending(50, undefined);

        expect(analyzeTrack).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: expect.stringContaining('/playout/audio/') }));
    });

    it('stores the measurement against the analyzer that made it', async () => {
        const { service, recordAnalysis } = build();
        const summary = await service.analysePending(50, undefined);

        expect(recordAnalysis).toHaveBeenCalledWith('track-1', 'deadair.analyzer', measurement());
        expect(summary).toEqual({ scanned: 1, measured: 1, failed: 0, incomplete: 0 });
    });

    it('stores an incomplete measurement but counts and logs it', async () => {
        // Stored and then ignored by every reader, so a station where this is common is doing
        // the work and getting nothing, with nothing else to say so.
        const { service, recordAnalysis, logger } = build({ analyze: async () => measurement({ complete: false }) });
        const summary = await service.analysePending(50, undefined);

        expect(recordAnalysis).toHaveBeenCalled();
        expect(summary).toMatchObject({ measured: 1, incomplete: 1 });
        expect(logger.warn).toHaveBeenCalledWith('analysis: measured only part of a file', expect.anything());
    });
});

describe('when a track cannot be measured', () => {
    it('records a failure so the next pass does not pay for the same decode', async () => {
        const { service, recordFailure, recordAnalysis } = build({
            analyze: async () => {
                throw new PluginError('moov atom not found').withCode('upstream');
            },
        });

        const summary = await service.analysePending(50, undefined);

        expect(recordAnalysis).not.toHaveBeenCalled();
        expect(recordFailure).toHaveBeenCalledWith('track-1', 'deadair.analyzer', expect.stringContaining('moov atom'));
        expect(summary).toMatchObject({ scanned: 1, failed: 1, measured: 0 });
    });

    it('does NOT record a failure when there is simply no audio url', async () => {
        // Nothing about the track is wrong -- its provider is disabled, unconfigured or between
        // reloads. Writing a failure would take it out of the queue for a day over something
        // that may be fixed in a minute.
        const { service, recordFailure, analyzeTrack } = build({ resolveUrl: async () => undefined });
        const summary = await service.analysePending(50, undefined);

        expect(recordFailure).not.toHaveBeenCalled();
        expect(analyzeTrack).not.toHaveBeenCalled();
        expect(summary).toMatchObject({ scanned: 1, measured: 0, failed: 0 });
    });

    it('carries on through a failure rather than abandoning the batch', async () => {
        const analyze = vi.fn(async (ref: { trackId: string }) => {
            if (ref.trackId === 'track-2') throw new PluginError('nope').withCode('upstream');
            return measurement();
        });
        const { service } = build({ pending: [track(1), track(2), track(3)], analyze });

        expect(await service.analysePending(50, undefined)).toEqual({ scanned: 3, measured: 2, failed: 1, incomplete: 0 });
    });

    it('survives a failure-write that itself fails, leaving the track outstanding', async () => {
        const { service, recordFailure, logger } = build({
            analyze: async () => {
                throw new Error('boom');
            },
        });
        recordFailure.mockRejectedValueOnce(new Error('database is gone'));

        // The same state it was in a moment ago, rather than an exception out of the pass.
        await expect(service.analysePending(50, undefined)).resolves.toMatchObject({ failed: 1 });
        expect(logger.error).toHaveBeenCalledWith('analysis: could not record a failure', expect.anything());
    });
});

describe('the walk itself', () => {
    it('measures one at a time by default', async () => {
        let inFlight = 0;
        let peak = 0;
        const analyze = vi.fn(async () => {
            peak = Math.max(peak, ++inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight -= 1;
            return measurement();
        });

        const { service } = build({ pending: [track(1), track(2), track(3), track(4)], analyze });
        await service.analysePending(50, undefined);

        expect(peak).toBe(1);
    });

    it('runs up to `analysis.concurrency` at once', async () => {
        let inFlight = 0;
        let peak = 0;
        const analyze = vi.fn(async () => {
            peak = Math.max(peak, ++inFlight);
            await new Promise(resolve => setTimeout(resolve, 5));
            inFlight -= 1;
            return measurement();
        });

        const pending = Array.from({ length: 8 }, (_, index) => track(index));
        const { service } = build({ pending, concurrency: 3, analyze });
        const summary = await service.analysePending(50, undefined);

        expect(peak).toBe(3);
        expect(summary.measured).toBe(8);
    });

    it('never opens more workers than there is work', async () => {
        const { service, analyzeTrack } = build({ pending: [track(1)], concurrency: 8 });
        await service.analysePending(50, undefined);

        expect(analyzeTrack).toHaveBeenCalledTimes(1);
    });

    it('stops between tracks when the budget expires, rather than mid-decode', async () => {
        const controller = new AbortController();
        const analyze = vi.fn(async () => {
            // Abort during the first measurement. The one in flight still completes --
            // it is paid for either way -- and nothing after it starts.
            controller.abort();
            return measurement();
        });

        const { service } = build({ pending: [track(1), track(2), track(3)], analyze });
        const summary = await service.analysePending(50, controller.signal);

        expect(summary.scanned).toBe(1);
        expect(summary.measured).toBe(1);
    });

    it('does no work at all when the signal is already aborted', async () => {
        const { service, analyzeTrack } = build({ pending: [track(1), track(2)] });
        const summary = await service.analysePending(50, AbortSignal.abort());

        expect(analyzeTrack).not.toHaveBeenCalled();
        expect(summary.scanned).toBe(0);
    });
});

describe('pacing', () => {
    // Measuring a track is a FULL AUDIO DOWNLOAD through the credential the station plays on.
    // A burst of them exhausted a provider's audio-key quota once and took the station off air:
    // zero key failures before that run, ninety after. These pin the protection.

    it('waits between tracks so a run is a trickle rather than a burst', async () => {
        vi.useFakeTimers();
        try {
            const { service, analyzeTrack } = build({ pending: [track(1), track(2), track(3)] });
            const run = service.analysePending(50, undefined, { providerPaceMs: 60_000, localPaceMs: 60_000 });

            await vi.advanceTimersByTimeAsync(0);
            expect(analyzeTrack).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(60_000);
            expect(analyzeTrack).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(60_000);
            expect(analyzeTrack).toHaveBeenCalledTimes(3);

            await run;
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not pad the end of a run with a wait nobody is waiting for', async () => {
        vi.useFakeTimers();
        try {
            const { service } = build({ pending: [track(1)] });
            const run = service.analysePending(50, undefined, { providerPaceMs: 60_000, localPaceMs: 60_000 });

            // One track, so there is nothing after it to be polite to.
            await vi.advanceTimersByTimeAsync(0);
            await expect(run).resolves.toMatchObject({ scanned: 1 });
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops waiting the moment the run is aborted', async () => {
        vi.useFakeTimers();
        try {
            const controller = new AbortController();
            const { service, analyzeTrack } = build({ pending: [track(1), track(2), track(3)] });
            const run = service.analysePending(50, controller.signal, { providerPaceMs: 60_000, localPaceMs: 60_000 });

            await vi.advanceTimersByTimeAsync(0);
            controller.abort();
            await run;

            // The budget expiring must not leave the walk parked in a timer for a minute.
            expect(analyzeTrack).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('checks a track for local audio before resolving its url, with the binding rather than a source id', async () => {
        const { service, audioService } = build();
        await service.analysePending(50, undefined);

        expect(audioService.has).toHaveBeenCalledWith({ pluginId: 'deadair.spotify', externalId: 'spotify-1' });
    });

    it('paces a track already on this machine by the local rate, never the download one', async () => {
        vi.useFakeTimers();
        try {
            const { service, analyzeTrack } = build({
                pending: [track(1), track(2), track(3)],
                hasLocalAudio: async () => true,
                providerPaceMs: 60_000,
                localPaceMs: 1_000,
            });
            const run = service.analysePending(50, undefined);

            await vi.advanceTimersByTimeAsync(0);
            expect(analyzeTrack).toHaveBeenCalledTimes(1);

            // The download pace would still be waiting here; the local one is not.
            await vi.advanceTimersByTimeAsync(1_000);
            expect(analyzeTrack).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(1_000);
            expect(analyzeTrack).toHaveBeenCalledTimes(3);

            await run;
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not charge the download pace for a track with no audio url, since nothing was fetched', async () => {
        vi.useFakeTimers();
        try {
            const { service, analyzeTrack } = build({
                pending: [track(1), track(2)],
                resolveUrl: async () => undefined,
                providerPaceMs: 60_000,
                localPaceMs: 250,
            });
            const run = service.analysePending(50, undefined);

            await vi.advanceTimersByTimeAsync(0);
            // A skip is instant, so nothing has been "measured", but the walk still moved on to the
            // next track after only the local pace rather than the download one.
            await vi.advanceTimersByTimeAsync(250);

            const summary = await run;
            expect(summary).toMatchObject({ scanned: 2, measured: 0 });
            expect(analyzeTrack).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('falls back to the download pace when the local-audio check itself fails', async () => {
        // A caller that cannot tell must not assume the cheaper case: the pace this protects
        // exists for a provider's limiter, and the safe default when the answer is unknown is
        // the one that respects it.
        vi.useFakeTimers();
        try {
            const { service, analyzeTrack } = build({
                pending: [track(1), track(2)],
                hasLocalAudio: async () => {
                    throw new Error('boom');
                },
                providerPaceMs: 500,
                localPaceMs: 60_000,
            });
            const run = service.analysePending(50, undefined);

            await vi.advanceTimersByTimeAsync(0);
            expect(analyzeTrack).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(500);
            expect(analyzeTrack).toHaveBeenCalledTimes(2);

            await run;
        } finally {
            vi.useRealTimers();
        }
    });
});
