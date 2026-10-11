import { describe, expect, it } from 'vitest';

import { EVERYTHING_PLAYLIST_ID } from '../src/emby.manifest.js';
import { EmbyPlugin } from '../src/emby.plugin.js';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

const BASE_URL = 'http://emby.test:8096';
const KEY = 'k3y';
const USER_ID = 'e0077b6b1c2648a3ba363b7fedb6fd12';
const TRACK = '12';
const PLAYLIST = '34';

type Reply = { status?: number; body: unknown };
type Route = (url: URL) => Reply | undefined;

/**
 * An initialized plugin whose host answers by path. Every unrouted call is a 500, so a test that
 * forgot a route fails loudly rather than reading an empty answer.
 */
async function build(routes: Route[], config: Record<string, unknown> = {}): Promise<{ host: FakePluginHost; plugin: EmbyPlugin }> {
    const host = createFakePluginHost();
    host.seedConfig({ baseUrl: BASE_URL, username: 'station', streamFormat: 'raw', ...config });
    host.seedSecret('apiKey', KEY);
    const users: Route = url =>
        url.pathname === '/Users'
            ? {
                  body: [
                      { Name: 'admin', Id: 'x' },
                      { Name: 'Station', Id: USER_ID },
                  ],
              }
            : undefined;
    host.setFetchImpl(async raw => {
        const url = new URL(raw);
        const reply = [users, ...routes].map(route => route(url)).find(found => found !== undefined) ?? { status: 500, body: 'unrouted' };
        return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    });

    const plugin = new EmbyPlugin();
    await plugin.init(host);
    return { host, plugin };
}

const track = (id: string, name: string, artist = 'Portishead') => ({
    Id: id,
    Type: 'Audio',
    Name: name,
    Artists: [artist],
    RunTimeTicks: 2_000_000_000,
});
const items = (...list: unknown[]) => ({ Items: list });

/** The calls made to one path, as URLs. */
const callsTo = (host: FakePluginHost, pathname: string): URL[] => host.calls.map(call => new URL(call.url)).filter(url => url.pathname === pathname);

describe('init', () => {
    it('refuses to come up without an API key rather than failing later on every call', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ baseUrl: BASE_URL, username: 'station' });

        await expect(new EmbyPlugin().init(host)).rejects.toMatchObject({ code: 'config' });
    });
});

describe('requests', () => {
    it('carries the key in the Authorization header, never the query string', async () => {
        const { host, plugin } = await build([
            url => (url.pathname === '/System/Info' ? { body: { ProductName: 'Emby Server', Version: '4.10.1.0' } } : undefined),
        ]);

        await plugin.testConnection();

        const call = host.calls[0]!;
        expect(call.headers?.authorization).toContain(`Token="${KEY}"`);
        expect(call.url).not.toContain(KEY);
    });
});

describe('testConnection', () => {
    it('names the server and the user, since it proves the URL, the key and the user at once', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/System/Info' ? { body: { ProductName: 'Emby Server', Version: '4.10.1.0' } } : undefined),
        ]);

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected to Emby Server 4.10.1.0 as station.' });
    });

    it('reports a rejected key instead of throwing it', async () => {
        const { plugin } = await build([url => (url.pathname === '/System/Info' ? { status: 401, body: '' } : undefined)]);

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('401') });
    });

    it('reports a user the server does not have', async () => {
        const { plugin } = await build([url => (url.pathname === '/System/Info' ? { body: {} } : undefined)], { username: 'nobody' });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('no user called "nobody"') });
    });
});

