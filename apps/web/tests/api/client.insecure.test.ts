import { afterEach, describe, expect, it, vi } from 'vitest';

import { sdk } from '../../src/api/client';

// The real SDK behind the real console client, with only the network and the page's security
// context faked. `client.test.ts` replaces the SDK wholesale to drive the refresh path, which is
// exactly why it could never have caught this: the failure was inside the SDK's own transport.

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('api/client over plain HTTP', () => {
    it('reaches the network on a page with no randomUUID', async () => {
        // Issue #78. A station opened at http://<its LAN address>:8080 is not a secure context, so
        // `crypto.randomUUID` is undefined there; the SDK's default request id called it and threw
        // before `fetch` ran, on every request the console made. The console passes no factory of
        // its own, so this holds the generated default (ContractKit 0.38.12 and later) to working.
        const real = globalThis.crypto;
        vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);

        await expect(sdk.authentication.factors.listFactors()).resolves.toEqual([]);

        expect(fetch).toHaveBeenCalledTimes(1);
        const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>;
        expect(headers['X-Request-ID']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
