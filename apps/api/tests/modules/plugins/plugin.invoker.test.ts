import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginError, isPluginError } from '@deadair/plugin-sdk';

import { invocationRemainingMs } from '../../../src/modules/plugins/plugin.invocation.deadline.js';
import { PLUGIN_FAILURE_THRESHOLD, PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

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

    it('publishes the call deadline, so host services the plugin calls back into can size their own budgets', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        // Read from inside the call, which is where a host service reads it:
        // there is no parameter that could carry it across arbitrary plugin code.
        const seen = await invoker.invoke('p', 'op', async () => invocationRemainingMs(), { timeoutMs: 5_000 });

        expect(seen).toBeGreaterThan(4_000);
        expect(seen).toBeLessThanOrEqual(5_000);
    });

    it('leaves no ambient deadline behind once the call is over', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        await invoker.invoke('p', 'op', async () => undefined);

        // A plugin fetching from a timer of its own is outside any invocation,
        // and reading a stale deadline there would be worse than reading none.
        expect(invocationRemainingMs()).toBeUndefined();
    });

    it('captures a synchronous throw: invoke rejects with a useful message, op name recorded, process unharmed', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        const throwing = vi.fn(() => {
            throw new PluginError('token expired').withCode('auth');
        });

        await expect(invoker.invoke('p', 'oauth.getAuthorizeUrl', throwing)).rejects.toThrow(/token expired/);

        expect(invoker.isBreakerOpen('p')).toBe(true);
        expect(registry.get('p')?.status).toBe('failed');
        expect(throwing.mock.calls.length).toBe(1);
    });

    it('never quarantines on resource-scoped failures, however many arrive', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        // Opening ten Spotify playlists the account does not own is ordinary
        // use, not a sick plugin. Counting these took the whole integration
        // down on the third click.
        const throwing = () => {
            throw new PluginError('not your playlist').withCode('forbidden');
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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        const unavailable = () => {
            throw new PluginError('upstream down').withCode('unavailable');
        };
        const forbidden = () => {
            throw new PluginError('not your playlist').withCode('forbidden');
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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        const throwing = () => {
            throw new PluginError('bad gateway').withCode('upstream');
        };

        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
            await expect(invoker.invoke('p', 'op', throwing)).rejects.toThrow();
        }

        expect(invoker.isBreakerOpen('p')).toBe(false);
    });

    it('reset() closes the breaker and forgets the failure count', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

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

    /**
     * A plugin installed from outside the workspace can carry its own copy of
     * the SDK, and then `instanceof` answers false for an error that is a
     * `PluginError` in every way that matters. The invoker is the one place
     * that has to tolerate it, so this is where it is proven.
     */
    it('adopts the classification from a plugin carrying its own copy of the SDK', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        const fromAnotherCopy = {
            [Symbol.for('deadair.plugin-error/v1')]: true,
            name: 'PluginError',
            message: 'not your playlist',
            code: 'forbidden',
            retryable: false,
        };

        // Without adoption this reads as an unclassified `internal` failure,
        // which is both non-resource-scoped and (being unclassified) counted:
        // ten ordinary refusals would quarantine a healthy plugin.
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD * 3; i++) {
            expect(
                await codeOf(
                    invoker.invoke('p', 'catalog.getPlaylistTracks', () => {
                        throw fromAnotherCopy;
                    }),
                ),
            ).toBe('forbidden');
        }

        expect(invoker.isBreakerOpen('p')).toBe(false);
    });

    it("carries the plugin's own code out through the wrapper", async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        const code = await codeOf(
            invoker.invoke('p', 'op', () => {
                throw new PluginError('slow down').withCode('rate_limited').withRetry(30_000);
            }),
        );

        expect(code).toBe('rate_limited');
    });

    it('keeps the retry advice attached, so a 429 can be answered with a Retry-After', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        await invoker
            .invoke('p', 'op', () => {
                throw new PluginError('slow down').withCode('rate_limited').withUpstreamStatus(429).withRetry(30_000);
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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

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
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        const promise = codeOf(invoker.invoke('p', 'op', async () => new Promise<void>(() => {}), { timeoutMs: 1_000 }));
        await vi.advanceTimersByTimeAsync(1_000);

        expect(await promise).toBe('timeout');
    });

    it('classifies the open-breaker short circuit as unavailable', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        await expect(
            invoker.invoke('p', 'op', () => {
                throw new PluginError('no client id').withCode('config');
            }),
        ).rejects.toThrow();

        expect(await codeOf(invoker.invoke('p', 'op', async () => 'never runs'))).toBe('unavailable');
    });
});
