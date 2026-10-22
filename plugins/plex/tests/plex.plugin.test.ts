import { describe, expect, it } from 'vitest';

import { PlexPlugin } from '../src/plex.plugin.js';
import { createFakePluginHost, routedFetch, type FakePluginHost, type FakeRoute } from '@deadair/plugin-sdk/testing';

const BASE_URL = 'http://plex.test:32400';
const TOKEN = 't0ken';
const MACHINE = 'machine-1';

type Route = FakeRoute;

const container = (fields: Record<string, unknown>) => ({ MediaContainer: fields });
const metadata = (...items: unknown[]) => container({ size: items.length, Metadata: items });

/** One music library and one film library, which must be ignored. */
const sections: Route = url =>
    url.pathname === '/library/sections'
        ? {
              body: container({
                  Directory: [
                      { key: '1', type: 'artist', title: 'Music' },
                      { key: '2', type: 'movie', title: 'Films' },
                  ],
              }),
          }
        : undefined;

/** An initialized plugin whose host answers by path; see `routedFetch` for what an unrouted call gets. */
async function build(routes: Route[]): Promise<{ host: FakePluginHost; plugin: PlexPlugin }> {
    const host = createFakePluginHost();
    host.seedConfig({ baseUrl: BASE_URL });
    host.seedSecret('token', TOKEN);
    host.setFetchImpl(routedFetch([sections, ...routes]));

    const plugin = new PlexPlugin();
    await plugin.init(host);
    return { host, plugin };
}

const track = (ratingKey: string, title: string, artist = 'Portishead', extra: Record<string, unknown> = {}) => ({
    ratingKey,
    type: 'track',
    title,
    grandparentTitle: artist,
    duration: 200_000,
    ...extra,
});

/** The calls made to one path, as URLs. */
const callsTo = (host: FakePluginHost, pathname: string): URL[] => host.calls.map(call => new URL(call.url)).filter(url => url.pathname === pathname);

describe('init', () => {
    it('refuses to come up without a token rather than failing later on every call', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ baseUrl: BASE_URL });

        await expect(new PlexPlugin().init(host)).rejects.toMatchObject({ code: 'config' });
    });
});

describe('requests', () => {
    it('carries the token in a header, never the query string', async () => {
        const { host, plugin } = await build([url => (url.pathname === '/' ? { body: container({ friendlyName: 'Den' }) } : undefined)]);

        await plugin.testConnection();

        const call = host.calls[0]!;
        expect(call.headers?.['x-plex-token']).toBe(TOKEN);
        expect(call.headers?.['x-plex-client-identifier']).toBe('deadair-station');
        expect(call.url).not.toContain(TOKEN);
    });
});

describe('testConnection', () => {
    it('names the server and its music libraries, leaving out the others', async () => {
        const { plugin } = await build([url => (url.pathname === '/' ? { body: container({ friendlyName: 'Den', version: '1.43.4' }) } : undefined)]);

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected to Den 1.43.4. Music: Music.' });
    });

    it('fails a token that can see no music, since the plugin would be useless', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ baseUrl: BASE_URL });
        host.seedSecret('token', TOKEN);
        host.setFetchImpl(async raw => {
            const path = new URL(raw).pathname;
            const body = path === '/' ? container({ friendlyName: 'Den' }) : container({ Directory: [{ key: '2', type: 'movie', title: 'Films' }] });
            return new Response(JSON.stringify(body));
        });
        const plugin = new PlexPlugin();
        await plugin.init(host);

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('no music library') });
    });

    it('reports a rejected token instead of throwing it', async () => {
        const { plugin } = await build([url => (url.pathname === '/' ? { status: 401, body: '' } : undefined)]);

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('401') });
    });
});

