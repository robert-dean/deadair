import { describe, expect, it } from 'vitest';

import { EVERYTHING_PLAYLIST_ID } from '../src/navidrome.manifest.js';
import { NavidromePlugin } from '../src/navidrome.plugin.js';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

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

    it('declines a narrowed search rather than answering it unfiltered', async () => {
        // `search3.view` matches text and offers no genre or year filter. Ignoring the filter would
        // be worse than declining: the caller merges every provider into one list with nothing
        // marking which rows honoured it, so unfiltered records would arrive indistinguishable from
        // the ones the station asked for.
        const { host, plugin } = await build();

        await expect(plugin.searchTracks('anything', { genre: 'jazz' })).resolves.toEqual([]);
        await expect(plugin.searchTracks('anything', { yearFrom: 1955 })).resolves.toEqual([]);
        await expect(plugin.searchTracks('anything', { yearTo: 1965 })).resolves.toEqual([]);
        // Declined before the request, not after it: no queued response was needed above.
        expect(host.calls).toHaveLength(0);
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
        host.queueResponse(
            ok({
                playlists: {
                    playlist: [
                        { id: 'a', name: 'A' },
                        { id: 'b', name: 'B' },
                    ],
                },
            }),
        );

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

describe('resolveStreamUrl', () => {
    it('mints a URL the player can fetch with no headers of its own', async () => {
        // The whole reason this plugin needs no station-side helper: Subsonic
        // authenticates in the query string, so the URL carries its own login.
        const { plugin } = await build();

        const stream = await plugin.resolveStreamUrl('song-1');
        const url = new URL(stream!.url);

        expect(url.origin + url.pathname).toBe(`${BASE_URL}/rest/stream.view`);
        expect(url.searchParams.get('id')).toBe('song-1');
        expect(url.searchParams.get('t')).toMatch(/^[0-9a-f]{32}$/);
        expect(url.searchParams.get('s')).toBeTruthy();
    });

    it('asks for the original file by default, and claims no mime type for it', async () => {
        // With `format=raw` the server sends whatever the file is. Naming a type
        // would be a claim this plugin cannot back.
        const { plugin } = await build();

        const stream = await plugin.resolveStreamUrl('song-1');

        expect(new URL(stream!.url).searchParams.get('format')).toBe('raw');
        expect(stream).not.toHaveProperty('mimeType');
    });

    it('never expires the URL, because a Subsonic token does not', async () => {
        const { plugin } = await build();
        expect(await plugin.resolveStreamUrl('song-1')).not.toHaveProperty('expiresAt');
    });

    it('carries the bitrate only when something is actually being transcoded', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ baseUrl: BASE_URL, username: 'station', streamFormat: 'mp3', maxBitRate: 192 });
        host.seedSecret('password', 'hunter2');
        const plugin = new NavidromePlugin();
        await plugin.init(host);

        const stream = await plugin.resolveStreamUrl('song-1');
        const url = new URL(stream!.url);

        expect(url.searchParams.get('format')).toBe('mp3');
        expect(url.searchParams.get('maxBitRate')).toBe('192');
        expect(stream?.mimeType).toBe('audio/mpeg');
    });

    it('omits an unset bitrate rather than sending a zero Subsonic reads as "no limit"', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ baseUrl: BASE_URL, username: 'station', streamFormat: 'opus' });
        host.seedSecret('password', 'hunter2');
        const plugin = new NavidromePlugin();
        await plugin.init(host);

        const stream = await plugin.resolveStreamUrl('song-1');

        expect(new URL(stream!.url).searchParams.has('maxBitRate')).toBe(false);
    });

    it('costs no request of its own', async () => {
        // Checking the id first would spend a round trip to learn something that can
        // change between the check and the fetch anyway. A lost id 404s at fetch
        // time and one item is skipped.
        const { host, plugin } = await build();

        await plugin.resolveStreamUrl('song-1');

        expect(host.calls).toHaveLength(0);
    });
});

