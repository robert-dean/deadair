// ServerKit awaits every shutdown hook in order and catches nothing, so one hook that throws or
// hangs strands every module after it AND the `process.exit()` past the end of the loop. What that
// left behind on this install was a process that would not die and went on driving its loops for
// hours, with credentials that had since been rotated.

import { describe, expect, it, vi } from 'vitest';
import type { ServerKitModule } from '@maroonedsoftware/koa';
import type { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

import { withBoundedShutdown } from '../../../src/modules/shared/shutdown.guard.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const container = { get: (token: unknown) => (token === Logger ? logger : undefined) } as unknown as Container;

/** The loop as ServerKit runs it: in order, awaited, and catching nothing of its own. */
async function shutdownAll(modules: ServerKitModule[]): Promise<string[]> {
    const finished: string[] = [];
    for (const module of modules) {
        if (!module.shutdown) continue;
        await module.shutdown(container);
        finished.push(module.name ?? '');
    }
    return finished;
}

const wrap = (modules: ServerKitModule[], budgetMs?: number) => modules.map(module => withBoundedShutdown(module, budgetMs));

describe('withBoundedShutdown', () => {
    it('lets the modules after a throwing one still tear down', async () => {
        const stopped: string[] = [];
        const modules: ServerKitModule[] = [
            { name: 'Data', shutdown: async () => void (await Promise.reject(new Error('redis went away'))) },
            { name: 'Playout', shutdown: async () => void stopped.push('Playout') },
            { name: 'Logging', shutdown: async () => void stopped.push('Logging') },
        ];

        const finished = await shutdownAll(wrap(modules));

        expect(stopped).toEqual(['Playout', 'Logging']);
        expect(finished).toEqual(['Data', 'Playout', 'Logging']);
    });

    it('gives up on one that never settles, which is the case that would not exit', async () => {
        const stopped: string[] = [];
        const modules: ServerKitModule[] = [
            // The measured shape: the hook that closed Redis and Kysely, and never came back.
            { name: 'Data', shutdown: () => new Promise<void>(() => {}) },
            { name: 'Playout', shutdown: async () => void stopped.push('Playout') },
        ];

        const finished = await shutdownAll(wrap(modules, 10));

        expect(stopped).toEqual(['Playout']);
        expect(finished).toHaveLength(2);
    });

    it('says which one it gave up on, because nothing else will', async () => {
        await shutdownAll(wrap([{ name: 'Data', shutdown: () => new Promise<void>(() => {}) }], 10));

        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('Data'));
    });

    it('does not report a hook that tore down cleanly', async () => {
        vi.mocked(logger.warn).mockClear();

        await shutdownAll(wrap([{ name: 'Playout', shutdown: async () => undefined }]));

        expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    });

    it('leaves a module with no teardown exactly as it was', () => {
        const module: ServerKitModule = { name: 'NowPlaying' };

        expect(withBoundedShutdown(module)).toBe(module);
    });

    it('swallows a rejection that arrives after the budget, which has nobody left to catch it', async () => {
        // An abandoned hook still rejects eventually. Unhandled, that is a crash one line short of
        // a clean exit — and it lands during shutdown, where it is hardest to attribute.
        let reject: (error: Error) => void = () => {};
        const modules: ServerKitModule[] = [{ name: 'Data', shutdown: () => new Promise<void>((_, no) => (reject = no)) }];

        await shutdownAll(wrap(modules, 10));
        reject(new Error('closed after we stopped waiting'));

        await expect(Promise.resolve()).resolves.toBeUndefined();
    });
});
