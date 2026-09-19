import { PluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Utils } from 'youtubei.js';

import type { UpstreamItem } from '../src/ytmusic.mapping.js';

/**
 * The client is stubbed rather than the wire, because what these tests are about is the plugin's
 * own judgement: which failures mean the credential, which rows are records, and how a page is cut.
 * The wire is covered in `ytmusic.fetch.test.ts`.
 */
const client = {
    assertSignedIn: vi.fn<() => Promise<string | undefined>>(),
    libraryPlaylists: vi.fn<() => Promise<UpstreamItem[]>>(),
    playlistItems: vi.fn<(id: string) => Promise<UpstreamItem[]>>(),
    likedPlaylist: vi.fn<() => Promise<{ name?: string; items: UpstreamItem[] } | undefined>>(),
    searchSongs: vi.fn<(query: string, limit?: number) => Promise<UpstreamItem[]>>(),
    track: vi.fn<(id: string) => Promise<UpstreamItem | undefined>>(),
};

vi.mock('../src/ytmusic.client.js', () => ({
    YtMusicClient: { create: vi.fn(async () => client) },
}));

const { YtMusicPlugin } = await import('../src/ytmusic.plugin.js');
const { YtMusicClient } = await import('../src/ytmusic.client.js');

const song = (id: string, title: string): UpstreamItem => ({
    id,
    item_type: 'song',
    title,
    artists: [{ name: 'Nina Simone' }],
    duration: { seconds: 180 },
});

const COOKIE = 'SID=abc; __Secure-3PAPISID=def';

async function build(): Promise<{ host: FakePluginHost; plugin: InstanceType<typeof YtMusicPlugin> }> {
    const host = createFakePluginHost();
    host.seedConfig({ resolverBaseUrl: 'http://localhost:9322' });
    host.seedSecret('cookie', COOKIE);
    const plugin = new YtMusicPlugin();
    await plugin.init(host);
    return { host, plugin };
}

beforeEach(() => {
    vi.clearAllMocks();
    client.assertSignedIn.mockResolvedValue('Robert Dean');
    client.libraryPlaylists.mockResolvedValue([]);
    client.likedPlaylist.mockResolvedValue(undefined);
    client.playlistItems.mockResolvedValue([]);
    client.searchSongs.mockResolvedValue([]);
    client.track.mockResolvedValue(undefined);
});

describe('the credential', () => {
    it('refuses to start without a cookie', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ resolverBaseUrl: 'http://localhost:9322' });
        await expect(new YtMusicPlugin().init(host)).rejects.toMatchObject({ code: 'config' });
    });

    it('proves the cookie by USING it, not by inspecting it', async () => {
        await build();

        // Every cheaper check was measured and is wrong. Removing __Secure-3PAPISID entirely left a
        // real account's library read working, so the string check the design note proposed would
        // reject cookies that work. `session.logged_in` stays true with every session cookie
        // corrupted. And a check that went through SEARCH could not fail at all, because search is
        // served to signed-out callers.
        expect(client.assertSignedIn).toHaveBeenCalledTimes(1);
    });

    it('asks the ACCOUNT, not the library, so an empty library is not mistaken for a dead cookie', async () => {
        // The correction a live account forced: an empty library section throws exactly the
        // ParsingError a signed-out page throws, so a library-based probe refuses a good cookie
        // belonging to an operator who simply has no playlists yet.
        await build();
        expect(client.libraryPlaylists).not.toHaveBeenCalled();
    });

    it('refuses to start when the cookie does not actually work', async () => {
        client.assertSignedIn.mockRejectedValue(new PluginError('YouTube Music did not accept the cookie: Page contents not found').withCode('auth'));

        const host = createFakePluginHost();
        host.seedConfig({ resolverBaseUrl: 'http://localhost:9322' });
        host.seedSecret('cookie', COOKIE);
        await expect(new YtMusicPlugin().init(host)).rejects.toMatchObject({ code: 'config' });
    });

    it('starts from a config saved before the resolver field existed', async () => {
        // The live case on any station that configured the catalog-only version: its row has a
        // cookie and no resolverBaseUrl. Parsing it strictly threw a ZodError and took the
        // catalog down with it.
        const host = createFakePluginHost();
        host.seedConfig({});
        host.seedSecret('cookie', COOKIE);
        const plugin = new YtMusicPlugin();

        await expect(plugin.init(host)).resolves.toBeUndefined();
        client.searchSongs.mockResolvedValue([song('a', 'A')]);
        await expect(plugin.searchTracks('jazz')).resolves.toHaveLength(1);
        // No resolver, so no audio -- answered as "not available", never thrown.
        await expect(plugin.resolveStreamUrl('a')).resolves.toBeUndefined();
    });

    it('starts for an account with no playlists at all', async () => {
        // The false-refusal case. `[]` is the truth about a station with nothing in its library.
        client.libraryPlaylists.mockResolvedValue([]);
        client.likedPlaylist.mockResolvedValue(undefined);

        const { plugin } = await build();
        await expect(plugin.listPlaylists()).resolves.toEqual([]);
    });

    it('accepts a cookie with no __Secure-3PAPISID, because that is not the tell-tale', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ resolverBaseUrl: 'http://localhost:9322' });
        host.seedSecret('cookie', 'SID=abc; HSID=xyz');

        await expect(new YtMusicPlugin().init(host)).resolves.toBeUndefined();
    });
});

