// The job around the fetch: that it passes the binding and the runner's signal through, that a send
// carrying nothing is a logged bug rather than a throw, and that a record it got is sent on to be
// measured when, and only when, the station has an analyzer in use. Everything about what a fetch
// does lives in the service and is tested there.

import { Container } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import type { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { CacheTrackJob } from '../../../../src/modules/playout/audio/cache.track.job.js';
import type { TrackAudioService } from '../../../../src/modules/playout/audio/track.audio.service.js';
import type { PluginRegistry } from '../../../../src/modules/plugins/plugin.registry.js';

vi.mock('#modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

interface HarnessOptions {
    /** What the fetch answers. Default: the record is here. */
    got?: boolean;
    /** Analysis plugins as the registry reports them. Default: one, running. */
    analyzers?: Array<{ id: string; status: string }>;
    /** `analysis.pluginId`. Default: unset. */
    configured?: string;
    /** What the broker's send does. Default: queues it. */
    send?: () => Promise<string>;
}

const harness = (options: HarnessOptions = {}) => {
    const warm = vi.fn(async () => options.got ?? true);
    const send = vi.fn(options.send ?? (async () => 'job-2'));
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;

    // `asAnalysisPlugin` reads the status, the declared capability and the method, so a record here
    // is what an installed analyzer looks like to the station.
    const records = (options.analyzers ?? [{ id: 'deadair.analyzer', status: 'active' }]).map(({ id, status }) => ({
        id,
        status,
        manifest: { id, capabilities: ['analysis'] },
        instance: { analyzeTrack: vi.fn() },
    }));
    const plugins = { list: () => records } as unknown as PluginRegistry;
    const config = {
        get: (key: string, fallback: unknown) => (key === 'analysis.pluginId' ? (options.configured ?? '') : fallback),
    } as unknown as AppConfig;

    const job = new CacheTrackJob(
        { warm } as unknown as TrackAudioService,
        { send } as unknown as PgBossJobBroker,
        plugins,
        config,
        context,
        container,
        logger,
    );

    return { job, warm, send, warn };
};

describe('CacheTrackJob', () => {
    it('hands the binding and the cancellation it was given to the audio service', async () => {
        const controller = new AbortController();
        const { job, warm } = harness();

        await job.run({ sourceId: 'source-1' }, controller.signal);

        expect(warm).toHaveBeenCalledWith('source-1', controller.signal);
    });

    it.each([
        ['nothing at all', undefined],
        ['an empty object', {}],
    ])('says a send carrying %s was a caller bug and fetches nothing', async (_, payload) => {
        const { job, warm, warn, send } = harness();

        await job.run(payload);

        expect(warm).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no binding'), { job: 'job-1' });
    });

    // A failed fetch is data the service put on the row. Rethrowing would spend the broker's one
    // retry on a provider that is usually still refusing, and the request that actually needs the
    // record is the better retry anyway.
    it('does not fail the job when the record could not be had', async () => {
        const { job } = harness({ got: false });

        await expect(job.run({ sourceId: 'source-1' })).resolves.toBeUndefined();
    });
});

describe('CacheTrackJob asking for a measurement', () => {
    it('sends the binding it got to be measured', async () => {
        const { job, send } = harness();

        await job.run({ sourceId: 'source-1' });

        expect(send).toHaveBeenCalledWith('catalog.analyze_track', { sourceId: 'source-1' });
    });

    it('asks for nothing when the record could not be had', async () => {
        const { job, send } = harness({ got: false });

        await job.run({ sourceId: 'source-1' });

        expect(send).not.toHaveBeenCalled();
    });

    it('asks for nothing when the run was stopped', async () => {
        const controller = new AbortController();
        controller.abort();
        const { job, send } = harness();

        await job.run({ sourceId: 'source-1' }, controller.signal);

        expect(send).not.toHaveBeenCalled();
    });

    // A missing analyzer must cost nothing: no job, no error, no log line.
    it.each([
        ['none installed', { analyzers: [] }],
        ['the only one quarantined', { analyzers: [{ id: 'deadair.analyzer', status: 'failed' }] }],
        ['the chosen one not running', { configured: 'other.analyzer' }],
    ] satisfies Array<[string, HarnessOptions]>)('asks for nothing with %s', async (_, options) => {
        const { job, send, warn } = harness(options);

        await job.run({ sourceId: 'source-1' });

        expect(send).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });

    it('keeps the fetch when the measurement could not be asked for', async () => {
        const { job, warn } = harness({
            send: async () => {
                throw new Error('the queue is down');
            },
        });

        await expect(job.run({ sourceId: 'source-1' })).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('measured'), expect.objectContaining({ source: 'source-1' }));
    });
});
