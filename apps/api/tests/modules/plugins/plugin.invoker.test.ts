import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginError, isPluginError } from '@deadair/plugin-sdk';

import { invocationRemainingMs } from '../../../src/modules/plugins/plugin.invocation.deadline.js';
import {
    DISPOSE_OP,
    PLUGIN_FAILURE_THRESHOLD,
    PLUGIN_RECOVERY_FIRST_MS,
    PLUGIN_RECOVERY_MAX_MS,
    PROBE_OP,
    PluginInvoker,
} from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

function record(overrides: Partial<PluginRecord> = {}): PluginRecord {
    return { id: 'p', dir: '/plugins/p', origin: 'bundled', status: 'active', ...overrides };
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

    it('still lets a quarantined plugin be disposed, so a reinit cannot leak the instance the breaker tripped on', async () => {
        const registry = new PluginRegistry();
        registry.upsert(record());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD; i++) {
            await expect(
                invoker.invoke('p', 'op', () => {
                    throw new Error('down');
                }),
            ).rejects.toThrow();
        }
        expect(invoker.isBreakerOpen('p')).toBe(true);

        // The lifecycle manager disposes BEFORE it resets, so this is the state every reinit of a
        // quarantined plugin runs `dispose` in. Refusing it here was the leak.
        const dispose = vi.fn(async () => {});
        await invoker.invoke('p', DISPOSE_OP, dispose);

        expect(dispose).toHaveBeenCalledTimes(1);
        // Letting go is not a recovery: the breaker stays open until something resets it.
        expect(invoker.isBreakerOpen('p')).toBe(true);
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
 * The breaker's only way back short of a reinit. The case it exists for is the one an operator met:
 * three failed Spotify searches quarantined the plugin, and "Test connection" answered with the
 * search's stored error without ever asking Spotify anything.
 */
describe('PluginInvoker.probe', () => {
    /** A running plugin: the probe only restores `active` over an instance it could have run against. */
    const running = () => record({ instance: {} as PluginRecord['instance'] });

    /** Trips the breaker in one call, with a reason the probe's own should visibly replace. */
    const quarantine = async (invoker: PluginInvoker) => {
        await expect(
            invoker.invoke('p', 'director.lookupTrack', () => {
                throw new PluginError('HTTP 502').withCode('auth');
            }),
        ).rejects.toThrow();
        expect(invoker.isBreakerOpen('p')).toBe(true);
    };

    const failing = () => {
        throw new Error('down');
    };

    it('goes through an open breaker and actually asks the plugin', async () => {
        const registry = new PluginRegistry();
        registry.upsert(running());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);
        await quarantine(invoker);

        const check = vi.fn(async () => ({ ok: false, message: 'Spotify replied HTTP 502.' }));
        const result = await invoker.probe('p', 'testConnection', check);

        expect(check).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: false, message: 'Spotify replied HTTP 502.' });
    });

    it('lifts the quarantine on a healthy answer: breaker closed, status active, stale error gone', async () => {
        const registry = new PluginRegistry();
        registry.upsert(running());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);
        await quarantine(invoker);
        expect(registry.get('p')?.status).toBe('failed');

        await expect(invoker.probe('p', 'testConnection', async () => ({ ok: true, message: 'Connected.' }))).resolves.toEqual({
            ok: true,
            message: 'Connected.',
        });

        expect(invoker.isBreakerOpen('p')).toBe(false);
        expect(registry.get('p')?.status).toBe('active');
        expect(registry.get('p')?.error).toBeUndefined();
        await expect(invoker.invoke('p', 'director.lookupTrack', async () => 'found')).resolves.toBe('found');
    });

    it('keeps a quarantined plugin quarantined on an unhealthy answer, with that answer as the reason', async () => {
        // `testConnection` says a connection failed by resolving `{ ok: false }`, never by throwing,
        // so a probe judged on whether the call resolved would have let this one back on air.
        const registry = new PluginRegistry();
        registry.upsert(running());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);
        await quarantine(invoker);

        await invoker.probe('p', 'testConnection', async () => ({ ok: false, message: 'Spotify replied HTTP 502.' }));

        expect(invoker.isBreakerOpen('p')).toBe(true);
        expect(registry.get('p')?.status).toBe('failed');
        expect(registry.get('p')?.error).toBe('testConnection: Spotify replied HTTP 502.');
        await expect(invoker.invoke('p', 'director.lookupTrack', async () => 'never runs')).rejects.toThrow(
            /is failed: testConnection: Spotify replied HTTP 502\./,
        );
    });

    it('records a probe that throws like any other failure, so the reason is still the latest one', async () => {
        const registry = new PluginRegistry();
        registry.upsert(running());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);
        await quarantine(invoker);

        await expect(invoker.probe('p', 'testConnection', failing)).rejects.toThrow(/failed during testConnection: down/);

        expect(invoker.isBreakerOpen('p')).toBe(true);
        expect(registry.get('p')?.error).toBe('testConnection: down');
    });

    it('moves nothing on a healthy plugin that answers unhealthy: no quarantine, and no clean slate either', async () => {
        const registry = new PluginRegistry();
        registry.upsert(running());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);
        const unreachable = async () => ({ ok: false, message: 'no route to host' });

        // Pressing the test button is not station traffic, so it cannot be what quarantines a plugin.
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD * 2; i++) {
            await invoker.probe('p', 'testConnection', unreachable);
        }
        expect(invoker.isBreakerOpen('p')).toBe(false);
        expect(registry.get('p')?.status).toBe('active');

        // Nor is the plugin saying it cannot connect evidence that it can: the count toward tripping
        // survives it, where a success would have cleared it.
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
            await expect(invoker.invoke('p', 'op', failing)).rejects.toThrow();
        }
        await invoker.probe('p', 'testConnection', unreachable);
        await expect(invoker.invoke('p', 'op', failing)).rejects.toThrow();
        expect(invoker.isBreakerOpen('p')).toBe(true);
    });

    it('clears the count toward tripping on a healthy answer, as any success does', async () => {
        const registry = new PluginRegistry();
        registry.upsert(running());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
            await expect(invoker.invoke('p', 'op', failing)).rejects.toThrow();
        }
        await invoker.probe('p', 'testConnection', async () => ({ ok: true }));
        await expect(invoker.invoke('p', 'op', failing)).rejects.toThrow();

        expect(invoker.isBreakerOpen('p')).toBe(false);
    });

    it('closes the breaker but will not mark a plugin with no instance active', async () => {
        // A reinit that failed while the probe was in flight has already written `failed` over a
        // record with nothing in it. `active` there would advertise a plugin nothing can call.
        const registry = new PluginRegistry();
        registry.upsert(running());
        const invoker = new PluginInvoker(registry, stubPluginLog().log);
        await quarantine(invoker);

        await invoker.probe('p', 'testConnection', async () => {
            registry.setStatus('p', 'failed', 'init: bad client id');
            registry.get('p')!.instance = undefined;
            return { ok: true };
        });

        expect(registry.get('p')?.status).toBe('failed');
        expect(registry.get('p')?.error).toBe('init: bad client id');
    });
});

