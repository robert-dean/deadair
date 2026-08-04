import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, isPluginError } from '@deadair/plugin-sdk';

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

    it('quarantines on the first failure the plugin declared non-retryable, without spending two more round trips', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const throwing = vi.fn(() => {
            throw new PluginError('auth', 'token expired');
        });

        await expect(invoker.invoke('p', 'oauth.getAuthorizeUrl', throwing)).rejects.toThrow(/token expired/);

        expect(invoker.isBreakerOpen('p')).toBe(true);
        expect(registry.get('p')?.status).toBe('failed');
        expect(throwing.mock.calls.length).toBe(1);
    });

    it('never quarantines on resource-scoped failures, however many arrive', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        // Opening ten Spotify playlists the account does not own is ordinary
        // use, not a sick plugin. Counting these took the whole integration
        // down on the third click.
        const throwing = () => {
            throw new PluginError('forbidden', 'not your playlist');
        };

        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD * 3; i++) {
            await expect(invoker.invoke('p', 'catalog.getPlaylistTracks', throwing)).rejects.toThrow(/not your playlist/);
        }

        expect(invoker.isBreakerOpen('p')).toBe(false);
        expect(registry.get('p')?.status).not.toBe('failed');
    });

    it('does not let a resource-scoped failure clear the count of real ones either', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const unavailable = () => {
            throw new PluginError('unavailable', 'upstream down');
        };
        const forbidden = () => {
            throw new PluginError('forbidden', 'not your playlist');
        };

        // A refusal is not evidence in either direction, so it must not act as
        // a success and reset the breaker's progress toward tripping.
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
            await expect(invoker.invoke('p', 'op', unavailable)).rejects.toThrow();
        }
        await expect(invoker.invoke('p', 'op', forbidden)).rejects.toThrow();
        expect(invoker.isBreakerOpen('p')).toBe(false);

        await expect(invoker.invoke('p', 'op', unavailable)).rejects.toThrow();
        expect(invoker.isBreakerOpen('p')).toBe(true);
    });

    it('still gives a retryable PluginError the full threshold', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const throwing = () => {
            throw new PluginError('upstream', 'bad gateway');
        };

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

/**
 * The classification is the whole point of routing plugin failures through
 * `PluginError`: if it does not survive the invoker, the service can only
 * answer 500 and a message string.
 */
describe('PluginInvoker error classification', () => {
    const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
        try {
            await promise;
            return undefined;
        } catch (error) {
            return isPluginError(error) ? error.code : `not a PluginError: ${String(error)}`;
        }
    };

    it('carries the plugin\'s own code out through the wrapper', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const code = await codeOf(
            invoker.invoke('p', 'op', () => {
                throw new PluginError('rate_limited', 'slow down', { retryAfterMs: 30_000 });
            }),
        );

        expect(code).toBe('rate_limited');
    });

    it('keeps the retry advice attached, so a 429 can be answered with a Retry-After', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        await invoker
            .invoke('p', 'op', () => {
                throw new PluginError('rate_limited', 'slow down', { retryAfterMs: 30_000, upstreamStatus: 429 });
            })
            .catch((error: unknown) => {
                expect(isPluginError(error)).toBe(true);
                const pluginError = error as PluginError;
                expect(pluginError.retryAfterMs).toBe(30_000);
                expect(pluginError.upstreamStatus).toBe(429);
                expect(pluginError.cause).toBeInstanceOf(PluginError);
            });
    });

    it('classifies a bare Error as internal', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        expect(
            await codeOf(
                invoker.invoke('p', 'op', () => {
                    throw new Error('boom');
                }),
            ),
        ).toBe('internal');
    });

    it('classifies a timeout as timeout', async () => {
        vi.useFakeTimers();
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        const promise = codeOf(invoker.invoke('p', 'op', async () => new Promise<void>(() => {}), { timeoutMs: 1_000 }));
        await vi.advanceTimersByTimeAsync(1_000);

        expect(await promise).toBe('timeout');
    });

    it('classifies the open-breaker short circuit as unavailable', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubLogger());

        await expect(
            invoker.invoke('p', 'op', () => {
                throw new PluginError('config', 'no client id');
            }),
        ).rejects.toThrow();

        expect(await codeOf(invoker.invoke('p', 'op', async () => 'never runs'))).toBe('unavailable');
    });
});