describe('searchTracks', () => {
    it('reads the query as a title, and as an artist then a title, artist matches first', async () => {
        const { host, plugin } = await build([
            url =>
                url.pathname === '/library/sections/1/all' && url.searchParams.get('type') === '8'
                    ? { body: metadata({ ratingKey: '50', title: 'Portishead' }) }
                    : undefined,
            url => (url.pathname === '/library/metadata/50/allLeaves' ? { body: metadata(track('1', 'Roads'), track('2', 'Glory Box')) } : undefined),
            url =>
                url.pathname === '/library/sections/1/all'
                    ? { body: metadata(track('9', 'Portishead Glory Box', 'Someone'), track('2', 'Glory Box')) }
                    : undefined,
        ]);

        const found = await plugin.searchTracks('Portishead Glory Box', { limit: 10 });

        expect(found.map(row => row.id)).toEqual(['2', '9']);
        expect(
            callsTo(host, '/library/sections/1/all')
                .find(url => url.searchParams.get('type') === '8')!
                .searchParams.get('title'),
        ).toBe('Portishead');
        expect(callsTo(host, '/library/sections/2/all')).toHaveLength(0);
    });

    it('applies a period to the year on each candidate, leaving undated tracks out', async () => {
        const { plugin } = await build([
            url =>
                url.pathname === '/library/sections/1/all'
                    ? {
                          body: metadata(
                              track('1', 'Roads', 'P', { parentYear: 1994 }),
                              track('2', 'Roads', 'P', { parentYear: 2008 }),
                              track('3', 'Roads', 'P'),
                          ),
                      }
                    : undefined,
        ]);

        await expect(plugin.searchTracks('roads', { yearFrom: 1990, yearTo: 1999 }).then(rows => rows.map(row => row.id))).resolves.toEqual(['1']);
    });

    it('treats limit as a total and applies the offset after merging', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/library/sections/1/all' ? { body: metadata(track('1', 'a'), track('2', 'b'), track('3', 'c')) } : undefined),
        ]);

        await expect(plugin.searchTracks('word', { limit: 1, offset: 1 }).then(rows => rows.map(row => row.id))).resolves.toEqual(['2']);
    });
});

describe('getTrack', () => {
    it('finds a track by its rating key', async () => {
        const { plugin } = await build([url => (url.pathname === '/library/metadata/6' ? { body: metadata(track('6', 'Roads')) } : undefined)]);

        await expect(plugin.getTrack('6')).resolves.toMatchObject({ id: '6', title: 'Roads' });
    });

    it('answers undefined for a key that is gone, malformed, or not a track', async () => {
        const { host, plugin } = await build([
            url => (url.pathname === '/library/metadata/7' ? { status: 404, body: '' } : undefined),
            url =>
                url.pathname === '/library/metadata/8' ? { body: metadata({ ratingKey: '8', type: 'artist', title: 'The Killers' }) } : undefined,
        ]);

        await expect(plugin.getTrack('7')).resolves.toBeUndefined();
        await expect(plugin.getTrack('8')).resolves.toBeUndefined();
        await expect(plugin.getTrack('spotify:track:x')).resolves.toBeUndefined();
        expect(host.calls.some(call => call.url.includes('spotify'))).toBe(false);
    });
});

describe('listPlaylists', () => {
    it('lists audio playlists, then an Everything per music library, all reachable by paging', async () => {
        const { host, plugin } = await build([
            url =>
                url.pathname === '/playlists'
                    ? { body: metadata({ ratingKey: '13', title: 'Station Mix', leafCount: 5, composite: '/playlists/13/composite/99' }) }
                    : undefined,
            url => (url.pathname === '/identity' ? { body: container({ machineIdentifier: MACHINE }) } : undefined),
        ]);

        const all = await plugin.listPlaylists();
        expect(all.map(row => row.id)).toEqual(['13', 'plex:section:1']);
        expect(all[0]).toMatchObject({ trackCount: 5, artworkUrl: `${BASE_URL}/playlists/13/composite/99?X-Plex-Token=${TOKEN}` });
        expect(all[1]!.name).toBe('Everything');
        expect(callsTo(host, '/playlists')[0]!.searchParams.get('playlistType')).toBe('audio');
        await expect(plugin.listPlaylists({ offset: 1, limit: 1 }).then(rows => rows.map(row => row.id))).resolves.toEqual(['plex:section:1']);
    });

    it('learns the server id, so a pasted link to this server is claimed and one to another is not', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/playlists' ? { body: metadata() } : undefined),
            url => (url.pathname === '/identity' ? { body: container({ machineIdentifier: MACHINE }) } : undefined),
        ]);
        const link = (machine: string) => `https://app.plex.tv/desktop/#!/server/${machine}/playlist?key=${encodeURIComponent('/playlists/13')}`;

        expect(plugin.playlistIdFromUrl(link(MACHINE))).toBeUndefined();
        await plugin.listPlaylists();
        expect(plugin.playlistIdFromUrl(link(MACHINE))).toBe('13');
        expect(plugin.playlistIdFromUrl(link('elsewhere'))).toBeUndefined();
    });
});

