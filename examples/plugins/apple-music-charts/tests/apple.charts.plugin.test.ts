import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppleMusicChartsPlugin, CHART_ID } from '../src/apple.charts.plugin.js';

/** Three entries in the shape Apple's feed answers with, trimmed to the fields the plugin reads. */
const FEED = {
    feed: {
        title: 'Top Songs',
        country: 'gb',
        results: [
            { id: '1', name: 'Man I Need', artistName: 'Olivia Dean', artistUrl: 'https://music.apple.com/gb/artist/olivia-dean/1487253329' },
            {
                id: '2',
                name: "Movin' To The Sun",
                artistName: 'HUGEL, Imael Angel & Ultra Naté',
                artistUrl: 'https://music.apple.com/gb/artist/hugel/978839124',
            },
            {
                id: '3',
                name: 'Rein Me In',
                artistName: 'Sam Fender & Olivia Dean',
                artistUrl: 'https://music.apple.com/gb/artist/sam-fender/1213989970',
            },
        ],
    },
};

let host: FakePluginHost;
let plugin: AppleMusicChartsPlugin;

beforeEach(async () => {
    host = createFakePluginHost();
    host.seedConfig({ country: 'gb' });
    plugin = new AppleMusicChartsPlugin();
    await plugin.init(host);
});

describe('AppleMusicChartsPlugin', () => {
    it('offers one chart, for the country the operator chose', async () => {
        expect(await plugin.listCharts()).toEqual([{ id: CHART_ID, name: 'Top Songs: United Kingdom', country: 'GB' }]);
    });

    it("asks Apple for that country's chart and ranks what comes back", async () => {
        host.queueResponse({ body: JSON.stringify(FEED) });

        const entries = await plugin.fetchChart({ chartId: CHART_ID, limit: 10 });

        expect(host.calls[0]?.url).toBe('https://rss.marketingtools.apple.com/api/v2/gb/music/most-played/100/songs.json');
        expect(entries).toEqual([
            { rank: 1, title: 'Man I Need', artist: 'Olivia Dean' },
            { rank: 2, title: "Movin' To The Sun", artist: 'HUGEL', featuring: ['Imael Angel', 'Ultra Naté'] },
            { rank: 3, title: 'Rein Me In', artist: 'Sam Fender', featuring: ['Olivia Dean'] },
        ]);
    });

    it('returns no more entries than it was asked for', async () => {
        host.queueResponse({ body: JSON.stringify(FEED) });

        expect(await plugin.fetchChart({ chartId: CHART_ID, limit: 2 })).toHaveLength(2);
    });

    it('answers an id it never offered with an empty chart, and asks nobody', async () => {
        expect(await plugin.fetchChart({ chartId: 'top-albums', limit: 10 })).toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('turns a refusal into a PluginError the station can act on', async () => {
        host.queueResponse({ status: 503, statusText: 'Service Unavailable' });

        await expect(plugin.fetchChart({ chartId: CHART_ID, limit: 10 })).rejects.toMatchObject({ code: 'unavailable', upstreamStatus: 503 });
    });

    it('reports a working connection by naming the number one', async () => {
        host.queueResponse({ body: JSON.stringify(FEED) });

        expect(await plugin.testConnection()).toEqual({ ok: true, message: 'Apple answered: number one is Man I Need by Olivia Dean.' });
    });

    it('reports a failed connection rather than throwing', async () => {
        host.queueResponse({ status: 500, statusText: 'Internal Server Error' });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain('500');
    });
});
