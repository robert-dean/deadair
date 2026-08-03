import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { PLUGIN_FAILURE_THRESHOLD, PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

// No collaborator beyond the registry (pure in-memory bookkeeping, safe to use for real)
// and a stub logger: the invoker's own timeout/breaker logic is what's under test.
const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

function record(overrides: Partial<PluginRecord> = {}): PluginRecord {
    return { id: 'p', dir: '/plugins/p', status: 'active', ...overrides };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('PluginInvoker.invoke', () => {
    it('aborts a hung call at the timeout and records it as a failure', async () => {
        vi.useFakeTimers();
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        let sawAbort = false;
        const hung = (signal: AbortSignal) =>
            new Promise<void>((_resolve, reject) => {
                signal.addEventListener('abort', () => {
                    sawAbort = true;
                    reject(new Error('abandoned'));
                });
            });

        const promise = invoker.invoke('p', 'op', hung, { timeoutMs: 1_000 });
        const assertion = expect(promise).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(1_000);
        await assertion;

        expect(sawAbort).toBe(true);
        expect(registry.get('p')?.error).toBeDefined();
    });

    it('captures a synchronous throw: invoke rejects with a useful message, op name recorded, process unharmed', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const throwing = () => {
            throw new Error('boom');
        };

        await expect(invoker.invoke('p', 'catalog.search', throwing)).rejects.toThrow(/plugin p failed during catalog\.search: boom/);
        expect(registry.get('p')?.error).toBe('catalog.search: boom');

        // Process unharmed: a subsequent call still runs normally.
        await expect(invoker.invoke('p', 'catalog.search', async () => 'ok')).resolves.toBe('ok');
    });

    it('trips the breaker after threshold consecutive failures and short-circuits further invokes', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const throwing = vi.fn(() => {
            throw new Error('down');
        });

        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD; i++) {
            await expect(invoker.invoke('p', 'op', throwing)).rejects.toThrow();
        }

        expect(invoker.isBreakerOpen('p')).toBe(true);
        expect(registry.get('p')?.status).toBe('failed');

        const calls = throwing.mock.calls.length;
        await expect(invoker.invoke('p', 'op', throwing)).rejects.toThrow(/is failed/);
        expect(throwing.mock.calls.length).toBe(calls);
    });

    it('resets the failure count on a success before the threshold is reached', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const throwing = () => {
            throw new Error('flaky');
        };

        // One short of the threshold, then a success, then one more short of the threshold again:
        // the breaker must not have opened.
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
            await expect(invoker.invoke('p', 'op', throwing)).rejects.toThrow();
        }
        await expect(invoker.invoke('p', 'op', async () => 'ok')).resolves.toBe('ok');
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
            await expect(invoker.invoke('p', 'op', throwing)).rejects.toThrow();
        }

        expect(invoker.isBreakerOpen('p')).toBe(false);
    });

    it('reset() closes the breaker and forgets the failure count', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const throwing = () => {
            throw new Error('down');
        };
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD; i++) {
            await expect(invoker.invoke('p', 'op', throwing)).rejects.toThrow();
        }
        expect(invoker.isBreakerOpen('p')).toBe(true);

        invoker.reset('p');

        expect(invoker.isBreakerOpen('p')).toBe(false);
        await expect(invoker.invoke('p', 'op', async () => 'ok')).resolves.toBe('ok');
    });
});