describe('getPlaylistTracks', () => {
    it('lets the server page a playlist', async () => {
        const { host, plugin } = await build([url => (url.pathname === '/playlists/13/items' ? { body: metadata(track('6', 'Roads')) } : undefined)]);

        await plugin.getPlaylistTracks('13', { offset: 50, limit: 25 });

        const query = callsTo(host, '/playlists/13/items')[0]!.searchParams;
        expect(query.get('X-Plex-Container-Start')).toBe('50');
        expect(query.get('X-Plex-Container-Size')).toBe('25');
    });

    it('walks a whole library oldest addition first, the id breaking ties', async () => {
        const { host, plugin } = await build([
            url => (url.pathname === '/library/sections/1/all' ? { body: metadata(track('6', 'Roads')) } : undefined),
        ]);

        await plugin.getPlaylistTracks('plex:section:1', { offset: 100, limit: 50 });

        const query = callsTo(host, '/library/sections/1/all')[0]!.searchParams;
        expect(query.get('type')).toBe('10');
        expect(query.get('sort')).toBe('addedAt,id');
        expect(query.get('X-Plex-Container-Start')).toBe('100');
    });

    it('says not_found for a playlist or library the server does not have', async () => {
        const { plugin } = await build([
            url => (url.pathname.startsWith('/playlists/') || url.pathname.startsWith('/library/sections/9') ? { status: 404, body: '' } : undefined),
        ]);

        await expect(plugin.getPlaylistTracks('99')).rejects.toMatchObject({ code: 'not_found' });
        await expect(plugin.getPlaylistTracks('plex:section:9')).rejects.toMatchObject({ code: 'not_found' });
        await expect(plugin.getPlaylistTracks('junk')).rejects.toMatchObject({ code: 'not_found' });
    });
});

describe('artwork', () => {
    it("falls back to the album's picture, with the token, since Plex serves images only to callers it knows", async () => {
        const { plugin } = await build([
            url =>
                url.pathname === '/library/metadata/6'
                    ? { body: metadata(track('6', 'Roads', 'P', { parentThumb: '/library/metadata/5/thumb/123' })) }
                    : undefined,
        ]);

        await expect(plugin.getTrack('6')).resolves.toMatchObject({ artworkUrl: `${BASE_URL}/library/metadata/5/thumb/123?X-Plex-Token=${TOKEN}` });
    });
});

describe('resolveStreamUrl', () => {
    it("hands out the original file at its part's path, with the token in the query string", async () => {
        const { plugin } = await build([
            url =>
                url.pathname === '/library/metadata/6'
                    ? { body: metadata(track('6', 'Roads', 'P', { Media: [{ Part: [{ key: '/library/parts/2/179/file.flac' }] }] })) }
                    : undefined,
        ]);

        await expect(plugin.resolveStreamUrl('6')).resolves.toEqual({ url: `${BASE_URL}/library/parts/2/179/file.flac?X-Plex-Token=${TOKEN}` });
    });

    it('has no URL for a track with no file, or a key that is not a Plex key', async () => {
        const { plugin } = await build([url => (url.pathname === '/library/metadata/6' ? { body: metadata(track('6', 'Roads')) } : undefined)]);

        await expect(plugin.resolveStreamUrl('6')).resolves.toBeUndefined();
        await expect(plugin.resolveStreamUrl('navidrome-id')).resolves.toBeUndefined();
    });
});

describe('the library list', () => {
    it('is read once, however many calls need it', async () => {
        const { host, plugin } = await build([url => (url.pathname === '/library/sections/1/all' ? { body: metadata() } : undefined)]);

        await Promise.all([plugin.searchTracks('a'), plugin.searchTracks('b c')]);
        await plugin.searchTracks('d');

        expect(callsTo(host, '/library/sections')).toHaveLength(1);
    });
});