describe('searchTracks', () => {
    it('reads the query as a title, and as an artist then a title, artist matches first', async () => {
        const { host, plugin } = await build([
            url => (url.pathname === '/Artists' ? { body: items({ Id: 'artist-1', Name: 'Portishead' }) } : undefined),
            url =>
                url.pathname === '/Items' && url.searchParams.get('ArtistIds') === 'artist-1' ? { body: items(track('a1', 'Glory Box')) } : undefined,
            url =>
                url.pathname === '/Items'
                    ? { body: items(track('t1', 'Portishead Glory Box (cover)', 'Someone'), track('a1', 'Glory Box')) }
                    : undefined,
        ]);

        const found = await plugin.searchTracks('Portishead Glory Box', { limit: 10 });

        expect(found.map(row => row.id)).toEqual(['a1', 't1']);
        expect(callsTo(host, '/Artists')[0]!.searchParams.get('searchTerm')).toBe('Portishead');
        const scoped = callsTo(host, '/Items').find(url => url.searchParams.has('ArtistIds'))!;
        // The title is matched locally, because Emby compares punctuation literally.
        expect(scoped.searchParams.has('searchTerm')).toBe(false);
        expect(scoped.searchParams.get('userId')).toBe(USER_ID);
        expect(scoped.searchParams.get('IncludeItemTypes')).toBe('Audio');
    });

    it("matches the title within the artist's tracks whatever the punctuation", async () => {
        const { plugin } = await build([
            url => (url.pathname === '/Artists' ? { body: items({ Id: 'killers', Name: 'The Killers' }) } : undefined),
            url =>
                url.pathname === '/Items' && url.searchParams.get('ArtistIds') === 'killers'
                    ? { body: items(track('k1', 'Somebody Told Me', 'The Killers'), track('k2', 'Mr. Brightside', 'The Killers')) }
                    : undefined,
            url => (url.pathname === '/Items' ? { body: items() } : undefined),
        ]);

        const found = await plugin.searchTracks('The Killers Mr Brightside');

        expect(found.map(row => row.id)).toEqual(['k2']);
    });

    it("also searches by a word of the title when one page is not all of an artist's tracks", async () => {
        const full = Array.from({ length: 500 }, (_, index) => track(`f${index}`, `Filler ${index}`, 'Grateful Dead'));
        const { host, plugin } = await build([
            url => (url.pathname === '/Artists' ? { body: items({ Id: 'gd', Name: 'Grateful Dead' }) } : undefined),
            url =>
                url.pathname === '/Items' && url.searchParams.get('ArtistIds') === 'gd'
                    ? { body: url.searchParams.has('searchTerm') ? items(track('d1', 'Dark Star', 'Grateful Dead')) : items(...full) }
                    : undefined,
            url => (url.pathname === '/Items' ? { body: items() } : undefined),
        ]);

        await expect(plugin.searchTracks('Grateful Dead Dark Star').then(rows => rows.map(row => row.id))).resolves.toEqual(['d1']);
        expect(
            callsTo(host, '/Items')
                .find(url => url.searchParams.has('searchTerm') && url.searchParams.has('ArtistIds'))!
                .searchParams.get('searchTerm'),
        ).toBe('dark');
    });

    it('treats limit as a total and applies the offset after merging', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/Items' ? { body: items(track('t1', 'a'), track('t2', 'b'), track('t3', 'c')) } : undefined),
        ]);

        await expect(plugin.searchTracks('word', { limit: 1, offset: 1 }).then(rows => rows.map(row => row.id))).resolves.toEqual(['t2']);
    });

    it('applies a period through the Years filter', async () => {
        const { host, plugin } = await build([url => (url.pathname === '/Items' ? { body: items() } : undefined)]);

        await plugin.searchTracks('glory', { yearFrom: 1994, yearTo: 1995 });

        expect(callsTo(host, '/Items')[0]!.searchParams.get('Years')).toBe('1994,1995');
    });

    it('answers nothing, without asking, for a period whose ends cross', async () => {
        const { host, plugin } = await build([]);

        await expect(plugin.searchTracks('glory', { yearFrom: 2000, yearTo: 1990 })).resolves.toEqual([]);
        expect(host.calls).toHaveLength(0);
    });
});

describe('getTrack', () => {
    it('finds a track by the id it was stored under', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/Items' && url.searchParams.get('ids') === TRACK ? { body: items(track(TRACK, 'Roads')) } : undefined),
        ]);

        await expect(plugin.getTrack(TRACK)).resolves.toMatchObject({ id: TRACK, title: 'Roads' });
    });

    it('never sends an id Emby cannot parse, which it answers with the root folders', async () => {
        const { host, plugin } = await build([]);

        await expect(plugin.getTrack('navidrome-id')).resolves.toBeUndefined();
        expect(host.calls).toHaveLength(0);
    });

    it('answers undefined for an id the server no longer holds, or that is not a track', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/Items' ? { body: items({ Id: TRACK, Type: 'MusicAlbum', Name: 'An album' }) } : undefined),
        ]);

        await expect(plugin.getTrack(TRACK)).resolves.toBeUndefined();
    });
});

