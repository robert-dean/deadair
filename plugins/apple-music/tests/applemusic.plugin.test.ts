// What this plugin decides for itself: which of its two upstreams it is on, that a filter it cannot
// push upstream is applied here rather than ignored, and that the audio half asks the host instead of
// pretending to mint a URL.

import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppleMusicPlugin } from '../src/applemusic.plugin.js';

const itunesRow = (id: number, name: string, year = 1994) => ({
    wrapperType: 'track',
    kind: 'song',
    trackId: id,
    trackName: name,
    artistName: 'Portishead',
    collectionName: 'Dummy',
    trackTimeMillis: 306_000,
    releaseDate: `${year}-08-22T07:00:00Z`,
    trackExplicitness: 'notExplicit',
});

describe('AppleMusicPlugin, with no developer key', () => {
    let host: FakePluginHost;
    let plugin: AppleMusicPlugin;

    beforeEach(async () => {
        host = createFakePluginHost();
        host.seedConfig({ storefront: 'gb' });
        plugin = new AppleMusicPlugin();
        await plugin.init(host);
    });

    it('searches the public Search API, so a station needs no developer membership', async () => {
        host.queueResponse({ body: JSON.stringify({ results: [itunesRow(1_440_653_203, 'Roads')] }) });

        const found = await plugin.searchTracks('portishead roads', { limit: 5 });

        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ id: '1440653203', title: 'Roads' });
        expect(host.calls[0]?.url).toContain('itunes.apple.com/search');
        // The storefront setting steers both modes, so an operator does not get a US catalog from one and
        // a British one from the other.
        expect(host.calls[0]?.url).toContain('country=gb');
    });

    it('applies a year filter itself, because neither upstream takes one', async () => {
        host.queueResponse({ body: JSON.stringify({ results: [itunesRow(1, 'Roads', 1994), itunesRow(2, 'Later', 2015)] }) });

        const found = await plugin.searchTracks('portishead', { limit: 5, yearFrom: 2000 });

        expect(found.map(track => track.id)).toEqual(['2']);
    });

    it('has no playlists to offer, and says so with an empty list rather than a failure', async () => {
        // The true answer for this upstream. The host reads a short page as the end of a list, so an empty
        // one is the honest shape and an error would take the plugin off the station over a missing feature.
        expect(await plugin.listPlaylists()).toEqual([]);
        expect(await plugin.getPlaylistTracks('anything')).toEqual([]);
    });

    it('looks one record up by its catalog id', async () => {
        host.queueResponse({ body: JSON.stringify({ results: [itunesRow(1_440_653_203, 'Roads')] }) });

        expect(await plugin.getTrack('1440653203')).toMatchObject({ id: '1440653203' });
        expect(host.calls[0]?.url).toContain('itunes.apple.com/lookup');
    });

    it('names which upstream it is on, so a thin catalog is explained rather than puzzling', async () => {
        host.queueResponse({ body: JSON.stringify({ results: [itunesRow(1, 'Roads')] }) });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('no developer key');
    });

    it('reports a refusal as a failed connection rather than throwing out of the test button', async () => {
        host.queueResponse({ status: 503 });

        expect(await plugin.testConnection()).toMatchObject({ ok: false });
    });
});

describe('AppleMusicPlugin, with a developer key', () => {
    it('signs a bearer token and reads the documented API', async () => {
        const { privateKey } = await import('node:crypto').then(crypto =>
            crypto.generateKeyPairSync('ec', {
                namedCurve: 'prime256v1',
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                publicKeyEncoding: { type: 'spki', format: 'pem' },
            }),
        );

        const host = createFakePluginHost();
        host.seedConfig({ storefront: 'us', teamId: 'DEF123GHIJ', keyId: 'ABC123DEFG', privateKey });
        const plugin = new AppleMusicPlugin();
        await plugin.init(host);

        host.queueResponse({
            body: JSON.stringify({
                results: { songs: { data: [{ id: '1440653203', attributes: { name: 'Roads', artistName: 'Portishead', isrc: 'GBAAA9400050' } }] } },
            }),
        });

        const found = await plugin.searchTracks('roads', { limit: 1 });

        // The ISRC is what this mode buys, and it is the reason to pay Apple for a key.
        expect(found[0]?.isrc).toBe('GBAAA9400050');
        expect(host.calls[0]?.url).toContain('api.music.apple.com/v1/catalog/us/search');
        expect(host.calls[0]?.headers?.authorization).toMatch(/^Bearer ey/);
    });
});

describe('resolveStreamUrl', () => {
    it('asks the host for a player URL rather than minting one', async () => {
        // There is no Apple Music URL to mint at any price. The host signs a URL onto the player container
        // because the bridge secret is the station's, not the plugin's.
        const host = createFakePluginHost();
        const plugin = new AppleMusicPlugin();
        await plugin.init(host);

        const stream = await plugin.resolveStreamUrl('1440653203');

        expect(stream?.url).toContain('/track/');
        expect(host.trackFetcher.servePlayer).toHaveBeenCalledWith({ trackId: '1440653203' });
    });

    it('passes a station with no player straight through as undefined', async () => {
        // An item nobody can resolve is skipped, not an error: an operator who never set the stream side
        // up is a normal state.
        const host = createFakePluginHost();
        host.seedFetchedTrack(undefined);
        const plugin = new AppleMusicPlugin();
        await plugin.init(host);

        expect(await plugin.resolveStreamUrl('1440653203')).toBeUndefined();
    });
});
