import { describe, expect, it, vi } from 'vitest';

import { Plugin } from '../src/plugin.base.js';
import { isPluginError, type PluginError } from '../src/plugin.error.js';
import type { PluginHost } from '../src/plugin.host.js';

const fakeHost = () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }) as unknown as PluginHost;

class Recording extends Plugin {
    readonly order: string[] = [];
    loadError?: Error;
    unloadError?: Error;

    protected async onLoad(): Promise<void> {
        this.order.push('load');
        this.register(() => this.order.push('first'));
        this.register(() => this.order.push('second'));
        if (this.loadError) throw this.loadError;
    }

    protected async onUnload(): Promise<void> {
        this.order.push('unload');
        if (this.unloadError) throw this.unloadError;
    }

    /** Stands in for any capability method: it needs the host and nothing else. */
    whoIsMyHost(): PluginHost {
        return this.host;
    }

    registerAnything(disposer: () => void): void {
        this.register(disposer);
    }

    registerATimer(timer: ReturnType<typeof setTimeout>): void {
        this.registerTimer(timer);
    }
}

describe('Plugin', () => {
    it('makes the host available to capability methods after init', async () => {
        const plugin = new Recording();
        const host = fakeHost();

        await plugin.init(host);

        expect(plugin.whoIsMyHost()).toBe(host);
    });

    it('names itself rather than throwing a TypeError when used before init', () => {
        const plugin = new Recording();

        const error = (() => {
            try {
                plugin.whoIsMyHost();
                return undefined;
            } catch (thrown: unknown) {
                return thrown;
            }
        })();

        expect(isPluginError(error)).toBe(true);
        expect((error as PluginError).code).toBe('internal');
        expect((error as PluginError).message).toMatch(/Recording was used before init\(\) or after dispose\(\)/);
    });

    it('says the same thing after dispose, because it is the same mistake', async () => {
        const plugin = new Recording();
        await plugin.init(fakeHost());
        await plugin.dispose();

        expect(() => plugin.whoIsMyHost()).toThrow(/before init\(\) or after dispose\(\)/);
    });

    it('runs disposers last-registered-first, then onUnload', async () => {
        const plugin = new Recording();
        await plugin.init(fakeHost());

        await plugin.dispose();

        // Reverse order is what makes teardown mirror setup: a thing registered
        // after another was built on top of it.
        expect(plugin.order).toEqual(['load', 'second', 'first', 'unload']);
    });

    it('runs every disposer even when one throws, and logs the one that did', async () => {
        const plugin = new Recording();
        const host = fakeHost();
        await plugin.init(host);

        const after = vi.fn();
        plugin.registerAnything(() => {
            throw new Error('cannot let go');
        });
        plugin.registerAnything(after);

        await plugin.dispose();

        // One broken undo must not strand the rest, which is the whole reason
        // teardown lives here rather than in each plugin's own `dispose`.
        expect(after).toHaveBeenCalled();
        expect(plugin.order).toContain('unload');
        expect(host.logger.warn).toHaveBeenCalledWith('a plugin disposer failed', expect.objectContaining({ plugin: 'Recording' }));
    });

    it('clears the host even when onUnload throws', async () => {
        const plugin = new Recording();
        plugin.unloadError = new Error('nope');
        await plugin.init(fakeHost());

        await expect(plugin.dispose()).rejects.toThrow('nope');

        // Otherwise a plugin that failed on the way out would still look loaded,
        // and the next call into it would reach a host it no longer owns.
        expect(() => plugin.whoIsMyHost()).toThrow(/after dispose\(\)/);
    });

    it('is idempotent, because unload, config change and shutdown can overlap', async () => {
        const plugin = new Recording();
        await plugin.init(fakeHost());

        await plugin.dispose();
        await expect(plugin.dispose()).resolves.toBeUndefined();

        expect(plugin.order.filter(step => step === 'unload')).toHaveLength(1);
    });

    it('clears a registered timer, so a reload does not leave one running', async () => {
        vi.useFakeTimers();
        try {
            const plugin = new Recording();
            await plugin.init(fakeHost());
            const fired = vi.fn();

            plugin.registerATimer(setTimeout(fired, 1_000));
            await plugin.dispose();
            await vi.advanceTimersByTimeAsync(2_000);

            // In-process, a timer a plugin forgets outlives the plugin and keeps
            // running in the API server until somebody restarts it.
            expect(fired).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does nothing on dispose when init never ran', async () => {
        const plugin = new Recording();

        await expect(plugin.dispose()).resolves.toBeUndefined();
        expect(plugin.order).toEqual([]);
    });
});