describe('listPlaylists', () => {
    it('lists audio playlists for the user, with Everything last and reachable by paging', async () => {
        const { host, plugin } = await build([
            url =>
                url.pathname === '/Items'
                    ? { body: items({ Id: PLAYLIST, Name: 'Station Mix', ChildCount: 5, ImageTags: { Primary: 'tag1' } }) }
                    : undefined,
        ]);

        const all = await plugin.listPlaylists();
        expect(all.map(row => row.id)).toEqual([PLAYLIST, EVERYTHING_PLAYLIST_ID]);
        expect(all[0]).toMatchObject({ trackCount: 5, artworkUrl: `${BASE_URL}/Items/${PLAYLIST}/Images/Primary?tag=tag1` });
        await expect(plugin.listPlaylists({ offset: 1, limit: 1 }).then(rows => rows.map(row => row.id))).resolves.toEqual([EVERYTHING_PLAYLIST_ID]);

        const query = callsTo(host, '/Items')[0]!.searchParams;
        expect(query.get('IncludeItemTypes')).toBe('Playlist');
        // Emby drops the playlist filter when a media type is added, so none is sent.
        expect(query.has('MediaTypes')).toBe(false);
        expect(query.get('userId')).toBe(USER_ID);
    });
});

describe('getPlaylistTracks', () => {
    it('lets the server page a playlist', async () => {
        const { host, plugin } = await build([
            url => (url.pathname === `/Playlists/${PLAYLIST}/Items` ? { body: items(track(TRACK, 'Roads')) } : undefined),
        ]);

        await plugin.getPlaylistTracks(PLAYLIST, { offset: 50, limit: 25 });

        const query = callsTo(host, `/Playlists/${PLAYLIST}/Items`)[0]!.searchParams;
        expect(query.get('StartIndex')).toBe('50');
        expect(query.get('Limit')).toBe('25');
        expect(query.get('userId')).toBe(USER_ID);
    });

    it('says not_found for an id the playlist endpoint refuses as malformed (a 400)', async () => {
        const { plugin } = await build([
            url => (url.pathname.startsWith('/Playlists/') ? { status: 400, body: 'Error processing request.' } : undefined),
        ]);

        await expect(plugin.getPlaylistTracks(PLAYLIST)).rejects.toMatchObject({ code: 'not_found' });
        await expect(plugin.getPlaylistTracks('junk')).rejects.toMatchObject({ code: 'not_found' });
    });

    it('walks the whole library oldest addition first, so a scan mid-walk shifts no page', async () => {
        const { host, plugin } = await build([url => (url.pathname === '/Items' ? { body: items(track(TRACK, 'Roads')) } : undefined)]);

        await plugin.getPlaylistTracks(EVERYTHING_PLAYLIST_ID, { offset: 100, limit: 50 });

        const query = callsTo(host, '/Items')[0]!.searchParams;
        expect(query.get('SortBy')).toBe('DateCreated,SortName');
        expect(query.get('StartIndex')).toBe('100');
        expect(query.get('Limit')).toBe('50');
        expect(query.get('Recursive')).toBe('true');
    });
});

describe('artwork', () => {
    it("falls back to the album's picture, and carries no credentials", async () => {
        const { plugin } = await build([
            url =>
                url.pathname === '/Items'
                    ? { body: items({ ...track(TRACK, 'Roads'), AlbumId: 'album-1', AlbumPrimaryImageTag: 'tag9' }) }
                    : undefined,
        ]);

        const [row] = await plugin.getPlaylistTracks(EVERYTHING_PLAYLIST_ID);
        expect(row!.artworkUrl).toBe(`${BASE_URL}/Items/album-1/Images/Primary?tag=tag9`);
    });
});

