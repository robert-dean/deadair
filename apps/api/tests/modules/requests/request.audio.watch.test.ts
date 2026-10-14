// The watch is plumbing between two edges, so what is pinned is the plumbing: a record kept offers the
// waiting requests again, a failure there is logged and never thrown at the fetch, and stopping
// unhooks it.

import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';

import { RequestAudioWatch } from '../../../src/modules/requests/request.audio.watch.js';
import { RequestDesk } from '../../../src/modules/requests/request.desk.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

function build(placePending: () => Promise<number>) {
    const listeners = new Set<(sourceId: string) => void>();
    const audio = {
        onKept: vi.fn((listener: (sourceId: string) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }),
    };
    const desk = { placePending: vi.fn(placePending) };
    const container = {
        createScopedContainer: () => ({
            get: (token: unknown) => (token === RequestDesk ? desk : undefined),
            disposeAsync: vi.fn(async () => undefined),
        }),
    } as unknown as Container;
    const watch = new RequestAudioWatch(container, audio as never, logger);
    const keep = (sourceId: string) => [...listeners].forEach(listener => listener(sourceId));
    return { watch, desk, keep, listeners };
}

describe('RequestAudioWatch', () => {
    it('offers the waiting requests again when a record is kept', async () => {
        const { watch, desk, keep } = build(async () => 1);
        watch.start();

        keep('s-1');

        await vi.waitFor(() => expect(desk.placePending).toHaveBeenCalledTimes(1));
    });

    it('logs a failure to place rather than throwing it at the fetch', async () => {
        const { watch, keep } = build(async () => {
            throw new Error('database gone');
        });
        watch.start();

        expect(() => keep('s-1')).not.toThrow();
        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('database gone')));
    });

    it('hooks on once, and lets go when stopped', () => {
        const { watch, listeners } = build(async () => 0);
        watch.start();
        watch.start();
        expect(listeners.size).toBe(1);

        watch.stop();
        expect(listeners.size).toBe(0);
    });
});
