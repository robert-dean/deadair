// The similarity capability. What is worth pinning: that each question is a strict search followed
// by the real request; that a fuzzy search result is REFUSED rather than quietly programming an
// hour from the wrong artist's neighbours; that every record carries the LEAD artist and not the
// credit line, since the pick path matches on it; and the three ways this correctly answers
// "nothing" without throwing — an artist Deezer does not carry, Deezer's own 200-with-error-800,
// and a call that has run out of budget between the two requests.

import { describe, expect, it } from 'vitest';

import { DeezerPlugin } from '../src/deezer.plugin.js';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

async function initedPlugin() {
    const host = createFakePluginHost();
    const plugin = new DeezerPlugin();
    await plugin.init(host);
    return { plugin, host };
}

/** A search answering with the act that was asked for. */
const searchHit = (id: number, name: string) => JSON.stringify({ data: [{ id, name }], total: 1 });

/** How Deezer says "nothing here": HTTP 200 carrying its own error object. */
const noData = JSON.stringify({ error: { type: 'DataException', message: 'no data', code: 800 } });

describe('similarArtists', () => {
    it('searches for the artist, then asks that id for its related artists', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: searchHit(1448283, 'Mitch Murder') });
        host.queueResponse({ body: JSON.stringify({ data: [{ id: 5, name: 'Kalax' }, { id: 6, name: 'Lazerhawk' }, { name: '  ' }] }) });

        const found = await plugin.similarArtists({ name: 'Mitch Murder' }, 8);

        expect(host.calls[0]?.url).toContain('search/artist');
        expect(host.calls[0]?.url).toContain('q=Mitch+Murder');
        expect(host.calls[1]?.url).toContain('artist/1448283/related');
        expect(host.calls[1]?.url).toContain('limit=8');
        expect(found).toEqual([
            { name: 'Kalax', providerRef: '5' },
            { name: 'Lazerhawk', providerRef: '6' },
        ]);
    });

    it('carries no match score, because Deezer publishes none', async () => {
        // Turning a position into a 0-to-1 number would hand the host something it is
        // entitled to compare against Last.fm's co-listening scores.
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: searchHit(1, 'Portishead') });
        host.queueResponse({ body: JSON.stringify({ data: [{ id: 2, name: 'Tricky' }] }) });

        const [first] = await plugin.similarArtists({ name: 'Portishead' }, 5);

        expect(first).not.toHaveProperty('match');
    });

    it('matches the artist name exactly, and never settles for what the search ranked first', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({
            body: JSON.stringify({
                data: [
                    { id: 99, name: 'Beck Goldsmith' },
                    { id: 98, name: 'Jeff Beck' },
                ],
            }),
        });

        expect(await plugin.similarArtists({ name: 'Beck' }, 8)).toEqual([]);
        // One call and no second: nothing was worth asking about.
        expect(host.calls).toHaveLength(1);
    });

    it('ignores case and accents when deciding the search found the right act', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: searchHit(7, 'Sigur Rós') });
        host.queueResponse({ body: JSON.stringify({ data: [{ id: 8, name: 'Jónsi' }] }) });

        expect(await plugin.similarArtists({ name: 'sigur ros' }, 4)).toEqual([{ name: 'Jónsi', providerRef: '8' }]);
    });

    it('answers nothing when Deezer reports no data', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: searchHit(3, 'Someone') });
        host.queueResponse({ body: noData });

        expect(await plugin.similarArtists({ name: 'Someone' }, 8)).toEqual([]);
    });

    it('raises anything that is not an empty answer, so an outage cannot read as no neighbours', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: searchHit(3, 'Someone') });
        host.queueResponse({ body: 'gateway down', status: 503 });

        await expect(plugin.similarArtists({ name: 'Someone' }, 8)).rejects.toThrow(/Deezer request failed/);
    });

    it('stops before the second request when the budget has run out', async () => {
        const { plugin, host } = await initedPlugin();
        host.seedRemainingMs(200);
        host.queueResponse({ body: searchHit(4, 'Someone') });

        expect(await plugin.similarArtists({ name: 'Someone' }, 8)).toEqual([]);
        expect(host.calls).toHaveLength(1);
    });
});

describe('artistTopTracks', () => {
    it('names each record by its lead artist rather than the credit line', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: searchHit(27, 'Daft Punk') });
        host.queueResponse({
            body: JSON.stringify({
                data: [
                    {
                        title: 'Get Lucky',
                        artist: { name: 'Daft Punk' },
                        contributors: [{ name: 'Daft Punk' }, { name: 'Pharrell Williams' }, { name: 'Nile Rodgers' }],
                        album: { title: 'Random Access Memories' },
                    },
                ],
            }),
        });

        expect(await plugin.artistTopTracks({ name: 'Daft Punk' }, 3)).toEqual([
            { title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories' },
        ]);
        expect(host.calls[1]?.url).toContain('artist/27/top');
    });

    it('drops a record with no artist of its own rather than assuming the one asked about', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: searchHit(27, 'Daft Punk') });
        host.queueResponse({ body: JSON.stringify({ data: [{ title: 'Unattributed' }, { title: 'Da Funk', artist: { name: 'Daft Punk' } }] }) });

        expect(await plugin.artistTopTracks({ name: 'Daft Punk' }, 3)).toEqual([{ title: 'Da Funk', artist: 'Daft Punk' }]);
    });

    it('answers nothing for an artist Deezer does not carry', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: JSON.stringify({ data: [] }) });

        expect(await plugin.artistTopTracks({ name: 'Nobody At All' }, 3)).toEqual([]);
    });
});

describe('testConnection', () => {
    it('reaches a fixed artist id and reports that nothing needs configuring', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: JSON.stringify({ id: 27, name: 'Daft Punk' }) });

        const result = await plugin.testConnection();

        expect(host.calls[0]?.url).toContain('artist/27');
        expect(result.ok).toBe(true);
        expect(result.message).toBe('Connected to Deezer. No account or API key is needed.');
    });

    it('reports a failure rather than throwing, so the host can keep retrying it', async () => {
        const { plugin, host } = await initedPlugin();
        host.queueResponse({ body: 'nope', status: 500 });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain('HTTP 500');
    });
});