describe('resolveStreamUrl', () => {
    it('hands out the original file with the key in the query string', async () => {
        const { plugin } = await build([]);

        await expect(plugin.resolveStreamUrl(TRACK)).resolves.toEqual({ url: `${BASE_URL}/Audio/${TRACK}/stream?static=true&api_key=${KEY}` });
    });

    it('asks for a transcode in bits per second and says what it will be', async () => {
        const { plugin } = await build([], { streamFormat: 'opus', maxBitRate: 160 });

        const stream = await plugin.resolveStreamUrl(TRACK);
        const url = new URL(stream!.url);
        expect(url.searchParams.get('container')).toBe('ogg');
        expect(url.searchParams.get('audioCodec')).toBe('opus');
        expect(url.searchParams.get('audioBitRate')).toBe('160000');
        expect(url.searchParams.has('static')).toBe(false);
        expect(stream!.mimeType).toBe('audio/ogg');
    });

    it('has no URL for an id that is not an Emby id', async () => {
        const { plugin } = await build([]);

        await expect(plugin.resolveStreamUrl('spotify:track:x')).resolves.toBeUndefined();
    });
});

describe('the user lookup', () => {
    it('happens once per load, however many calls need it', async () => {
        const { host, plugin } = await build([url => (url.pathname === '/Items' ? { body: items() } : undefined)]);

        await Promise.all([plugin.getTrack(TRACK), plugin.listPlaylists(), plugin.getPlaylistTracks(EVERYTHING_PLAYLIST_ID)]);

        expect(callsTo(host, '/Users')).toHaveLength(1);
    });
});

describe('a playlist Emby answers with a 500', () => {
    it('is not_found when the item is gone or is not a playlist, since Emby answers both with a 500 rather than a 404', async () => {
        const { plugin } = await build([
            url =>
                url.pathname.startsWith('/Playlists/')
                    ? { status: 500, body: "Unable to cast object of type 'MusicAlbum' to type 'Playlist'." }
                    : undefined,
            url =>
                url.pathname === '/Items' && url.searchParams.get('ids') === '23'
                    ? { body: items({ Id: '23', Type: 'MusicAlbum', Name: 'Aeronautics' }) }
                    : undefined,
            url => (url.pathname === '/Items' && url.searchParams.has('ids') ? { body: items() } : undefined),
        ]);

        await expect(plugin.getPlaylistTracks('99999')).rejects.toMatchObject({ code: 'not_found' });
        await expect(plugin.getPlaylistTracks('23')).rejects.toMatchObject({ code: 'not_found' });
    });

    it('stays a server failure when the playlist does exist', async () => {
        const { plugin } = await build([
            url => (url.pathname.startsWith('/Playlists/') ? { status: 500, body: 'boom' } : undefined),
            url =>
                url.pathname === '/Items' && url.searchParams.get('ids') === PLAYLIST
                    ? { body: items({ Id: PLAYLIST, Type: 'Playlist', Name: 'Mix' }) }
                    : undefined,
        ]);

        await expect(plugin.getPlaylistTracks(PLAYLIST)).rejects.not.toMatchObject({ code: 'not_found' });
    });

    it('never sends an id that is not a number', async () => {
        const { host, plugin } = await build([]);

        await expect(plugin.getTrack('d32748680b298db5650456cbd268da71')).resolves.toBeUndefined();
        expect(host.calls).toHaveLength(0);
    });

    it('refuses an answer that is not the id asked for, which Emby gives for some ids it does not hold', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/Items' ? { body: items({ Id: '3', Type: 'CollectionFolder', Name: 'Music' }) } : undefined),
        ]);

        await expect(plugin.getTrack('99999')).resolves.toBeUndefined();
    });
});

describe('the year', () => {
    it('is asked for on every track query, since Emby leaves it out unless named', async () => {
        const { host, plugin } = await build([
            url => (url.pathname === '/Items' || url.pathname.startsWith('/Playlists/') ? { body: items(track(TRACK, 'Roads')) } : undefined),
            url => (url.pathname === '/Artists' ? { body: items() } : undefined),
        ]);

        await plugin.searchTracks('roads');
        await plugin.getTrack(TRACK);
        await plugin.getPlaylistTracks(PLAYLIST);
        await plugin.getPlaylistTracks('emby:all');

        const trackQueries = host.calls.map(call => new URL(call.url)).filter(url => url.pathname !== '/Users' && url.pathname !== '/Artists');
        expect(trackQueries.length).toBeGreaterThan(3);
        for (const url of trackQueries) expect(url.searchParams.get('Fields') ?? '').toContain('ProductionYear');
    });
});
