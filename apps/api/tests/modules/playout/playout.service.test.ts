// Both routes here are gated on a bare shared secret presented by a process, not a
// session. That makes the gate itself the whole security boundary, and the two
// secrets are deliberately different: the login route hands out a Spotify access
// token, while the bridge only moves item ids around, so one leaking must not
// spend the other.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { PlayoutService } from '../../../src/modules/playout/playout.service.js';
import type { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';
import type { PlayoutControlClient } from '../../../src/modules/playout/liquidsoap.control.js';
import type { PlayoutPusher } from '../../../src/modules/playout/playout.pusher.js';
import type { Rundown } from '../../../src/modules/playout/rundown.js';
import type { PlaylistsService } from '../../../src/modules/playlists/playlists.service.js';
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
    /** What the playlists read answers with, or an error to throw from it. */
    tracks?: { id: string; title: string; artists: string[]; durationMs?: number }[];
    playlistError?: Error;
    /** Whether the stream took a skip, and whether it is reachable at all. */
    skipLands?: boolean;
    streamUp?: boolean;
}

const item = { id: 'item-1', pluginId: 'deadair.spotify', externalId: 'trk_1', title: 'A Track', artists: ['An Artist'], durationMs: 200_000 };

function build(options: Options = {}) {
    const rundown = {
        markAired: vi.fn(() => options.markAired ?? true),
        load: vi.fn(),
        reset: vi.fn(),
        nowPlaying: vi.fn(() => undefined),
        upcoming: vi.fn(() => [] as unknown[]),
        queuedCount: vi.fn(() => 0),
    } as unknown as Rundown;

    const pusher = {
        reconcile: vi.fn(async () => {}),
        skipCurrent: vi.fn(async () => options.skipLands ?? true),
    } as unknown as PlayoutPusher;

    const control = { isUp: vi.fn(() => options.streamUp ?? true) } as unknown as PlayoutControlClient;

    const playlists = {
        getPlaylistTracks: vi.fn(async () => {
            if (options.playlistError) throw options.playlistError;
            return {
                pluginId: 'deadair.spotify',
                playlistId: 'pl_1',
                tracks: options.tracks ?? [{ id: 'trk_1', title: 'A Track', artists: ['An Artist'] }],
            };
        }),
    } as unknown as PlaylistsService;

    // Deliberately always resolves an address, even when the stream is down: that is
    // exactly what a pinned LIQUIDSOAP_CONTROL_URL does, and `streamUp` must not be
    // fooled by it.
    const endpoint = {
        secret: () => options.bridgeSecret ?? BRIDGE_SECRET,
        resolve: async () => 'http://127.0.0.1:8005',
    } as unknown as LiquidsoapEndpoint;

    const record =
        options.record === undefined
            ? { status: 'active', instance: { getSessionCredentials: async () => credentials } }
            : (options.record ?? undefined);
    const registry = { get: vi.fn(() => record) } as unknown as PluginRegistry;

    const invoker = { invoke: vi.fn(async (_id: string, _label: string, call: () => Promise<unknown>) => call()) } as unknown as PluginInvoker;
    const stream = { settings: async () => ({ spotifyLoginSecret: options.loginSecret ?? LOGIN_SECRET }) } as unknown as StreamService;

    return {
        service: new PlayoutService(rundown, pusher, playlists, endpoint, control, registry, invoker, stream, logger),
        rundown,
        pusher,
        playlists,
    };
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

describe('PlayoutService.playPlaylist', () => {
    it('loads the playlist and hands the first item over without waiting for the tick', async () => {
        // Otherwise the console's own response describes a station that has not started
        // yet, and the operator sees a stopped transport for up to a reconcile interval.
        const { service, rundown, pusher } = build();

        await service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(rundown.load).toHaveBeenCalledOnce();
        expect(pusher.reconcile).toHaveBeenCalledOnce();
    });

    it('maps a catalog track onto the source-keyed identity the rundown uses', async () => {
        const { service, rundown } = build({ tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'], durationMs: 1_000 }] });

        await service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(rundown.load).toHaveBeenCalledWith([
            { pluginId: 'deadair.spotify', externalId: 'trk_9', title: 'B Side', artists: ['Someone'], durationMs: 1_000 },
        ]);
    });

    it('omits a duration the provider did not report, rather than inventing a zero', async () => {
        const { service, rundown } = build({ tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'] }] });

        await service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(rundown.load).toHaveBeenCalledWith([{ pluginId: 'deadair.spotify', externalId: 'trk_9', title: 'B Side', artists: ['Someone'] }]);
    });

    it('refuses an empty playlist instead of reporting a station that plays nothing', async () => {
        const { service, rundown } = build({ tracks: [] });

        expect(await statusOf(service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(422);
        expect(rundown.load).not.toHaveBeenCalled();
    });

    it('lets the playlists read own the plugin narrowing', async () => {
        // 403/404/501/503 all come from PlaylistsService.requireCatalogCapable, so a
        // plugin the actor cannot see answers identically here and on the listing.
        const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
        const { service, rundown } = build({ playlistError: forbidden });

        expect(await statusOf(service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(403);
        expect(rundown.load).not.toHaveBeenCalled();
    });
});

describe('PlayoutService.getStatus', () => {
    it('reports the stream as down when nothing answers', async () => {
        // A running order with no stream to hand it to plays nothing; a console that
        // showed the queue without saying so would be lying by omission.
        //
        // The stub endpoint still resolves an address here, which is the point: a
        // pinned LIQUIDSOAP_CONTROL_URL is returned unprobed, so liveness has to come
        // from a call that actually happened rather than from having an address.
        const { service } = build({ streamUp: false });

        expect((await service.getStatus()).streamUp).toBe(false);
    });

    it('caps how much of the running order it carries', async () => {
        // This is polled every couple of seconds and a playlist can be hundreds long.
        const many = Array.from({ length: 50 }, (_, index) => ({ ...item, id: `item-${index}` }));
        const { service, rundown } = build();
        vi.mocked(rundown.upcoming).mockReturnValue(many);
        vi.mocked(rundown.queuedCount).mockReturnValue(many.length);

        const status = await service.getStatus();

        expect(status.upNext).toHaveLength(10);
        // The full depth is still reported, so the console can say "and 40 more".
        expect(status.queuedCount).toBe(50);
    });

    it('carries the playhead when the decoder reported one', async () => {
        const { service, rundown } = build();
        vi.mocked(rundown.nowPlaying).mockReturnValue({ item, startedAt: 1_700_000_000_000, remainingMs: 42_000 });

        expect((await service.getStatus()).nowPlaying).toEqual({
            item,
            startedAt: 1_700_000_000_000,
            remainingMs: 42_000,
        });
    });

    it('omits the playhead when the decoder could not say', async () => {
        const { service, rundown } = build();
        vi.mocked(rundown.nowPlaying).mockReturnValue({ item, startedAt: 1_700_000_000_000 });

        expect((await service.getStatus()).nowPlaying?.remainingMs).toBeUndefined();
    });
});

describe('PlayoutService.skip and stop', () => {
    it('reports a skip the stream did not take as a failure', async () => {
        // Answering 200 for a skip nobody heard leaves the console showing a track
        // change that never happened.
        const { service } = build({ skipLands: false });

        expect(await statusOf(service.skip())).toBe(409);
    });

    it('drops the running order on stop', async () => {
        const { service, rundown } = build();

        await service.stop();

        expect(rundown.reset).toHaveBeenCalledOnce();
    });
});

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
