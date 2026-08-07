import { describe, expect, it } from 'vitest';

import { EVERYTHING_PLAYLIST_ID } from '../src/navidrome.manifest.js';
import { NavidromePlugin } from '../src/navidrome.plugin.js';
import { createFakePluginHost, type FakePluginHost } from './fake.plugin.host.js';

const BASE_URL = 'http://navidrome.test:4533';

/** An initialized plugin and the host it is talking to. */
async function build(): Promise<{ host: FakePluginHost; plugin: NavidromePlugin }> {
    const host = createFakePluginHost();
    host.seedConfig({ baseUrl: BASE_URL, username: 'station', streamFormat: 'raw' });
    host.seedSecret('password', 'hunter2');

    const plugin = new NavidromePlugin();
    await plugin.init(host);
    return { host, plugin };
}

const ok = (payload: Record<string, unknown>) => ({ body: JSON.stringify({ 'subsonic-response': { status: 'ok', ...payload } }) });

const failed = (code: number, message = 'nope') => ({
    body: JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code, message } } }),
});

const song = (id: string, title = 'A Track') => ({ id, title, artist: 'Portishead', duration: 200 });

/** The query parameters of the nth recorded call. */
const paramsOf = (host: FakePluginHost, index = 0): URLSearchParams => new URL(host.calls[index]!.url).searchParams;

describe('init', () => {
    it('refuses to come up without a password rather than failing later on every call', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ baseUrl: BASE_URL, username: 'station' });

        await expect(new NavidromePlugin().init(host)).rejects.toMatchObject({ code: 'config' });
    });
});

describe('testConnection', () => {
    it('names the server it reached, since ping proves the URL, the account and the password at once', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ type: 'navidrome', serverVersion: '0.53.3' }));

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected to navidrome 0.53.3.' });
    });

    it('reports a refusal instead of throwing it, because this is a button next to the form', async () => {
        const { host, plugin } = await build();
        host.queueResponse(failed(40, 'Wrong username or password'));

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('Wrong username') });
    });
});

describe('searchTracks', () => {
    it('asks for songs only, and pages the way it was told to', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { song: [song('song-1')] } }));

        await plugin.searchTracks('portishead', { limit: 25, offset: 50 });

        const params = paramsOf(host);
        expect(params.get('query')).toBe('portishead');
        expect(params.get('songCount')).toBe('25');
        expect(params.get('songOffset')).toBe('50');
        expect(params.get('artistCount')).toBe('0');
        expect(params.get('albumCount')).toBe('0');
    });

    it('keeps a page size inside what Subsonic will serve', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { song: [] } }));

        await plugin.searchTracks('anything', { limit: 100_000 });

        expect(paramsOf(host).get('songCount')).toBe('500');
    });

    it('has nothing to say about a query that matched nothing', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: {} }));

        await expect(plugin.searchTracks('nothing')).resolves.toEqual([]);
    });
});

describe('getTrack', () => {
    it('answers undefined for an id the server no longer has, rather than failing', async () => {
        // The catalog asks about ids it stored earlier, and libraries lose tracks.
        const { host, plugin } = await build();
        host.queueResponse(failed(70, 'Song not found'));

        await expect(plugin.getTrack('gone')).resolves.toBeUndefined();
    });

    it('lets a real failure through, so a dead server is not read as an empty library', async () => {
        const { host, plugin } = await build();
        host.queueResponse(failed(40, 'Wrong username or password'));

        await expect(plugin.getTrack('song-1')).rejects.toMatchObject({ code: 'config' });
    });
});

describe('listPlaylists', () => {
    it("offers the library itself after the operator's own playlists", async () => {
        // A library with no playlists is a full library, and the catalog sync can
        // only enumerate through playlists. Without this it would sync nothing.
        const { host, plugin } = await build();
        host.queueResponse(ok({ playlists: { playlist: [{ id: 'pl-1', name: 'Late night', songCount: 12 }] } }));

        const playlists = await plugin.listPlaylists();

        expect(playlists.map(playlist => playlist.id)).toEqual(['pl-1', EVERYTHING_PLAYLIST_ID]);
    });

    it('still offers it when the server has no playlists at all', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ playlists: {} }));

        await expect(plugin.listPlaylists()).resolves.toHaveLength(1);
    });

    it('pages the list itself, because getPlaylists returns all of it at once', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ playlists: { playlist: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } }));

        const playlists = await plugin.listPlaylists({ limit: 1, offset: 1 });

        expect(playlists.map(playlist => playlist.id)).toEqual(['b']);
    });
});

describe('getPlaylistTracks', () => {
    it("reads a real playlist's entries", async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ playlist: { id: 'pl-1', entry: [song('song-1'), song('song-2', 'Another')] } }));

        const tracks = await plugin.getPlaylistTracks('pl-1');

        expect(new URL(host.calls[0]!.url).pathname).toBe('/rest/getPlaylist.view');
        expect(tracks.map(track => track.id)).toEqual(['song-1', 'song-2']);
    });

    it('slices the page itself, since getPlaylist has no offset of its own', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ playlist: { entry: [song('a'), song('b'), song('c')] } }));

        const tracks = await plugin.getPlaylistTracks('pl-1', { limit: 1, offset: 1 });

        expect(tracks.map(track => track.id)).toEqual(['b']);
    });

    it('walks the whole library for the virtual playlist, through an empty-query search', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { song: [song('song-1')] } }));

        const tracks = await plugin.getPlaylistTracks(EVERYTHING_PLAYLIST_ID, { limit: 50, offset: 100 });

        const params = paramsOf(host);
        expect(new URL(host.calls[0]!.url).pathname).toBe('/rest/search3.view');
        expect(params.get('query')).toBe('');
        expect(params.get('songCount')).toBe('50');
        expect(params.get('songOffset')).toBe('100');
        expect(tracks.map(track => track.id)).toEqual(['song-1']);
    });

    it('ends the walk with a short page, which is how the catalog sync knows to stop', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: {} }));

        await expect(plugin.getPlaylistTracks(EVERYTHING_PLAYLIST_ID, { offset: 10_000 })).resolves.toEqual([]);
    });
});

describe('cover art', () => {
    it('mints a credentialed URL, identical every time for the same image', async () => {
        // These URLs get stored — on a catalog row, and as an `art_assets` key,
        // which is the source URL itself. A URL that varied per call would be a new
        // row and a fresh download of the same bytes every time it was mentioned.
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { song: [{ ...song('song-1'), coverArt: 'art-1' }] } }));
        host.queueResponse(ok({ searchResult3: { song: [{ ...song('song-1'), coverArt: 'art-1' }] } }));

        const [first] = await plugin.searchTracks('portishead');
        const [second] = await plugin.searchTracks('portishead');

        expect(first?.artworkUrl).toContain('/rest/getCoverArt.view');
        expect(first?.artworkUrl).toContain('id=art-1');
        expect(first?.artworkUrl).toBe(second?.artworkUrl);
    });

    it('says nothing for a song with no cover', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { song: [song('song-1')] } }));

        const [track] = await plugin.searchTracks('portishead');

        expect(track).not.toHaveProperty('artworkUrl');
    });
});

describe('dispose', () => {
    it('leaves the plugin refusing calls rather than half-working', async () => {
        const { plugin } = await build();
        await plugin.dispose();

        await expect(plugin.searchTracks('anything')).rejects.toMatchObject({ code: 'config' });
    });
});