describe('the account', () => {
    it('speaks for the first signed-in account unless told otherwise', async () => {
        const { host } = await build();
        expect(YtMusicClient.create).toHaveBeenCalledWith(host, COOKIE, 0);
    });

    it('speaks for the account the operator chose', async () => {
        // Measured: a browser holding a work account and a personal one put the operator's playlists on
        // index 1, and index 0 read an empty library without a word of complaint.
        const host = createFakePluginHost();
        host.seedConfig({ resolverBaseUrl: 'http://localhost:9322', accountIndex: '1' });
        host.seedSecret('cookie', COOKIE);
        await new YtMusicPlugin().init(host);

        expect(YtMusicClient.create).toHaveBeenCalledWith(host, COOKIE, 1);
    });

    it('names the account index in the connection test, since a name alone did not say which', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ resolverBaseUrl: 'http://localhost:9322', accountIndex: 1 });
        host.seedSecret('cookie', COOKIE);
        const plugin = new YtMusicPlugin();
        await plugin.init(host);
        host.queueResponse({ status: 200, body: '{"ok":true}' });

        await expect(plugin.testConnection()).resolves.toMatchObject({ message: expect.stringContaining('(account 1)') });
    });
});

describe('testConnection', () => {
    it('reports a failure rather than throwing, because an operator is mid-paste', async () => {
        const { plugin } = await build();
        client.assertSignedIn.mockRejectedValue(new PluginError('YouTube Music did not accept the cookie: Page contents not found').withCode('auth'));

        const result = await plugin.testConnection();
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/cookie/i);
    });

    it('confirms a working cookie, and names the account it is for', async () => {
        const { host, plugin } = await build();
        host.queueResponse({ status: 200, body: '{"ok":true}' });

        const result = await plugin.testConnection();
        expect(result.ok).toBe(true);
        expect(result.message).toContain('Connected to YouTube Music as Robert Dean (account 0).');
    });

    it('fails the test when the audio resolver is down, and still says search works', async () => {
        // #180's rule: an unreachable server the OPERATOR runs is a failed test.
        // Safe to report, because only a test that THROWS can quarantine a plugin.
        const { host, plugin } = await build();
        host.setFetchImpl(async () => {
            throw new Error('ECONNREFUSED');
        });

        const result = await plugin.testConnection();
        expect(result.ok).toBe(false);
        expect(result.message).toContain('Connected to YouTube Music');
        expect(result.message).toContain('search works and nothing will play');
        // The address, which is the field that has to be fixed.
        expect(result.message).toContain('localhost:9322');
    });

    it('never throws out of testConnection, whatever fails', async () => {
        // A throw is the only thing that can count against the plugin, and three
        // presses of a button must never be what takes it off the air.
        const { host, plugin } = await build();
        client.assertSignedIn.mockRejectedValue(new Error('boom'));
        host.setFetchImpl(async () => {
            throw new Error('ECONNREFUSED');
        });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });
});

