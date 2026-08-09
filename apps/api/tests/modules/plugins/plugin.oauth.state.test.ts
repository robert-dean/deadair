import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginInstance, PluginManifest } from '@deadair/plugin-sdk';

import type { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PLUGIN_OAUTH_STATE_TTL_MS, PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const PLUGIN_ID = 'test.oauth';

/** The neutral sentence every callback failure comes back with. */
const NEUTRAL_FAILURE = 'the authorization could not be completed';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'OAuth Plugin',
        version: '1.0.0',
        capabilities: ['catalog', 'oauth'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: true },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

interface Harness {
    service: PluginsService;
    store: PluginOAuthStateStore;
    pluginLog: ReturnType<typeof stubPluginLog>;
    getAuthorizeUrl: ReturnType<typeof vi.fn>;
    handleCallback: ReturnType<typeof vi.fn>;
}

/**
 * A real registry, invoker and state store (all in-memory) around a spy plugin.
 * Every collaborator the OAuth pair never touches is a bare stub: reaching one
 * would be the bug under test, so an undefined method there is a loud failure.
 */
function harness(): Harness {
    const getAuthorizeUrl = vi.fn(async (state: string) => `https://provider.example/authorize?state=${state}`);
    const handleCallback = vi.fn(async (_params: Record<string, string>) => {});

    const instance = { getAuthorizeUrl, handleCallback } as unknown as PluginInstance;
    const record: PluginRecord = { id: PLUGIN_ID, dir: '/plugins/oauth', status: 'active', manifest: manifest(), instance };

    const registry = new PluginRegistry();
    registry.upsert(record);

    const store = new PluginOAuthStateStore();
    const pluginLog = stubPluginLog();
    const unused = {} as never;
    // Always-allow stub: this file exercises the OAuth state machinery, not
    // authorization. The permission checks themselves are covered by
    // plugins.service.authorization.test.ts.
    const accessControl = { require: vi.fn(async () => {}) } as unknown as AccessControlService;
    const service = new PluginsService(
        registry,
        unused,
        new PluginInvoker(registry, stubPluginLog().log),
        unused,
        store,
        accessControl,
        pluginLog.log,
        new AfterCommit(),
    );

    return { service, store, pluginLog, getAuthorizeUrl, handleCallback };
}

/** Runs the authorize leg and returns the `state` the host actually minted. */
async function authorize(h: Harness): Promise<string> {
    await h.service.startOAuthAuthorization(PLUGIN_ID);
    const state = h.getAuthorizeUrl.mock.calls.at(-1)?.[0] as string;
    expect(state).toBeTruthy();
    return state;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('PluginOAuthStateStore', () => {
    it('redeems the state it just issued', () => {
        const store = new PluginOAuthStateStore();
        const state = store.issue(PLUGIN_ID);

        expect(store.consume(PLUGIN_ID, state)).toBe(true);
    });

    it('issues a distinct state each time', () => {
        const store = new PluginOAuthStateStore();

        expect(store.issue(PLUGIN_ID)).not.toBe(store.issue(PLUGIN_ID));
    });

    it('rejects a state for a plugin that never started an authorization', () => {
        const store = new PluginOAuthStateStore();

        expect(store.consume(PLUGIN_ID, 'anything')).toBe(false);
    });

    it('rejects an absent or empty state', () => {
        const store = new PluginOAuthStateStore();
        store.issue(PLUGIN_ID);

        expect(store.consume(PLUGIN_ID, undefined)).toBe(false);
        expect(store.consume(PLUGIN_ID, '')).toBe(false);
    });

    it('rejects a mismatched state without consuming the pending one', () => {
        const store = new PluginOAuthStateStore();
        const state = store.issue(PLUGIN_ID);

        expect(store.consume(PLUGIN_ID, `${state}x`)).toBe(false);
        expect(store.consume(PLUGIN_ID, 'other')).toBe(false);
        // A prober's guesses must not knock out an operator's live attempt.
        expect(store.consume(PLUGIN_ID, state)).toBe(true);
    });

    it('does not redeem one plugin state against another plugin', () => {
        const store = new PluginOAuthStateStore();
        const state = store.issue(PLUGIN_ID);

        expect(store.consume('other.plugin', state)).toBe(false);
        expect(store.consume(PLUGIN_ID, state)).toBe(true);
    });

    it('is single use', () => {
        const store = new PluginOAuthStateStore();
        const state = store.issue(PLUGIN_ID);

        expect(store.consume(PLUGIN_ID, state)).toBe(true);
        expect(store.consume(PLUGIN_ID, state)).toBe(false);
    });

    it('supersedes the previous state when a new authorization starts', () => {
        const store = new PluginOAuthStateStore();
        const first = store.issue(PLUGIN_ID);
        const second = store.issue(PLUGIN_ID);

        expect(store.consume(PLUGIN_ID, first)).toBe(false);
        expect(store.consume(PLUGIN_ID, second)).toBe(true);
    });

    it('rejects a state older than the TTL', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const store = new PluginOAuthStateStore();
        const state = store.issue(PLUGIN_ID);

        vi.setSystemTime(PLUGIN_OAUTH_STATE_TTL_MS + 1);

        expect(store.consume(PLUGIN_ID, state)).toBe(false);
    });

    it('still redeems a state at the TTL boundary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const store = new PluginOAuthStateStore();
        const state = store.issue(PLUGIN_ID);

        vi.setSystemTime(PLUGIN_OAUTH_STATE_TTL_MS);

        expect(store.consume(PLUGIN_ID, state)).toBe(true);
    });
});

