// The catalog half of the plugin, against recorded Pandora answers where there are any. The account's
// own playlist list is the one shape not yet recorded (the account had none), and is said to be.

import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { PandoraPlugin } from '../src/pandora.plugin.js';
import { fakePandora, fixture, type FakePandora } from './pandora.fake.js';

async function build(): Promise<{ fake: FakePandora; plugin: PandoraPlugin }> {
    const fake = fakePandora();
    const plugin = new PandoraPlugin();
    await plugin.init(fake.host);
    return { fake, plugin };
}

const track = (id: string, name = `Track ${id}`) => ({ [id]: { name, artistName: 'Portishead', duration: 200 } });

describe('init', () => {
    it('refuses to come up without a password rather than failing later on every call', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ email: 'listener@example.com' });

        await expect(new PandoraPlugin().init(host)).rejects.toMatchObject({ code: 'config' });
    });
});

describe('testConnection', () => {
    it('says a Premium account is ready', async () => {
        const { fake, plugin } = await build();
        fake.userLogin = { stat: 'ok', result: { userId: 'u', userAuthToken: 't', isSubscriber: true } };

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Signed in to Pandora Premium.' });
    });

    it('says a free account can search but not play', async () => {
        const { plugin } = await build();

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('not Pandora Premium') });
    });

    it('reports a refusal instead of throwing it, because this is a button next to the form', async () => {
        const { fake, plugin } = await build();
        fake.userLogin = { stat: 'fail', code: 1002 };

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('email or password') });
    });
});

describe('searchTracks', () => {
    it('reads the tracks out of a recorded search, in rank order, and nothing else', async () => {
        const { fake, plugin } = await build();
        fake.web['v3/sod/search'] = { body: fixture('search').body };

        const found = await plugin.searchTracks('radiohead no surprises', { limit: 10 });

        // The recording ranks albums and a playlist among them; Pandora sent the same page again for the
        // second ask, which must not double the answer.
        expect(found.map(t => t.id)).toEqual(['TR:47617', 'TR:102590481', 'TR:126195378', 'TR:24465570', 'TR:7731451', 'TR:7731460']);
        expect(found[0]).toMatchObject({ id: 'TR:47617', title: 'No Surprises', artists: ['Radiohead'] });
        expect(found.every(t => t.id.startsWith('TR:'))).toBe(true);
    });

    it('asks for tracks only, from where the caller said', async () => {
        const { fake, plugin } = await build();
        fake.web['v3/sod/search'] = { body: { results: [] } };

        await plugin.searchTracks('portishead', { limit: 20, offset: 40 });

        expect(fake.webCalls[0]!.body).toMatchObject({ query: 'portishead', types: ['TR'], start: 40, count: 20, annotate: true });
    });

    it('pages up to the total it was asked for', async () => {
        const { fake, plugin } = await build();
        fake.web['v3/sod/search'] = body => {
            const ids = Array.from({ length: body.count }, (_, i) => `TR:${body.start + i}`);
            return { body: { results: ids, annotations: Object.assign({}, ...ids.map(id => track(id))) } };
        };

        const found = await plugin.searchTracks('anything', { limit: 120 });

        expect(found).toHaveLength(120);
        expect(fake.webCalls.map(call => [call.body.start, call.body.count])).toEqual([
            [0, 50],
            [50, 50],
            [100, 20],
        ]);
    });

    it('declines a narrowed search rather than answering it unfiltered', async () => {
        const { fake, plugin } = await build();

        await expect(plugin.searchTracks('anything', { yearFrom: 1990 })).resolves.toEqual([]);
        expect(fake.webCalls).toHaveLength(0);
    });
});

