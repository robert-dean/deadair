// Which plugin joins the station's audio, and what happens when none can.
//
// The through-line is the one `AnalysisService`'s tests have: almost nothing here is an error. A
// station with no mixer and a join that threw both answer `undefined`, and the caller's response to
// both is the same -- a production airs as its separate beats, which is what it did before anything
// could join them.
//
// The case this file exists for is the last one: the mixer and the analyzer are two PICKS. Joining
// was an optional method on the analysis capability for one commit, which made the station's joiner
// whichever plugin the operator chose to MEASURE with.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { MixerService } from '../../../src/modules/render/mixer.service.js';
import { resetDefaultPickReports } from '../../../src/modules/plugins/plugin.selection.js';

const stubLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const joined = () => ({ mime: 'audio/flac', audio: new Response(new Uint8Array([1, 2, 3])).body!, durationMs: 184_320 });

interface HarnessOptions {
    /** Plugins the registry reports, as `[id, capabilities]`. Default: the bundled adapter, doing both. */
    plugins?: Array<[string, string[]]>;
    /** `render.mixerPluginId`. */
    configured?: string;
    /** What `join` does. Default: a good piece of audio. */
    join?: () => Promise<unknown>;
}

function build(options: HarnessOptions = {}) {
    resetDefaultPickReports();

    const join = vi.fn(options.join ?? (async () => joined()));
    const analyzeTrack = vi.fn(async () => ({ schemaVersion: 1, complete: true, data: {} }));

    // Every plugin carries BOTH methods and is told apart only by what it DECLARES, which is the
    // rule `plugin.capabilities.ts` is built on: a manifest is a promise, and the declaration is what
    // the host dispatches on.
    const records = (options.plugins ?? [['deadair.analyzer', ['analysis', 'mixer']]]).map(([id, capabilities]) => ({
        id,
        status: 'active',
        manifest: { id, capabilities },
        instance: { join, analyzeTrack },
    }));

    const registry = { list: () => records };

    const invoker = {
        invoke: vi.fn(async (_id: string, _op: string, fn: () => Promise<unknown>) => fn()),
    };

    const config = {
        get: vi.fn((key: string, fallback: unknown) => (key === 'render.mixerPluginId' ? (options.configured ?? '') : fallback)),
    } as unknown as AppConfig;

    const logger = stubLogger();
    const service = new MixerService(registry as never, invoker as never, config, logger);

    return { service, join, invoker, logger };
}

describe('MixerService.join', () => {
    it('joins through the chosen plugin, with the parts in the order it was given', async () => {
        const { service, join, invoker } = build();

        const result = await service.join('Late line', ['http://station.test/a', 'http://station.test/b'], 200);

        expect(result?.mime).toBe('audio/flac');
        expect(join).toHaveBeenCalledWith({
            parts: [{ url: 'http://station.test/a' }, { url: 'http://station.test/b' }],
            gapMs: 200,
        });
        // Through the invoker, which is what bounds the call and flattens whatever it throws.
        expect(invoker.invoke).toHaveBeenCalledWith('deadair.analyzer', 'mixer.join', expect.any(Function), expect.anything());
    });

    it('answers undefined with a reason when nothing can join, rather than throwing', async () => {
        // An ordinary state, not a fault: the production airs as its beats.
        const { service, logger } = build({ plugins: [['deadair.analyzer', ['analysis']]] });

        expect(await service.join('Late line', ['http://station.test/a'], 200)).toBeUndefined();
        expect(logger.info).toHaveBeenCalledWith('render: nothing to join audio with', expect.objectContaining({ reason: expect.stringContaining('mixer') }));
    });

    it('answers undefined when the join throws, and says so', async () => {
        const { service, logger } = build({
            join: async () => {
                throw new Error('the sidecar fell over');
            },
        });

        expect(await service.join('Late line', ['http://station.test/a'], 200)).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith('render: could not join audio', expect.objectContaining({ label: 'Late line', parts: 1 }));
    });

    it('refuses a configured plugin that cannot join, rather than falling back to one that can', async () => {
        // An instruction, where an unset key is a default. Quietly using a different plugin is how a
        // station ends up wrong with nothing in the log.
        const { service, join } = build({
            plugins: [
                ['deadair.analyzer', ['analysis', 'mixer']],
                ['deadair.measure-only', ['analysis']],
            ],
            configured: 'deadair.measure-only',
        });

        expect(await service.join('Late line', ['http://station.test/a'], 200)).toBeUndefined();
        expect(join).not.toHaveBeenCalled();
    });
});

describe('MixerService.mixer', () => {
    it('takes the first candidate in id order when the key is unset, and says which', async () => {
        // Sorted rather than in whatever order the disk scan found, or a station with two mixers
        // could join with a different one after a restart and nothing would say so.
        const { service, logger } = build({
            plugins: [
                ['deadair.zephyr', ['mixer']],
                ['deadair.analyzer', ['analysis', 'mixer']],
            ],
        });

        expect(service.mixer()?.record.id).toBe('deadair.analyzer');
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('deadair.zephyr'));
    });

    it('says nothing about a default pick when there is only one candidate', async () => {
        // Not a decision anybody needs telling about, and `mixer()` runs often enough that a line
        // per call would be noise.
        const { service, logger } = build();

        expect(service.mixer()?.record.id).toBe('deadair.analyzer');
        expect(logger.info).not.toHaveBeenCalled();
    });

    // THE regression test for the split. Before it, `joinAudio` was reached through the analysis
    // pick, so naming a measure-only analyzer took joining away from the station entirely.
    it('is chosen independently of the analyzer, so a station can measure with one and join with another', async () => {
        const { service, invoker } = build({
            plugins: [
                ['deadair.analyzer', ['analysis']],
                ['deadair.joiner', ['mixer']],
            ],
        });

        expect(service.mixer()?.record.id).toBe('deadair.joiner');

        await service.join('Late line', ['http://station.test/a'], 200);
        expect(invoker.invoke).toHaveBeenCalledWith('deadair.joiner', 'mixer.join', expect.any(Function), expect.anything());
    });
});