/**
 * A quarantined plugin gets no traffic (every capability accessor skips a status that is not
 * `active`), so nothing would ever reach a textbook half-open breaker. The breaker asks on its own.
 */
describe('PluginInvoker automatic recovery', () => {
    const MINUTE = 60_000;

    type Check = () => Promise<{ ok: boolean; message?: string }>;

    function setup(testConnection?: Check) {
        vi.useFakeTimers();
        const registry = new PluginRegistry();
        registry.upsert(record({ instance: (testConnection ? { testConnection } : {}) as PluginRecord['instance'] }));
        const invoker = new PluginInvoker(registry, stubPluginLog().log);
        return { registry, invoker };
    }

    /** What the station did to Spotify: three 502s in a row, each one `unavailable`, which is retryable. */
    async function tripOnOutage(invoker: PluginInvoker, error = () => new PluginError('HTTP 502').withCode('unavailable')) {
        for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD; i++) {
            await expect(
                invoker.invoke('p', 'director.lookupTrack', () => {
                    throw error();
                }),
            ).rejects.toThrow();
        }
        expect(invoker.isBreakerOpen('p')).toBe(true);
    }

    it('asks a plugin quarantined by an outage again after a minute, and lets it back when it answers', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true, message: 'Connected.' }));
        const { registry, invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_FIRST_MS - 1);
        expect(testConnection).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(testConnection).toHaveBeenCalledTimes(1);
        expect(invoker.isBreakerOpen('p')).toBe(false);
        expect(registry.get('p')?.status).toBe('active');
        expect(registry.get('p')?.error).toBeUndefined();

        // Recovered is recovered: nothing is left armed to ask again.
        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_MAX_MS * 2);
        expect(testConnection).toHaveBeenCalledTimes(1);
    });

    it('backs off while the provider stays down, doubling to a ceiling', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: false, message: 'Spotify replied HTTP 502.' }));
        const { registry, invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        const gaps = [1, 2, 4, 8, 16, 30, 30].map(minutes => minutes * MINUTE);
        expect(gaps.at(-1)).toBe(PLUGIN_RECOVERY_MAX_MS);

        for (const [index, gap] of gaps.entries()) {
            await vi.advanceTimersByTimeAsync(gap - 1);
            expect(testConnection).toHaveBeenCalledTimes(index);
            await vi.advanceTimersByTimeAsync(1);
            expect(testConnection).toHaveBeenCalledTimes(index + 1);
        }

        expect(invoker.isBreakerOpen('p')).toBe(true);
        expect(registry.get('p')?.error).toBe('testConnection: Spotify replied HTTP 502.');
    });

    it('does not probe a quarantine the plugin declared permanent', async () => {
        // `auth` is the plugin saying the credential is dead. Asking again will not revive it, and
        // the operator's own Test connection is still there for after they have fixed it.
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { invoker } = setup(testConnection);
        await expect(
            invoker.invoke('p', 'op', () => {
                throw new PluginError('token revoked').withCode('auth');
            }),
        ).rejects.toThrow();

        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_MAX_MS * 2);

        expect(testConnection).not.toHaveBeenCalled();
        expect(invoker.isBreakerOpen('p')).toBe(true);
    });

    it('stops probing once a probe answers with a failure retrying cannot end', async () => {
        const testConnection = vi.fn<Check>(async () => {
            throw new PluginError('token revoked').withCode('auth');
        });
        const { invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_FIRST_MS);
        expect(testConnection).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_MAX_MS * 2);
        expect(testConnection).toHaveBeenCalledTimes(1);
        expect(invoker.isBreakerOpen('p')).toBe(true);
    });

    it('keeps probing through a probe that throws something retryable', async () => {
        const testConnection = vi.fn<Check>().mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValue({ ok: true });
        const { invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_FIRST_MS);
        expect(invoker.isBreakerOpen('p')).toBe(true);

        await vi.advanceTimersByTimeAsync(2 * MINUTE);
        expect(testConnection).toHaveBeenCalledTimes(2);
        expect(invoker.isBreakerOpen('p')).toBe(false);
    });

    it('waits at least as long as the upstream asked', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { invoker } = setup(testConnection);
        await tripOnOutage(invoker, () => new PluginError('slow down').withCode('rate_limited').withRetry(5 * MINUTE));

        await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
        expect(testConnection).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(testConnection).toHaveBeenCalledTimes(1);
    });

    it("does not let the operator's own test push the station's recovery further out", async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: false, message: 'still down' }));
        const { invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        await vi.advanceTimersByTimeAsync(MINUTE / 2);
        await invoker.probe('p', PROBE_OP, testConnection);
        expect(testConnection).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(MINUTE / 2);
        expect(testConnection).toHaveBeenCalledTimes(2);
    });

    it('forgets a pending probe when the plugin is reset, which is what every reinit does', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        invoker.reset('p');
        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_MAX_MS * 2);

        expect(testConnection).not.toHaveBeenCalled();
    });

    it('starts nothing once recovery is stopped for shutdown, including for a plugin that fails after', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        invoker.stopRecovery();
        // A dispose failing on the way out goes through the same accounting, and must not re-arm.
        invoker.reset('p');
        await tripOnOutage(invoker);
        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_MAX_MS * 2);

        expect(testConnection).not.toHaveBeenCalled();
    });

    it('leaves a plugin with nothing to ask quarantined, without asking again', async () => {
        const { registry, invoker } = setup();
        await tripOnOutage(invoker);

        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_MAX_MS * 2);

        expect(invoker.isBreakerOpen('p')).toBe(true);
        expect(registry.get('p')?.status).toBe('failed');
    });

    it('asks nothing of a quarantined plugin whose instance is gone', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { registry, invoker } = setup(testConnection);
        await tripOnOutage(invoker);

        registry.get('p')!.instance = undefined;
        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_MAX_MS * 2);

        expect(testConnection).not.toHaveBeenCalled();
    });

    /**
     * The case B3 exists for: an engine that lists voices but cannot speak passes `testConnection`
     * every time and fails every real call. Forgiving the backoff on the probe alone had this
     * quarantining and reopening on the same one-minute timer forever, rather than backing off.
     */
    it('keeps doubling the backoff across quarantines a passing probe only just closed', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { invoker } = setup(testConnection);

        for (const minutes of [1, 2, 4]) {
            await tripOnOutage(invoker);
            await vi.advanceTimersByTimeAsync(minutes * MINUTE);
            expect(invoker.isBreakerOpen('p')).toBe(false);

            // One ordinary call succeeds right after recovery (nowhere near the decay window), so
            // the next quarantine must not be forgiven back down to a minute.
            await expect(invoker.invoke('p', 'director.lookupTrack', async () => 'ok')).resolves.toBe('ok');
        }

        expect(testConnection).toHaveBeenCalledTimes(3);
    });

    it('lets the backoff decay back to a minute once a recovered plugin has stayed healthy through the decay window', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { invoker } = setup(testConnection);

        await tripOnOutage(invoker);
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(testConnection).toHaveBeenCalledTimes(1);
        expect(invoker.isBreakerOpen('p')).toBe(false);

        // Nothing fails for the whole decay window: the plugin has proven itself, not merely
        // answered one probe.
        await vi.advanceTimersByTimeAsync(PLUGIN_RECOVERY_FIRST_MS - 1);
        await expect(invoker.invoke('p', 'director.lookupTrack', async () => 'ok')).resolves.toBe('ok');
        await vi.advanceTimersByTimeAsync(1);
        await expect(invoker.invoke('p', 'director.lookupTrack', async () => 'ok')).resolves.toBe('ok');

        await tripOnOutage(invoker);
        await vi.advanceTimersByTimeAsync(MINUTE - 1);
        expect(testConnection).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(testConnection).toHaveBeenCalledTimes(2);
    });

    it('reset() forgets the backoff along with everything else, so a reinit starts a quarantine at a minute', async () => {
        const testConnection = vi.fn<Check>(async () => ({ ok: true }));
        const { invoker } = setup(testConnection);

        await tripOnOutage(invoker);
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(invoker.isBreakerOpen('p')).toBe(false);

        invoker.reset('p');

        await tripOnOutage(invoker);
        await vi.advanceTimersByTimeAsync(MINUTE - 1);
        expect(testConnection).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(testConnection).toHaveBeenCalledTimes(2);
    });

    describe('nextProbeAt', () => {
        it('is absent for a plugin with nothing scheduled', () => {
            const { invoker } = setup();
            expect(invoker.nextProbeAt('p')).toBeUndefined();
        });

        it('reports when the pending probe is due, and clears it once the probe runs', async () => {
            const testConnection = vi.fn<Check>(async () => ({ ok: true }));
            const { invoker } = setup(testConnection);
            const trippedAt = Date.now();
            await tripOnOutage(invoker);

            expect(invoker.nextProbeAt('p')).toBe(trippedAt + MINUTE);

            await vi.advanceTimersByTimeAsync(MINUTE);
            expect(invoker.nextProbeAt('p')).toBeUndefined();
        });

        it('is cleared along with everything else once the plugin is reset', async () => {
            const testConnection = vi.fn<Check>(async () => ({ ok: true }));
            const { invoker } = setup(testConnection);
            await tripOnOutage(invoker);

            expect(invoker.nextProbeAt('p')).toBeDefined();
            invoker.reset('p');
            expect(invoker.nextProbeAt('p')).toBeUndefined();
        });
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