describe('PluginsService OAuth state enforcement', () => {
    // The console navigates to this itself, so the URL has to come back in the
    // body: a redirect from this route is unreachable from a browser, which
    // sends no Authorization header on a top-level navigation.
    it('reports the plugin authorize URL rather than redirecting to it', async () => {
        const h = harness();

        const started = await h.service.startOAuthAuthorization(PLUGIN_ID);
        const state = h.getAuthorizeUrl.mock.calls.at(-1)?.[0] as string;

        expect(started).toEqual({ url: `https://provider.example/authorize?state=${state}` });
    });

    it('hands the plugin a state the host remembers', async () => {
        const h = harness();
        const state = await authorize(h);

        expect(h.store.consume(PLUGIN_ID, state)).toBe(true);
    });

    it('completes the callback when the state matches the one minted', async () => {
        const h = harness();
        const state = await authorize(h);

        const result = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'auth-code', state });

        expect(result).toEqual({ pluginId: PLUGIN_ID, ok: true });
        expect(h.handleCallback).toHaveBeenCalledWith({ code: 'auth-code', state });
    });

    it('rejects a forged callback that follows no authorization at all', async () => {
        const h = harness();

        const result = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'attacker-code', state: 'forged' });

        expect(result).toEqual({ pluginId: PLUGIN_ID, ok: false, message: NEUTRAL_FAILURE });
        expect(h.handleCallback).not.toHaveBeenCalled();
    });

    it('rejects a callback carrying no state at all', async () => {
        const h = harness();
        await authorize(h);

        const result = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'attacker-code' });

        expect(result.ok).toBe(false);
        expect(result.message).toBe(NEUTRAL_FAILURE);
        expect(h.handleCallback).not.toHaveBeenCalled();
    });

    it('rejects a callback whose state does not match the minted one', async () => {
        const h = harness();
        const state = await authorize(h);

        const result = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'attacker-code', state: `${state}-tampered` });

        expect(result.ok).toBe(false);
        expect(result.message).toBe(NEUTRAL_FAILURE);
        expect(h.handleCallback).not.toHaveBeenCalled();
    });

    it('rejects a replay of a state that already completed a callback', async () => {
        const h = harness();
        const state = await authorize(h);

        await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'auth-code', state });
        const replay = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'replayed-code', state });

        expect(replay.ok).toBe(false);
        expect(replay.message).toBe(NEUTRAL_FAILURE);
        expect(h.handleCallback).toHaveBeenCalledTimes(1);
    });

    it('rejects a callback that arrives after the state expired', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const h = harness();
        const state = await authorize(h);

        vi.setSystemTime(PLUGIN_OAUTH_STATE_TTL_MS + 1);
        const result = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'auth-code', state });

        expect(result.ok).toBe(false);
        expect(result.message).toBe(NEUTRAL_FAILURE);
        expect(h.handleCallback).not.toHaveBeenCalled();
    });

    it('gives a bad state and a bad code the same neutral sentence', async () => {
        const h = harness();
        const state = await authorize(h);
        h.handleCallback.mockRejectedValueOnce(new Error('invalid_grant'));

        const badCode = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'stale-code', state });
        const badState = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'stale-code', state: 'forged' });

        expect(badState.message).toBe(badCode.message);
    });

    it('treats a denial redirect with a valid state as the provider declining', async () => {
        const h = harness();
        const state = await authorize(h);

        const result = await h.service.completeOAuthCallback(PLUGIN_ID, { error: 'access_denied', state });

        expect(result).toEqual({ pluginId: PLUGIN_ID, ok: false, message: 'the provider declined the authorization request' });
        // The state is spent either way, so the abandoned attempt cannot later
        // be finished with a code someone else supplies.
        expect(h.store.consume(PLUGIN_ID, state)).toBe(false);
    });

    it('rejects a denial redirect that carries no valid state before reading the error', async () => {
        const h = harness();
        const state = await authorize(h);

        const result = await h.service.completeOAuthCallback(PLUGIN_ID, { error: 'access_denied', state: 'forged' });

        expect(result.message).toBe(NEUTRAL_FAILURE);
        expect(h.handleCallback).not.toHaveBeenCalled();
        // The forged denial must not have burned the operator's live attempt.
        expect(h.store.consume(PLUGIN_ID, state)).toBe(true);
    });

    it('invalidates an abandoned authorization once a new one starts', async () => {
        const h = harness();
        const abandoned = await authorize(h);
        const current = await authorize(h);

        const stale = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'auth-code', state: abandoned });
        expect(stale.ok).toBe(false);
        expect(h.handleCallback).not.toHaveBeenCalled();

        const fresh = await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'auth-code', state: current });
        expect(fresh.ok).toBe(true);
    });

    it('logs the rejection without echoing the state or the code', async () => {
        const h = harness();
        const state = await authorize(h);

        await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'attacker-code', state: `${state}-tampered` });

        expect(h.pluginLog.log.for).toHaveBeenCalledWith(PLUGIN_ID);
        expect(h.pluginLog.scoped.warn).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(h.pluginLog.scoped.warn.mock.calls[0]);
        expect(logged).not.toContain(state);
        expect(logged).not.toContain('attacker-code');
    });

    it('distinguishes an absent state from an unrecognized one in the log only', async () => {
        const h = harness();
        await authorize(h);

        await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'c' });
        await h.service.completeOAuthCallback(PLUGIN_ID, { code: 'c', state: 'forged' });

        expect(h.pluginLog.scoped.warn.mock.calls[0]?.[1]).toMatchObject({ reason: 'absent' });
        expect(h.pluginLog.scoped.warn.mock.calls[1]?.[1]).toMatchObject({ reason: 'unrecognized' });
    });
});