describe('getTrack', () => {
    it('describes a track from its annotation', async () => {
        const { fake, plugin } = await build();
        fake.web['v4/catalog/annotateObjects'] = { body: fixture('annotate.objects').body };

        await expect(plugin.getTrack('TR:47617')).resolves.toMatchObject({ id: 'TR:47617', isrc: 'GBAYE9700386', album: 'OK Computer' });
        expect(fake.webCalls[0]!.body).toEqual({ pandoraIds: ['TR:47617'] });
    });

    it('is nothing for an id that is not a Pandora track, without asking', async () => {
        const { fake, plugin } = await build();

        await expect(plugin.getTrack('spotify:track:1')).resolves.toBeUndefined();
        expect(fake.webCalls).toHaveLength(0);
    });
});

// A shape from pandora-tui's working client, not from a recording: see the plugin README.
describe('listPlaylists', () => {
    it("lists the account's playlists, keeping one it could not describe", async () => {
        const { fake, plugin } = await build();
        fake.web['v6/collections/getSortedPlaylists'] = {
            body: {
                items: [{ pandoraId: 'PL:1:10' }, { pandoraId: 'ST:0:99' }, { pandoraId: 'PL:1:11', name: 'Undescribed' }],
                annotations: { 'PL:1:10': { name: 'Drive', totalTracks: 12 } },
                totalCount: 3,
            },
        };

        await expect(plugin.listPlaylists()).resolves.toEqual([
            { id: 'PL:1:10', name: 'Drive', trackCount: 12, permissions: ['read'] },
            { id: 'PL:1:11', name: 'Undescribed', permissions: ['read'] },
        ]);
    });
});

describe('getPlaylistTracks', () => {
    it('reads a recorded page of a public playlist, asking for every record its details', async () => {
        const { fake, plugin } = await build();
        const page = fixture('playlist.tracks').body as { tracks: Array<{ pandoraId: string }> };
        fake.web['v7/playlists/getTracks'] = { body: page };
        fake.web['v4/catalog/annotateObjects'] = body => ({ body: Object.assign({}, ...body.pandoraIds.map((id: string) => track(id))) });

        const tracks = await plugin.getPlaylistTracks('PL:844424994606591:1745910464', { limit: 10 });

        expect(tracks.map(t => t.id)).toEqual(page.tracks.map(entry => entry.pandoraId));
        expect(fake.webCalls.find(call => call.endpoint === 'v4/catalog/annotateObjects')!.body.pandoraIds).toHaveLength(10);
    });

    it("asks for the details Pandora's page left out, and keeps the playlist's order", async () => {
        const { fake, plugin } = await build();
        fake.web['v7/playlists/getTracks'] = { body: { tracks: [{ pandoraId: 'TR:2' }, { pandoraId: 'TR:1' }], totalTracks: 2, annotations: track('TR:2', 'Second') } };
        fake.web['v4/catalog/annotateObjects'] = { body: track('TR:1', 'First') };

        const tracks = await plugin.getPlaylistTracks('PL:1:10');

        expect(tracks.map(t => t.title)).toEqual(['Second', 'First']);
        expect(fake.webCalls.find(call => call.endpoint === 'v4/catalog/annotateObjects')!.body).toEqual({ pandoraIds: ['TR:1'] });
    });

    it('reads one page from where the caller said', async () => {
        const { fake, plugin } = await build();
        fake.web['v7/playlists/getTracks'] = { body: { tracks: [], totalTracks: 0 } };

        await plugin.getPlaylistTracks('PL:1:10', { limit: 25, offset: 50 });

        expect(fake.webCalls[0]!.body).toEqual({ request: { pandoraId: 'PL:1:10', offset: 50, limit: 25 } });
    });
});

describe('playlistIdFromUrl', () => {
    it('claims a Pandora playlist link and nothing else', async () => {
        const { plugin } = await build();

        expect(plugin.playlistIdFromUrl('https://www.pandora.com/playlist/PL:1:2')).toBe('PL:1:2');
        expect(plugin.playlistIdFromUrl('https://open.spotify.com/playlist/x')).toBeUndefined();
    });
});