describe('enrichment', () => {
    const full = track('6971', 'Crimson Rider', 'Masterplan', {
        parentTitle: 'Aeronautics',
        parentStudio: 'AFM Records',
        parentThumb: '/library/metadata/6970/thumb/1',
        Guid: [{ id: 'mbid://6715e4cf-f5ad-35e1-8aa4-c7180c64ee78' }],
    });

    it('finds a track by title, then reads it whole for the label and the ids a listing leaves out', async () => {
        const { host, plugin } = await build([
            url => (url.pathname === '/library/sections/1/all' ? { body: metadata(track('6971', 'Crimson Rider', 'Masterplan')) } : undefined),
            url => (url.pathname === '/library/metadata/6971' ? { body: metadata(full) } : undefined),
        ]);

        const enrichment = await plugin.enrichTrack({ artist: 'Masterplan', title: 'Crimson Rider' });

        expect(enrichment).toMatchObject({
            providerRef: '6971',
            label: 'AFM Records',
            artworkUrl: `${BASE_URL}/library/metadata/6970/thumb/1?X-Plex-Token=${TOKEN}`,
        });
        expect(callsTo(host, '/library/sections/1/all')[0]!.searchParams.get('title')).toBe('Crimson Rider');
        expect(callsTo(host, '/library/metadata/6971')[0]!.searchParams.get('includeGuids')).toBe('1');
    });

    it('searches again without a decoration that the library does not carry (Plex compares without regard to case)', async () => {
        const { host, plugin } = await build([
            url =>
                url.pathname === '/library/sections/1/all'
                    ? {
                          body:
                              url.searchParams.get('title')?.toLowerCase() === 'crimson rider'
                                  ? metadata(track('6971', 'Crimson Rider', 'Masterplan'))
                                  : metadata(),
                      }
                    : undefined,
            url => (url.pathname === '/library/metadata/6971' ? { body: metadata(full) } : undefined),
        ]);

        await expect(plugin.enrichTrack({ artist: 'Masterplan', title: 'Crimson Rider (2011 Remaster)' })).resolves.toMatchObject({
            providerRef: '6971',
        });
        expect(callsTo(host, '/library/sections/1/all').map(url => url.searchParams.get('title'))).toEqual([
            'Crimson Rider (2011 Remaster)',
            'crimson rider',
        ]);
    });

    it('answers nothing for a track the library does not have', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/library/sections/1/all' ? { body: metadata(track('1', 'Crimson Rider', 'Somebody')) } : undefined),
        ]);

        await expect(plugin.enrichTrack({ artist: 'Masterplan', title: 'Crimson Rider' })).resolves.toEqual({});
    });

    it('looks an artist up by the key it answered with last time', async () => {
        const { host, plugin } = await build([
            url =>
                url.pathname === '/library/metadata/6928'
                    ? { body: metadata({ ratingKey: '6928', type: 'artist', title: 'Masterplan', summary: 'Bio.' }) }
                    : undefined,
        ]);

        await expect(plugin.enrichArtist({ name: 'Masterplan', providerRef: '6928' })).resolves.toMatchObject({
            providerRef: '6928',
            biography: 'Bio.',
        });
        expect(callsTo(host, '/library/sections/1/all')).toHaveLength(0);
    });

    it('heals a key Plex no longer answers to by searching again, which is what a renumbered library needs', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/library/metadata/111' ? { status: 404, body: '' } : undefined),
            url =>
                url.pathname === '/library/sections/1/all'
                    ? { body: metadata({ ratingKey: '6928', type: 'artist', title: 'Masterplan' }) }
                    : undefined,
            url =>
                url.pathname === '/library/metadata/6928'
                    ? { body: metadata({ ratingKey: '6928', type: 'artist', title: 'Masterplan' }) }
                    : undefined,
        ]);

        await expect(plugin.enrichArtist({ name: 'Masterplan', providerRef: '111' })).resolves.toMatchObject({ providerRef: '6928' });
    });

    it('does not take an album for the artist a stale key now names', async () => {
        const { plugin } = await build([
            url => (url.pathname === '/library/metadata/5' ? { body: metadata({ ratingKey: '5', type: 'album', title: 'Aeronautics' }) } : undefined),
            url => (url.pathname === '/library/sections/1/all' ? { body: metadata() } : undefined),
        ]);

        await expect(plugin.enrichArtist({ name: 'Masterplan', providerRef: '5' })).resolves.toEqual({});
    });

    it('finds a record by title and artist', async () => {
        const album = { ratingKey: '6970', type: 'album', title: 'Aeronautics', parentTitle: 'Masterplan', studio: 'AFM Records' };
        const { host, plugin } = await build([
            url => (url.pathname === '/library/sections/1/all' ? { body: metadata(album) } : undefined),
            url => (url.pathname === '/library/metadata/6970' ? { body: metadata(album) } : undefined),
        ]);

        await expect(plugin.enrichAlbum({ name: 'Aeronautics', artist: 'Masterplan' })).resolves.toMatchObject({
            providerRef: '6970',
            label: 'AFM Records',
        });
        expect(callsTo(host, '/library/sections/1/all')[0]!.searchParams.get('type')).toBe('9');
    });
});