describe('searchTracks', () => {
    it('answers nothing for a period it cannot apply', async () => {
        const { plugin } = await build();

        // The SDK's rule, and the alternative is worse than it looks: the caller merges providers
        // into one list with nothing marking which rows honoured the filter, so ignoring a period
        // does not degrade the answer, it poisons it.
        await expect(plugin.searchTracks('jazz', { yearFrom: 1955 })).resolves.toEqual([]);
        await expect(plugin.searchTracks('jazz', { yearTo: 1969 })).resolves.toEqual([]);
        expect(client.searchSongs).not.toHaveBeenCalled();
    });

    it('treats limit as a total rather than a page size', async () => {
        const { plugin } = await build();
        client.searchSongs.mockResolvedValue([song('a', 'A'), song('b', 'B'), song('c', 'C')]);

        await plugin.searchTracks('jazz', { limit: 3 });
        expect(client.searchSongs).toHaveBeenCalledWith('jazz', 3);
    });

    it('walks far enough to serve an offset the upstream has no notion of', async () => {
        const { plugin } = await build();
        client.searchSongs.mockResolvedValue([song('a', 'A'), song('b', 'B'), song('c', 'C')]);

        const tracks = await plugin.searchTracks('jazz', { limit: 1, offset: 2 });
        expect(client.searchSongs).toHaveBeenCalledWith('jazz', 3);
        expect(tracks.map(t => t.id)).toEqual(['c']);
    });

    it('reports an upstream failure as upstream, not as the credential', async () => {
        const { plugin } = await build();
        client.searchSongs.mockRejectedValue(new Error('connection reset'));

        await expect(plugin.searchTracks('jazz')).rejects.toMatchObject({ code: 'upstream' });
    });
});

describe('getTrack', () => {
    it('answers undefined for an id the provider does not know', async () => {
        const { plugin } = await build();
        await expect(plugin.getTrack('nope')).resolves.toBeUndefined();
    });

    it('maps a record it does know', async () => {
        const { plugin } = await build();
        client.track.mockResolvedValue(song('abc', 'Feeling Good'));

        await expect(plugin.getTrack('abc')).resolves.toMatchObject({ id: 'abc', title: 'Feeling Good' });
    });
});

