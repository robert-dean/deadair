import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStationSdk } from '../../src/station/station.client.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('createStationSdk', () => {
    it('asks under the API prefix, with the key as a bearer and the plugin as the agent', async () => {
        const fetch = vi.fn(
            async (_url: string, _init: RequestInit) => new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } }),
        );
        vi.stubGlobal('fetch', fetch);
        const sdk = createStationSdk(
            { origin: 'https://radio.example.com', apiBase: 'https://radio.example.com/api', apiKey: 'da_key' },
            'deadair-streamdeck/0.1.0',
        );

        await sdk.playout.getPlayoutStatus();

        const [url, init] = fetch.mock.calls[0]!;
        expect(url).toBe('https://radio.example.com/api/playout/status');
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer da_key');
        expect(headers['User-Agent']).toBe('deadair-streamdeck/0.1.0');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
});
