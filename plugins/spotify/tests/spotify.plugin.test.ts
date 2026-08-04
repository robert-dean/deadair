import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpotifyPlugin, spotifyManifest } from '../src/spotify.plugin.js';
import { createFakePluginHost, fakeHostFetchResponse, type FakePluginHost } from './fake.plugin.host.js';

const CLIENT_ID = 'client-abc';
const REDIRECT_URI = 'https://example.test/callback';

/** Matches `SpotifyPlugin`'s private `NO_ACTIVE_DEVICE_MESSAGE`. */
const NO_ACTIVE_DEVICE_MESSAGE = 'no active Spotify device; open Spotify or start the go-librespot bridge';

/** Matches `SpotifyPlugin`'s private `DEVICE_ID_CACHE_TTL_MS`. */
const DEVICE_ID_CACHE_TTL_MS = 60_000;

/** A scripted JSON `HostFetchResponse` from the Spotify API. */
function apiResponse(body: unknown, overrides: Partial<Parameters<typeof fakeHostFetchResponse>[0]> = {}) {
    return fakeHostFetchResponse({ body: JSON.stringify(body), url: 'https://api.spotify.com/v1/', ...overrides });
}

/** Seeds a host with config and a healthy, non-expiring token, then inits a plugin against it. */
async function initedPlugin(host: FakePluginHost, config: Record<string, unknown> = {}): Promise<SpotifyPlugin> {
    host.seedConfig({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, ...config });
    host.seedTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: String(Date.now() + 60 * 60 * 1000) });
    const plugin = new SpotifyPlugin();
    await plugin.init(host);
    return plugin;
}

describe('spotifyManifest re-export', () => {
    it('is re-exported from the plugin module', () => {
        expect(spotifyManifest.id).toBe('deadair.spotify');
    });
});