describe('listPlaylists', () => {
    it('puts Liked Music in front when the library leaves it out', async () => {
        const { plugin } = await build();
        client.likedPlaylist.mockResolvedValue({ name: 'Liked Music', items: [song('a', 'A')] });
        client.libraryPlaylists.mockResolvedValue([{ id: 'VLPLabc', item_type: 'playlist', title: 'Late night' }]);

        const playlists = await plugin.listPlaylists();
        // The library's own form of the id, so the list has one id whichever path produced it.
        expect(playlists.map(p => p.id)).toEqual(['VLLM', 'VLPLabc']);
        expect(playlists[0]).toMatchObject({ name: 'Liked Music', trackCount: 1 });
    });

    it('does not add Liked Music a second time when the library already lists it', async () => {
        // The duplicate this fixes: the library lists it as VLLM once the account has likes, and the
        // plugin added its own copy as LM, de-duplicating against LM, so the two never matched.
        const { plugin } = await build();
        client.libraryPlaylists.mockResolvedValue([
            { id: 'VLLM', item_type: 'playlist', title: 'Liked Music', subtitle: 'Auto playlist' },
            { id: 'VLPLabc', item_type: 'playlist', title: 'Late night' },
        ]);

        const playlists = await plugin.listPlaylists();
        expect(playlists.map(p => p.id)).toEqual(['VLLM', 'VLPLabc']);
        // And it costs no second request to find out.
        expect(client.likedPlaylist).not.toHaveBeenCalled();
    });

    it('recognises the list in either form of its id', async () => {
        const { plugin } = await build();
        client.libraryPlaylists.mockResolvedValue([{ id: 'LM', item_type: 'playlist', title: 'Liked Music' }]);

        await expect(plugin.listPlaylists()).resolves.toHaveLength(1);
        expect(client.likedPlaylist).not.toHaveBeenCalled();
    });

    it('does not add an empty Liked Music', async () => {
        // A list with nothing to air is only noise in a picker.
        const { plugin } = await build();
        client.likedPlaylist.mockResolvedValue({ name: 'Liked Music', items: [] });
        client.libraryPlaylists.mockResolvedValue([{ id: 'VLPLabc', item_type: 'playlist', title: 'Late night' }]);

        await expect(plugin.listPlaylists()).resolves.toEqual([expect.objectContaining({ id: 'VLPLabc' })]);
    });

    it("never marks Liked Music as made by the provider, since it is the operator's own choices", async () => {
        // madeByProvider is what the console folds away, and it is for lists the SERVICE pushes at
        // the account. Marking this one folded one copy away and left the other showing.
        const { plugin } = await build();
        client.likedPlaylist.mockResolvedValue({ name: 'Liked Music', items: [song('a', 'A')] });

        const [liked] = await plugin.listPlaylists();
        expect(liked).not.toHaveProperty('madeByProvider');
    });

    it('drops the "New playlist" button that the Playlists view carries', async () => {
        const { plugin } = await build();
        client.libraryPlaylists.mockResolvedValue([
            { item_type: 'endpoint', title: 'New playlist' },
            { id: 'VLPLabc', item_type: 'playlist', title: 'Late night' },
        ]);

        await expect(plugin.listPlaylists()).resolves.toEqual([expect.objectContaining({ id: 'VLPLabc' })]);
    });

    it('reports a library failure as the credential, because that read needs it', async () => {
        const { plugin } = await build();
        client.libraryPlaylists.mockRejectedValue(new Utils.ParsingError('Expected node of any type Grid, MusicShelf, got ItemSection'));

        await expect(plugin.listPlaylists()).rejects.toMatchObject({ code: 'auth' });
    });
});

describe('getPlaylistTracks', () => {
    it('serves a later offset from the memo rather than walking the playlist again', async () => {
        const { plugin } = await build();
        client.playlistItems.mockResolvedValue([song('a', 'A'), song('b', 'B'), song('c', 'C')]);

        const first = await plugin.getPlaylistTracks('VLPLabc', { limit: 2, offset: 0 });
        const second = await plugin.getPlaylistTracks('VLPLabc', { limit: 2, offset: 2 });

        // YouTube pages by continuation token, so honouring an arbitrary offset means walking from
        // the start. Without the memo a sync over one playlist is quadratic in its length.
        expect(client.playlistItems).toHaveBeenCalledTimes(1);
        expect(first.map(t => t.id)).toEqual(['a', 'b']);
        expect(second.map(t => t.id)).toEqual(['c']);
    });

    it('answers an empty page past the end rather than erroring', async () => {
        const { plugin } = await build();
        client.playlistItems.mockResolvedValue([song('a', 'A')]);

        await expect(plugin.getPlaylistTracks('VLPLabc', { offset: 50 })).resolves.toEqual([]);
    });
});

describe('after dispose', () => {
    it('refuses to be used', async () => {
        const { plugin } = await build();
        await plugin.dispose();

        await expect(plugin.searchTracks('jazz')).rejects.toThrow(/was used before init\(\) or after dispose\(\)|not configured/);
    });
});
