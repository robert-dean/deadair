import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getLogStore, setLogStore } from '../../src/logging/log.store.js';
import { RotatingLogStore } from '../../src/logging/rotating.log.store.js';

const tempDirs: string[] = [];
const openStores: RotatingLogStore[] = [];

afterEach(async () => {
    // Reset the process-wide holder so tests don't leak state into each other.
    setLogStore(undefined as unknown as RotatingLogStore);
    await Promise.all(openStores.splice(0).map(store => store.close()));
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function makeStore(): Promise<RotatingLogStore> {
    const root = await mkdtemp(join(tmpdir(), 'deadair-log-store-holder-test-'));
    tempDirs.push(root);
    const store = new RotatingLogStore({ root });
    openStores.push(store);
    return store;
}

describe('log.store holder', () => {
    it('returns undefined before any store has been set', () => {
        expect(getLogStore()).toBeUndefined();
    });

    it('returns the store that was set', async () => {
        const store = await makeStore();
        setLogStore(store);
        expect(getLogStore()).toBe(store);
    });

    it('reflects the most recently set store when set more than once', async () => {
        const first = await makeStore();
        const second = await makeStore();

        setLogStore(first);
        expect(getLogStore()).toBe(first);

        setLogStore(second);
        expect(getLogStore()).toBe(second);
    });
});