describe('enrichTrack', () => {
    const ref = { artist: 'Portishead', title: 'Roads', album: 'Dummy' };

    it('scores the candidates rather than trusting the first one back', async () => {
        const { host, plugin } = await build();
        host.queueResponse(
            ok({
                searchResult3: {
                    song: [
                        { id: 'live', title: 'Roads - Live', artist: 'Portishead', year: 1998 },
                        { id: 'album', title: 'Roads', artist: 'Portishead', album: 'Dummy', year: 1994 },
                    ],
                },
            }),
        );

        const enrichment = await plugin.enrichTrack(ref);

        expect(enrichment.providerRef).toBe('album');
        expect(enrichment.year).toBe(1994);
    });

    it('says nothing about a track the library does not have', async () => {
        // A station whose catalog also holds another provider's tracks asks about
        // all of them. The host reads `{}` as a miss on a short clock, not a
        // failure, so a track that is not here costs one search a week.
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { song: [{ id: 'other', title: 'Roads', artist: 'Someone Else' }] } }));

        await expect(plugin.enrichTrack(ref)).resolves.toEqual({});
    });

    it('asks in one search rather than one per field', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { song: [] } }));

        await plugin.enrichTrack(ref);

        expect(host.calls).toHaveLength(1);
        expect(paramsOf(host).get('query')).toBe('Portishead Roads');
    });

    it('declares no batch form, because Subsonic has no bulk lookup to batch onto', async () => {
        // The batch method exists for a source paced at a request per second. Here
        // it would be N searches under one chunk deadline instead of N under N.
        const { plugin } = await build();

        expect((plugin as unknown as { enrichTracks?: unknown }).enrichTracks).toBeUndefined();
        expect((plugin as unknown as { maxBatchSize?: unknown }).maxBatchSize).toBeUndefined();
    });

    it('sorts below MusicBrainz and matches on artist-and-title, since Subsonic has no ISRC', async () => {
        const { plugin } = await build();

        expect(plugin.priority).toBe(600);
        expect(plugin.matchKeys).toEqual(['artist-title']);
    });
});

describe('enrichArtist', () => {
    it('reuses the ref it was handed instead of searching again', async () => {
        // The whole point of the host giving it back: a second pass is a lookup.
        const { host, plugin } = await build();
        host.queueResponse(ok({ artistInfo2: { biography: 'Formed in Bristol in 1991.' } }));

        const enrichment = await plugin.enrichArtist({ name: 'Portishead', providerRef: 'artist-1' });

        expect(host.calls).toHaveLength(1);
        expect(new URL(host.calls[0]!.url).pathname).toBe('/rest/getArtistInfo2.view');
        expect(enrichment.biography).toBe('Formed in Bristol in 1991.');
    });

    it('searches when it has never answered about this artist before', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { artist: [{ id: 'artist-1', name: 'Portishead' }] } }));
        host.queueResponse(ok({ artistInfo2: { largeImageUrl: 'http://large' } }));

        const enrichment = await plugin.enrichArtist({ name: 'Portishead' });

        expect(new URL(host.calls[0]!.url).pathname).toBe('/rest/search3.view');
        expect(enrichment.providerRef).toBe('artist-1');
    });

    it('says nothing about an artist the library has never heard of', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { artist: [{ id: 'other', name: 'Someone Else' }] } }));

        await expect(plugin.enrichArtist({ name: 'Portishead' })).resolves.toEqual({});
    });
});

describe('enrichAlbum', () => {
    it('looks the record up by the ref it kept', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ album: { id: 'album-1', name: 'Dummy', artist: 'Portishead', year: 1994 } }));

        const enrichment = await plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead', providerRef: 'album-1' });

        expect(new URL(host.calls[0]!.url).pathname).toBe('/rest/getAlbum.view');
        expect(enrichment.year).toBe(1994);
    });

    it('needs the artist to agree, so a same-named record by someone else is not it', async () => {
        const { host, plugin } = await build();
        host.queueResponse(ok({ searchResult3: { album: [{ id: 'other', name: 'Dummy', artist: 'Someone Else' }] } }));

        await expect(plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead' })).resolves.toEqual({});
    });

    it('treats a ref that has gone stale as a miss rather than a failure', async () => {
        // A rescan can renumber a library, and records get deleted.
        const { host, plugin } = await build();
        host.queueResponse(failed(70, 'Album not found'));

        await expect(plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead', providerRef: 'gone' })).resolves.toEqual({});
    });
});