describe('SpotifyPlugin', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    describe('init / dispose', () => {
        it('reads clientId, deviceName and redirectUri from config', async () => {
            const host = createFakePluginHost();
            host.seedConfig({ clientId: CLIENT_ID, deviceName: 'Kitchen', redirectUri: REDIRECT_URI });
            const plugin = new SpotifyPlugin();

            await plugin.init(host);

            expect(host.logger.info).toHaveBeenCalledWith('spotify provider ready', { configured: true });
        });

        it('falls back to host.oauth.getRedirectUri() when no redirectUri is configured', async () => {
            const host = createFakePluginHost();
            host.seedConfig({ clientId: CLIENT_ID });
            const plugin = new SpotifyPlugin();

            await plugin.init(host);

            expect(host.oauth.getRedirectUri).toHaveBeenCalled();
            const url = await plugin.getAuthorizeUrl('state-1');
            expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://example.test/callback');
        });

        it('logs configured:false when no clientId is set', async () => {
            const host = createFakePluginHost();
            host.seedConfig({});
            const plugin = new SpotifyPlugin();

            await plugin.init(host);

            expect(host.logger.info).toHaveBeenCalledWith('spotify provider ready', { configured: false });
        });

        it('dispose() clears state so subsequent calls throw "used before init()"', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);

            await plugin.dispose();

            // testConnection() catches thrown errors into its result rather than rejecting.
            await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'Spotify plugin used before init()' });
        });

        it('methods throw "used before init()" when called before init() at all', async () => {
            const plugin = new SpotifyPlugin();

            await expect(plugin.getAuthorizeUrl('state')).rejects.toThrow('Spotify plugin used before init()');
        });
    });

    describe('testConnection', () => {
        it('reports success with the display name when connected', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ id: 'user-1', display_name: 'DJ Test' }));

            await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected as DJ Test.' });
        });

        it('falls back to the profile id when display_name is empty', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ id: 'user-1', display_name: '' }));

            await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected as user-1.' });
        });

        it('reports the HTTP status on a SpotifyRequestError', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden', ok: false }));

            await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'Spotify replied HTTP 403.' });
        });

        it('reports a generic error message for a non-SpotifyRequestError failure', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.setFetchImpl(async () => {
                throw new Error('network down');
            });

            await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'network down' });
        });
    });

    describe('oauth', () => {
        it('getAuthorizeUrl throws when no clientId is configured, before any auth work', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host, { clientId: undefined });

            await expect(plugin.getAuthorizeUrl('state-empty')).rejects.toThrow('Spotify client ID is not configured');
            expect(host.calls).toHaveLength(0);
            // No PKCE verifier was written: the guard fired before any auth work began.
            expect(host.storageKeys().filter(key => key.startsWith('oauth.pkce.'))).toHaveLength(0);
        });

        it('getAuthorizeUrl builds a Spotify authorize URL through the wired auth strategy', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);

            const url = await plugin.getAuthorizeUrl('state-1');
            const parsed = new URL(url);

            expect(parsed.origin + parsed.pathname).toBe('https://accounts.spotify.com/authorize');
            expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
            expect(parsed.searchParams.get('state')).toBe('state-1');
        });

        it('handleCallback exchanges the code for tokens through the wired auth strategy', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            await plugin.getAuthorizeUrl('state-2');
            host.queueResponse(
                fakeHostFetchResponse({
                    body: '{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600}',
                    url: 'https://accounts.spotify.com/api/token',
                }),
            );

            await plugin.handleCallback({ code: 'auth-code', state: 'state-2' });

            expect(host.getVaultTokens()).toMatchObject({ accessToken: 'new-access' });
        });

        it('handleCallback rejects when Spotify denied the authorization', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);

            await expect(plugin.handleCallback({ error: 'access_denied' })).rejects.toThrow(
                'Spotify authorisation was refused: access_denied',
            );
        });
    });

    describe('catalog', () => {
        it('searchTracks maps hits and drops items mapTrack cannot use', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(
                apiResponse({
                    tracks: {
                        items: [
                            {
                                id: 'track-1',
                                name: 'Song One',
                                artists: [{ name: 'Artist One' }],
                                album: { name: 'Album One', images: [{ url: 'https://img.test/1.jpg' }] },
                                duration_ms: 210_000,
                                external_ids: { isrc: 'US1234567890' },
                            },
                            null,
                            { id: 'no-name' },
                        ],
                    },
                }),
            );

            const results = await plugin.searchTracks('song one', { limit: 500, offset: 10 });

            expect(results).toEqual([
                {
                    id: 'track-1',
                    title: 'Song One',
                    artists: ['Artist One'],
                    album: 'Album One',
                    durationMs: 210_000,
                    isrc: 'US1234567890',
                    artworkUrl: 'https://img.test/1.jpg',
                },
            ]);
            expect(host.calls).toHaveLength(1);
            expect(host.calls[0].method).toBe('GET');
            // A caller-supplied limit over 50 clamps to the SDK's MaxInt<50> ceiling.
            expect(host.calls[0].url).toContain('limit=50');
        });

        it('getTrack returns the mapped track on success', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ id: 'track-2', name: 'Song Two', artists: [] }));

            await expect(plugin.getTrack('track-2')).resolves.toEqual({
                id: 'track-2',
                title: 'Song Two',
                artists: [],
                album: undefined,
                durationMs: undefined,
                isrc: undefined,
                artworkUrl: undefined,
            });
        });

        it('getTrack returns undefined on a 404', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false }));

            await expect(plugin.getTrack('missing')).resolves.toBeUndefined();
        });

        it('getTrack rethrows a non-404 error', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ error: 'boom' }, { status: 500, statusText: 'Internal Server Error', ok: false }));

            await expect(plugin.getTrack('track-3')).rejects.toMatchObject({ name: 'SpotifyRequestError', status: 500 });
        });

        it('listPlaylists maps hits and drops playlists mapPlaylist cannot use', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(
                apiResponse({
                    items: [
                        { id: 'pl-1', name: 'Playlist One', description: 'desc', images: [{ url: 'https://img.test/pl.jpg' }], tracks: { total: 12 } },
                        { id: 'pl-2' },
                    ],
                }),
            );
            host.queueResponse(apiResponse({ id: 'me-1', display_name: 'DJ' }));

            const results = await plugin.listPlaylists({ limit: 20 });

            expect(results).toEqual([
                { id: 'pl-1', name: 'Playlist One', description: 'desc', trackCount: 12, artworkUrl: 'https://img.test/pl.jpg' },
            ]);
        });

        it('listPlaylists marks the owned half readable and the followed half not', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(
                apiResponse({
                    items: [
                        { id: 'mine', name: 'Mine', owner: { id: 'me-1' } },
                        { id: 'editorial', name: 'Todays Top Hits', owner: { id: 'spotify' } },
                        { id: 'shared', name: 'Shared', owner: { id: 'friend' }, collaborative: true },
                    ],
                }),
            );
            host.queueResponse(apiResponse({ id: 'me-1', display_name: 'DJ' }));

            const results = await plugin.listPlaylists();

            expect(results.map(playlist => [playlist.id, playlist.permissions])).toEqual([
                ['mine', ['read', 'edit']],
                ['editorial', []],
                ['shared', ['read', 'edit']],
            ]);
        });

        it('still lists playlists when the account id cannot be resolved, leaving them unmarked', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ items: [{ id: 'pl-1', name: 'Playlist One', owner: { id: 'someone' } }] }));
            host.queueResponse(apiResponse({ error: 'boom' }, { status: 500, statusText: 'Internal Server Error', ok: false }));

            const results = await plugin.listPlaylists();

            expect(results).toHaveLength(1);
            expect(results[0]?.permissions).toBeUndefined();
        });

        it('getPlaylistTracks reads the 2026 `item` key', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ items: [{ item: { id: 't-1', name: 'Track A', artists: [] } }] }));

            const results = await plugin.getPlaylistTracks('pl-1');

            expect(results).toHaveLength(1);
            expect(results[0]).toMatchObject({ id: 't-1', title: 'Track A' });
        });

        it('getPlaylistTracks calls /items, not the replaced /tracks path', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ items: [] }));

            await plugin.getPlaylistTracks('pl-1', { limit: 10, offset: 20 });

            expect(host.calls).toHaveLength(1);
            expect(host.calls[0].url).toContain('/playlists/pl-1/items');
            expect(host.calls[0].url).not.toContain('/tracks');
            expect(host.calls[0].url).toContain('limit=10');
            expect(host.calls[0].url).toContain('offset=20');
        });

        it('getPlaylistTracks tolerates a response with no items at all', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            // Spotify returns playlist metadata without `items` for a playlist
            // whose contents the account may not read.
            host.queueResponse(apiResponse({ id: 'pl-1', name: 'Someone Elses' }));

            await expect(plugin.getPlaylistTracks('pl-1')).resolves.toEqual([]);
        });

        it('getPlaylistTracks maps hits and drops null tracks', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(
                apiResponse({
                    items: [{ track: { id: 't-1', name: 'Track A', artists: [] } }, { track: null }],
                }),
            );

            const results = await plugin.getPlaylistTracks('pl-1');

            expect(results).toHaveLength(1);
            expect(results[0]).toMatchObject({ id: 't-1', title: 'Track A' });
        });
    });

    describe('playout', () => {
        it('enqueue adds every trackId, with no device resolution call when deviceName is unset', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse(null, { status: 204, body: '' }));
            host.queueResponse(apiResponse(null, { status: 204, body: '' }));

            await plugin.enqueue(['t1', 't2']);

            expect(host.calls).toHaveLength(2);
            // One addItemToPlaybackQueue call per track id, in order.
            expect(host.calls[0].url).toContain('uri=spotify%3Atrack%3At1');
            expect(host.calls[1].url).toContain('uri=spotify%3Atrack%3At2');
        });

        it('enqueue does not replay tracks already queued before a later track 404s mid-loop', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
            host.queueResponse(apiResponse({ devices: [{ id: 'stale-device', name: 'Kitchen' }] })); // initial device lookup
            host.queueResponse(apiResponse(null, { status: 204, body: '' })); // t1 queues fine
            host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false })); // t2 404s on stale device
            host.queueResponse(apiResponse({ devices: [{ id: 'fresh-device', name: 'Kitchen' }] })); // re-resolve
            host.queueResponse(apiResponse(null, { status: 204, body: '' })); // t2 retried on fresh device
            host.queueResponse(apiResponse(null, { status: 204, body: '' })); // t3 queues on the now-fresh device, no further lookup

            await plugin.enqueue(['t1', 't2', 't3']);

            expect(host.calls).toHaveLength(6);
            expect(host.calls[0].url).toContain('me/player/devices');
            expect(host.calls[1].url).toContain('uri=spotify%3Atrack%3At1');
            expect(host.calls[1].url).toContain('device_id=stale-device');
            expect(host.calls[2].url).toContain('uri=spotify%3Atrack%3At2');
            expect(host.calls[3].url).toContain('me/player/devices');
            expect(host.calls[4].url).toContain('uri=spotify%3Atrack%3At2');
            expect(host.calls[4].url).toContain('device_id=fresh-device');
            expect(host.calls[5].url).toContain('uri=spotify%3Atrack%3At3');
            expect(host.calls[5].url).toContain('device_id=fresh-device');
            // t1 was queued exactly once: the retry boundary did not replay it.
            expect(host.calls.filter(call => call.url.includes('spotify%3Atrack%3At1'))).toHaveLength(1);
        });

        it('enqueue throws the no-active-device message, without a second retry, once a later track 404s again after the loop already retried once', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
            host.queueResponse(apiResponse({ devices: [{ id: 'stale-device', name: 'Kitchen' }] })); // initial device lookup
            host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false })); // t1 404s
            host.queueResponse(apiResponse({ devices: [{ id: 'fresh-device', name: 'Kitchen' }] })); // re-resolve, one retry spent
            host.queueResponse(apiResponse(null, { status: 204, body: '' })); // t1 retried ok
            host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false })); // t2 404s again, no retries left

            await expect(plugin.enqueue(['t1', 't2'])).rejects.toThrow(NO_ACTIVE_DEVICE_MESSAGE);
            expect(host.calls).toHaveLength(5);
        });

        it('enqueue throws the no-active-device message on a 404 with no retry when deviceName is unset', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false }));

            await expect(plugin.enqueue(['t1', 't2'])).rejects.toThrow(NO_ACTIVE_DEVICE_MESSAGE);
            expect(host.calls).toHaveLength(1);
        });

        it('enqueue rethrows a non-404 error without retrying', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ error: 'boom' }, { status: 500, statusText: 'Internal Server Error', ok: false }));

            await expect(plugin.enqueue(['t1'])).rejects.toMatchObject({ name: 'SpotifyRequestError', status: 500 });
            expect(host.calls).toHaveLength(1);
        });

        it('play, pause and skip each issue one action call with no device resolution when deviceName is unset', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse(null, { status: 204, body: '' }));

            await plugin.play('track-1');

            expect(host.calls).toHaveLength(1);
            // No deviceName configured means the plugin passes '' through, and
            // EndpointsBase.paramsFor drops falsy values from the query string.
            expect(host.calls[0].url).not.toContain('device_id');
        });

        it('getPlaybackState maps a playing snapshot', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse({ is_playing: true, progress_ms: 5000, item: { id: 'track-1', duration_ms: 210_000 } }));

            await expect(plugin.getPlaybackState()).resolves.toEqual({
                status: 'playing',
                trackId: 'track-1',
                positionMs: 5000,
                durationMs: 210_000,
            });
        });

        it('getPlaybackState reports stopped on a 204 (nothing playing)', async () => {
            const host = createFakePluginHost();
            const plugin = await initedPlugin(host);
            host.queueResponse(apiResponse(null, { status: 204, body: '' }));

            await expect(plugin.getPlaybackState()).resolves.toEqual({ status: 'stopped' });
        });

        describe('device resolution', () => {
            it('resolves and passes the matching device id when deviceName is configured', async () => {
                const host = createFakePluginHost();
                const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
                host.queueResponse(apiResponse({ devices: [{ id: 'device-1', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse(null, { status: 204, body: '' }));

                await plugin.play();

                expect(host.calls).toHaveLength(2);
                expect(host.calls[0].url).toContain('me/player/devices');
                expect(host.calls[1].url).toContain('device_id=device-1');
            });

            it('caches the resolved device id across calls within the TTL', async () => {
                const host = createFakePluginHost();
                const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
                host.queueResponse(apiResponse({ devices: [{ id: 'device-1', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse(null, { status: 204, body: '' }));
                host.queueResponse(apiResponse(null, { status: 204, body: '' }));

                await plugin.play();
                await plugin.pause();

                // One device lookup, two action calls: the second play/pause reused the cached id.
                expect(host.calls).toHaveLength(3);
            });

            it('re-resolves the device id once the cache TTL expires', async () => {
                vi.useFakeTimers();
                const host = createFakePluginHost();
                const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
                host.queueResponse(apiResponse({ devices: [{ id: 'device-1', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse(null, { status: 204, body: '' }));
                host.queueResponse(apiResponse({ devices: [{ id: 'device-1', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse(null, { status: 204, body: '' }));

                await plugin.play();
                vi.advanceTimersByTime(DEVICE_ID_CACHE_TTL_MS + 1);
                await plugin.pause();

                // Two device lookups: the cache had expired by the second call.
                expect(host.calls).toHaveLength(4);
                expect(host.calls[2].url).toContain('me/player/devices');
            });

            it('re-resolves the device once on a 404 and retries the action', async () => {
                const host = createFakePluginHost();
                const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
                host.queueResponse(apiResponse({ devices: [{ id: 'stale-device', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false }));
                host.queueResponse(apiResponse({ devices: [{ id: 'fresh-device', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse(null, { status: 204, body: '' }));

                await plugin.play();

                expect(host.calls).toHaveLength(4);
                expect(host.calls[3].url).toContain('device_id=fresh-device');
            });

            it('throws the no-active-device message when the retry also 404s', async () => {
                const host = createFakePluginHost();
                const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
                host.queueResponse(apiResponse({ devices: [{ id: 'stale-device', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false }));
                host.queueResponse(apiResponse({ devices: [{ id: 'fresh-device', name: 'Kitchen' }] }));
                host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false }));

                await expect(plugin.play()).rejects.toThrow(NO_ACTIVE_DEVICE_MESSAGE);
            });

            it('throws the no-active-device message on a 404 with no retry when deviceName is unset', async () => {
                const host = createFakePluginHost();
                const plugin = await initedPlugin(host);
                host.queueResponse(apiResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found', ok: false }));

                await expect(plugin.play()).rejects.toThrow(NO_ACTIVE_DEVICE_MESSAGE);
                expect(host.calls).toHaveLength(1);
            });

            it('throws the no-active-device message when no device matches the configured name', async () => {
                const host = createFakePluginHost();
                const plugin = await initedPlugin(host, { deviceName: 'Kitchen' });
                host.queueResponse(apiResponse({ devices: [{ id: 'device-1', name: 'Living Room' }] }));

                await expect(plugin.play()).rejects.toThrow(NO_ACTIVE_DEVICE_MESSAGE);
                expect(host.calls).toHaveLength(1);
            });
        });
    });
});
