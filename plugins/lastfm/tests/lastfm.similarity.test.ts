// The similarity capability, which until `similarTracks` arrived had no tests at the plugin level at
// all. What is worth pinning: which endpoint each question reaches and with what; that every record
// carries the LEAD artist the service spelled rather than the one asked about, since the pick path
// matches on it; and the two ways each correctly answers "nothing" (no client, and a name the
// service has never heard of) without throwing.

import { describe, expect, it } from 'vitest';

import { LastfmPlugin } from '../src/lastfm.plugin.js';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

const API_KEY = 'key-abc';

async function initedPlugin(configured = true) {
    const host = createFakePluginHost();
    if (configured) host.seedSecret('apiKey', API_KEY);
    const plugin = new LastfmPlugin();
    await plugin.init(host);
    return { plugin, host };
}

/** How the service answers a name it does not know: HTTP 200 with its own error number. */
const notFound = JSON.stringify({ error: 6, message: 'Track not found' });

describe('similarArtists', () => {
    it('asks artist.getSimilar and passes the score through as a number between 0 and 1', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({
            body: JSON.stringify({
                similarartists: {
                    artist: [
                        { name: 'Tricky', mbid: 'mb-1', match: '0.91' },
                        { name: ' ', match: '0.5' },
                    ],
                },
            }),
        });

        const found = await plugin.similarArtists({ name: 'Portishead' }, 8);

        expect(host.calls[0]?.url).toContain('method=artist.getSimilar');
        expect(host.calls[0]?.url).toContain('artist=Portishead');
        expect(found).toEqual([{ name: 'Tricky', mbid: 'mb-1', providerRef: 'Tricky', match: 0.91 }]);
    });

    it('answers nothing for an artist the service has never heard of', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: notFound });

        expect(await plugin.similarArtists({ name: 'Nobody At All' }, 8)).toEqual([]);
    });
});

describe('artistTopTracks', () => {
    it("names each record by the service's own spelling of the artist", async () => {
        // `autocorrect` may have changed it, and the pick path matches on what it is given.
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: JSON.stringify({ toptracks: { track: [{ name: 'Karmacoma', artist: { name: 'Massive Attack' } }] } }) });

        expect(await plugin.artistTopTracks({ name: 'massive attack' }, 3)).toEqual([{ title: 'Karmacoma', artist: 'Massive Attack' }]);
        expect(host.calls[0]?.url).toContain('method=artist.getTopTracks');
    });
});

describe('similarTracks', () => {
    it('asks track.getSimilar by artist and title, and names each record by its own artist', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({
            body: JSON.stringify({
                similartracks: {
                    track: [
                        { name: 'Overcome', match: 1, artist: { name: 'Tricky' } },
                        { name: 'Glory Box', match: 0.8, artist: { name: 'Portishead' } },
                    ],
                },
            }),
        });

        const found = await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5);

        expect(host.calls[0]?.url).toContain('method=track.getSimilar');
        expect(host.calls[0]?.url).toContain('artist=Massive+Attack');
        expect(host.calls[0]?.url).toContain('track=Teardrop');
        expect(found).toEqual([
            { title: 'Overcome', artist: 'Tricky' },
            { title: 'Glory Box', artist: 'Portishead' },
        ]);
    });

    it('asks by recording id instead when the catalog has one, since it cannot match the wrong record', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: JSON.stringify({ similartracks: { track: [] } }) });

        await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop', mbid: 'rec-1' }, 5);

        expect(host.calls[0]?.url).toContain('mbid=rec-1');
        expect(host.calls[0]?.url).not.toContain('track=Teardrop');
    });

    it('passes over a record with no artist of its own rather than guessing the one asked about', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: JSON.stringify({ similartracks: { track: { name: 'Orphan' } } }) });

        expect(await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5)).toEqual([]);
    });

    it('answers nothing for a record the service has never heard of', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: notFound });

        expect(await plugin.similarTracks({ artist: 'Nobody', title: 'Nothing' }, 5)).toEqual([]);
    });

    it('answers nothing and calls nothing without an API key', async () => {
        const { plugin, host } = await initedPlugin(false);

        expect(await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5)).toEqual([]);
        expect(host.calls).toEqual([]);
    });
});
