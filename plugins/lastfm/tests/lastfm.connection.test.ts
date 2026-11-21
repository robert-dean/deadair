// What the settings card's Test says when Last.fm refuses the key. Both refusals have to read as the
// key's problem: a suspended key used to come back as the raw upstream sentence, which says nothing
// about what to do.

import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { LASTFM_ERROR } from '../src/lastfm.client.js';
import { LastfmPlugin } from '../src/lastfm.plugin.js';

async function testAnswering(body: unknown): Promise<{ ok: boolean; message?: string }> {
    const host = createFakePluginHost();
    host.seedSecret('apiKey', 'key-abc');
    host.queueResponse({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const plugin = new LastfmPlugin();
    await plugin.init(host);
    return plugin.testConnection();
}

describe('Test, when Last.fm refuses the key', () => {
    it('says a wrong key was rejected', async () => {
        const result = await testAnswering({
            error: LASTFM_ERROR.invalidApiKey,
            message: 'Invalid API key - You must be granted a valid key by last.fm',
        });

        expect(result).toEqual({ ok: false, message: 'Last.fm rejected that API key.' });
    });

    it('says a suspended key was suspended, and where to look', async () => {
        const result = await testAnswering({ error: LASTFM_ERROR.suspendedApiKey, message: 'Suspended API key' });

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/suspended that API key/);
        expect(result.message).toMatch(/Last\.fm Pro/);
    });
});
