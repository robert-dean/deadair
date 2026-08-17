// `styleChartId` is the naming step that makes `tag.getTopTracks` reachable at all: the endpoint
// was wired into `fetchChart` from the start, but `listCharts` deliberately never enumerates it
// (a tag chart exists for every word anybody has applied), so nothing could name one without
// already knowing this plugin spells it `tag:`. What is worth pinning here is the id it hands back
// and the two ways it correctly answers "no chart" — no client, and no style.

import { describe, expect, it } from 'vitest';

import { LastfmPlugin } from '../src/lastfm.plugin.js';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

const API_KEY = 'key-abc';

async function initedPlugin(configured = true): Promise<LastfmPlugin> {
    const host = createFakePluginHost();
    if (configured) host.seedSecret('apiKey', API_KEY);
    const plugin = new LastfmPlugin();
    await plugin.init(host);
    return plugin;
}

describe('naming a style chart', () => {
    it('prefixes the style with the family this plugin\'s fetchChart already understands', async () => {
        const plugin = await initedPlugin();
        expect(plugin.styleChartId('heavy metal')).toBe('tag:heavy metal');
    });

    it('passes the style through verbatim rather than normalizing it', async () => {
        // Last.fm's tags are free text -- "Heavy Metal", "heavy-metal" and "heavy metal" are three
        // different charts to the service, so guessing a canonical spelling here would be as wrong
        // as not asking at all.
        const plugin = await initedPlugin();
        expect(plugin.styleChartId('Witch House')).toBe('tag:Witch House');
    });

    it('trims the style, since a model padding every field sends one with whitespace', async () => {
        const plugin = await initedPlugin();
        expect(plugin.styleChartId('  jazz  ')).toBe('tag:jazz');
    });

    it('answers with nothing for a blank style', async () => {
        const plugin = await initedPlugin();
        expect(plugin.styleChartId('   ')).toBeUndefined();
    });

    it('answers with nothing when there is no client, exactly like every other chart method', async () => {
        // No API key means no client at all, following `init`'s own comment -- a client refused on
        // every call would be a worse failure than one that never exists.
        const plugin = await initedPlugin(false);
        expect(plugin.styleChartId('jazz')).toBeUndefined();
    });
});

describe('reading the style chart back', () => {
    it('lands on tag.getTopTracks, which is what fetchChart already routes the tag: family to', async () => {
        // The id this hands back is not a new address -- `chartRequest` has recognised the `tag:`
        // family since charts existed. This is the seam: the id `styleChartId` names is the id
        // `fetchChart` reads, with nothing in between that could let the two drift apart.
        const host = createFakePluginHost();
        host.seedSecret('apiKey', API_KEY);
        const plugin = new LastfmPlugin();
        await plugin.init(host);

        const styleChartId = plugin.styleChartId('heavy metal');
        expect(styleChartId).toBeDefined();

        await plugin.fetchChart({ chartId: styleChartId!, limit: 10 });

        // The fake host throws when a caller reaches it with nothing queued, and `fetchChart`
        // catches every error and answers `[]` -- so the entries alone cannot tell "reached
        // tag.getTopTracks and got nothing back" apart from "the id named no family at all". The
        // outbound call is the fact that distinguishes them.
        const [call] = host.calls;
        expect(call?.url).toContain('method=tag.getTopTracks');
        // `+` and not `%20`: this is `URLSearchParams`, matching how `LastfmClient.get` builds it.
        expect(call?.url).toContain('tag=heavy+metal');
    });
});
