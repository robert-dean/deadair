import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoggingModule } from '../../src/logging/logging.module.js';
import { RotatingLogStore } from '../../src/logging/rotating.log.store.js';

const tempDirs: string[] = [];
const openStores: RotatingLogStore[] = [];

afterEach(async () => {
    await Promise.all(openStores.splice(0).map((store) => store.close()));
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    vi.restoreAllMocks();
});

async function makeStore(): Promise<{ store: RotatingLogStore; root: string }> {
    const root = await mkdtemp(join(tmpdir(), 'deadair-logging-module-test-'));
    tempDirs.push(root);
    const store = new RotatingLogStore({ root });
    openStores.push(store);
    return { store, root };
}

function fakeLogger(): Logger {
    return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

/** A minimal container that resolves exactly the two tokens `LoggingModule.shutdown` reaches for. */
function fakeContainer(logger: Logger, store: RotatingLogStore): Container {
    const map = new Map<unknown, unknown>([
        [Logger, logger],
        [RotatingLogStore, store],
    ]);
    return {
        get: <T>(id: unknown): T => {
            if (!map.has(id)) throw new Error(`fakeContainer: no registration for ${String(id)}`);
            return map.get(id) as T;
        },
    } as unknown as Container;
}

describe('LoggingModule', () => {
    it('has no setup hook: the store is built in setup.server.ts, not by this module', () => {
        expect(LoggingModule.setup).toBeUndefined();
    });

    it('closes the process RotatingLogStore on shutdown', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'before shutdown');
        const container = fakeContainer(fakeLogger(), store);

        await LoggingModule.shutdown?.(container);

        // close() is terminal for the stream cache even though a post-close
        // append still lands in the file via the synchronous fallback path
        // (see RotatingLogStore.appendSyncAfterClose), so an empty stream
        // cache is the observable proxy for "close() actually ran".
        store.append(undefined, 'info', 'after shutdown');
        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain('before shutdown');
        expect(raw).toContain('after shutdown');

        const streams = (store as unknown as { streams: Map<string, unknown> }).streams;
        expect(streams.size).toBe(0);
    });

    it('is safe to call twice, mirroring RotatingLogStore.close being idempotent', async () => {
        const { store } = await makeStore();
        const container = fakeContainer(fakeLogger(), store);

        await LoggingModule.shutdown?.(container);
        await expect(LoggingModule.shutdown?.(container)).resolves.toBeUndefined();
    });

    it('logs a warning instead of throwing when the store fails to close cleanly', async () => {
        const logger = fakeLogger();
        const failingStore = { close: vi.fn().mockRejectedValue(new Error('disk gone')) } as unknown as RotatingLogStore;
        const container = fakeContainer(logger, failingStore);

        await expect(LoggingModule.shutdown?.(container)).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith('log store did not close cleanly', { error: 'disk gone' });
    });

    it('stringifies a non-Error rejection from close() instead of losing it', async () => {
        const logger = fakeLogger();
        const failingStore = { close: vi.fn().mockRejectedValue('disk gone') } as unknown as RotatingLogStore;
        const container = fakeContainer(logger, failingStore);

        await LoggingModule.shutdown?.(container);
        expect(logger.warn).toHaveBeenCalledWith('log store did not close cleanly', { error: 'disk gone' });
    });
});
