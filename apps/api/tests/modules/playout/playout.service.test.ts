// Both routes here are gated on a bare shared secret presented by a process, not a
// session. That makes the gate itself the whole security boundary, and the two
// secrets are deliberately different: the login route hands out a Spotify access
// token, while the bridge only moves item ids around, so one leaking must not
// spend the other.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { PlayoutService } from '../../../src/modules/playout/playout.service.js';
import type { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';
import type { Rundown } from '../../../src/modules/playout/rundown.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { StreamService } from '../../../src/modules/stream/stream.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const BRIDGE_SECRET = 'bridge-secret';
const LOGIN_SECRET = 'login-secret';

const credentials = { username: 'the-station', accessToken: 'BQC_token' };

interface Options {
    bridgeSecret?: string;
    loginSecret?: string;
    /** The Spotify plugin record the registry answers with. `null` means "not installed". */
    record?: unknown;
    markAired?: boolean;
}

function build(options: Options = {}) {
    const rundown = { markAired: vi.fn(() => options.markAired ?? true) } as unknown as Rundown;
    const endpoint = { secret: () => options.bridgeSecret ?? BRIDGE_SECRET } as unknown as LiquidsoapEndpoint;

    const record =
        options.record === undefined
            ? { status: 'active', instance: { getSessionCredentials: async () => credentials } }
            : (options.record ?? undefined);
    const registry = { get: vi.fn(() => record) } as unknown as PluginRegistry;

    const invoker = { invoke: vi.fn(async (_id: string, _label: string, call: () => Promise<unknown>) => call()) } as unknown as PluginInvoker;
    const stream = { settings: async () => ({ spotifyLoginSecret: options.loginSecret ?? LOGIN_SECRET }) } as unknown as StreamService;

    return { service: new PlayoutService(rundown, endpoint, registry, invoker, stream, logger), rundown };
}

/** The status a thrown HttpError carries. */
const statusOf = async (call: Promise<unknown>): Promise<number> => {
    try {
        await call;
        return 200;
    } catch (error) {
        return (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 0;
    }
};

describe('PlayoutService.confirmAired', () => {
    it('records the item when the bridge secret matches', async () => {
        const { service, rundown } = build();

        await service.confirmAired({ item: 'item-1' }, { 'x-playout-secret': BRIDGE_SECRET });

        expect(rundown.markAired).toHaveBeenCalledWith('item-1');
    });

    it('rejects a mismatched secret', async () => {
        const { service, rundown } = build();

        expect(await statusOf(service.confirmAired({ item: 'item-1' }, { 'x-playout-secret': 'wrong' }))).toBe(401);
        expect(rundown.markAired).not.toHaveBeenCalled();
    });

    it('answers 404 while the bridge secret is unseeded, since nothing could match', async () => {
        const { service } = build({ bridgeSecret: '' });

        expect(await statusOf(service.confirmAired({ item: 'item-1' }, { 'x-playout-secret': '' }))).toBe(404);
    });

    it('accepts an item the rundown does not hold', async () => {
        // A Liquidsoap that outlived an app restart reports the item it is still
        // playing. The caller is a fire-and-forget http.post that cannot act on an
        // error, and the rundown declines to invent the id, which is the whole handling.
        const { service } = build({ markAired: false });

        await expect(service.confirmAired({ item: 'from-a-previous-session' }, { 'x-playout-secret': BRIDGE_SECRET })).resolves.toBeUndefined();
    });

    it('does not accept the login secret in place of the bridge one', async () => {
        const { service } = build();

        expect(await statusOf(service.confirmAired({ item: 'item-1' }, { 'x-playout-secret': LOGIN_SECRET }))).toBe(401);
    });
});

describe('PlayoutService.spotifySessionLogin', () => {
    it('mints a login when the secret matches and the plugin is connected', async () => {
        const { service } = build();

        expect(await service.spotifySessionLogin({ 'x-spotify-login-secret': LOGIN_SECRET })).toEqual(credentials);
    });

    it('rejects a mismatched secret', async () => {
        const { service } = build();

        expect(await statusOf(service.spotifySessionLogin({ 'x-spotify-login-secret': 'wrong' }))).toBe(401);
    });

    it('answers 404 while the login secret is unseeded', async () => {
        const { service } = build({ loginSecret: '' });

        expect(await statusOf(service.spotifySessionLogin({ 'x-spotify-login-secret': '' }))).toBe(404);
    });

    it('does not accept the bridge secret in place of the login one', async () => {
        // The point of them being separate: this route hands out an access token.
        const { service } = build();

        expect(await statusOf(service.spotifySessionLogin({ 'x-spotify-login-secret': BRIDGE_SECRET }))).toBe(401);
    });

    it('answers 503 when the plugin is not installed', async () => {
        const { service } = build({ record: null });

        expect(await statusOf(service.spotifySessionLogin({ 'x-spotify-login-secret': LOGIN_SECRET }))).toBe(503);
    });

    it('answers 503 when the plugin is installed but not running', async () => {
        const { service } = build({ record: { status: 'disabled', instance: undefined } });

        expect(await statusOf(service.spotifySessionLogin({ 'x-spotify-login-secret': LOGIN_SECRET }))).toBe(503);
    });

    it('answers 503 when the plugin cannot supply a login yet', async () => {
        // Nobody has authorised Spotify. The shim asks on its first fetch, long before
        // that has happened, and retries on its own.
        const { service } = build({ record: { status: 'active', instance: { getSessionCredentials: async () => undefined } } });

        expect(await statusOf(service.spotifySessionLogin({ 'x-spotify-login-secret': LOGIN_SECRET }))).toBe(503);
    });

    it('translates a plugin failure rather than letting it surface as a bare 500', async () => {
        // An unreachable Spotify or a dead refresh token is diagnosable only if the
        // plugin's own vocabulary survives the trip out.
        const failing = {
            status: 'active',
            instance: {
                getSessionCredentials: async () => {
                    const error = new Error('upstream is down') as Error & { code: string };
                    error.code = 'unavailable';
                    throw error;
                },
            },
        };
        const { service } = build({ record: failing });

        expect(await statusOf(service.spotifySessionLogin({ 'x-spotify-login-secret': LOGIN_SECRET }))).not.toBe(200);
    });
});
