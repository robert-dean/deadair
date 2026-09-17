import { createFakePluginHost, fakeHostFetchResponse, type FakePluginHost } from '@deadair/plugin-sdk/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHostFetch } from '../src/ytmusic.fetch.js';

let host: FakePluginHost;

beforeEach(() => {
    host = createFakePluginHost();
});

describe('createHostFetch', () => {
    it('takes a string url', async () => {
        host.queueResponse({ status: 200, body: '{}' });
        await createHostFetch(host)('https://www.youtube.com/youtubei/v1/search');

        expect(host.calls[0]!.url).toBe('https://www.youtube.com/youtubei/v1/search');
    });

    it('takes a URL object', async () => {
        host.queueResponse({ status: 200, body: '{}' });
        await createHostFetch(host)(new URL('https://www.youtube.com/sw.js_data'));

        expect(host.calls[0]!.url).toBe('https://www.youtube.com/sw.js_data');
    });

    it('takes a Request object and reads its body', async () => {
        host.queueResponse({ status: 200, body: '{}' });
        await createHostFetch(host)(
            new Request('https://www.youtube.com/youtubei/v1/browse', { method: 'POST', body: '{"browseId":"FEmusic_liked_playlists"}' }),
        );

        expect(host.calls[0]).toMatchObject({
            url: 'https://www.youtube.com/youtubei/v1/browse',
            method: 'POST',
            body: '{"browseId":"FEmusic_liked_playlists"}',
        });
    });

    it('prefers init over the Request when both carry a body, as fetch itself does', async () => {
        // Observed live: the search call arrives as a Request object AND a separate init holding
        // the body. Reading only one of the two is how a search posts the wrong thing.
        host.queueResponse({ status: 200, body: '{}' });
        await createHostFetch(host)(new Request('https://www.youtube.com/youtubei/v1/search', { method: 'POST', body: '{"from":"request"}' }), {
            method: 'POST',
            body: '{"from":"init"}',
        });

        expect(host.calls[0]!.body).toBe('{"from":"init"}');
    });

    it("merges the Request's headers under init's", async () => {
        host.queueResponse({ status: 200, body: '{}' });
        await createHostFetch(host)(
            new Request('https://www.youtube.com/youtubei/v1/search', { headers: { 'x-from-request': 'yes', 'x-both': 'request' } }),
            {
                headers: { 'x-both': 'init' },
            },
        );

        expect(host.calls[0]!.headers).toMatchObject({ 'x-from-request': 'yes', 'x-both': 'init' });
    });

    it('defaults to GET when neither says', async () => {
        host.queueResponse({ status: 200, body: '{}' });
        await createHostFetch(host)('https://www.youtube.com/sw.js_data');

        expect(host.calls[0]!.method).toBe('GET');
    });

    it('refuses a body that is not a string rather than truncating it', async () => {
        // HostFetchInit.body is a string only. youtubei.js carries @bufbuild/protobuf, so a binary
        // body is the plausible way this stops working; measured, it never sends one, because
        // continuation tokens are protobuf base64'd into the JSON. If that changes, it says so here
        // rather than posting nonsense and leaving a parser error to explain it.
        await expect(
            createHostFetch(host)('https://www.youtube.com/youtubei/v1/search', { method: 'POST', body: new Uint8Array([1, 2, 3]) }),
        ).rejects.toMatchObject({
            code: 'internal',
        });

        expect(host.calls).toHaveLength(0);
    });

    it('refuses a method the host cannot express', async () => {
        await expect(createHostFetch(host)('https://www.youtube.com/', { method: 'TRACE' })).rejects.toMatchObject({ code: 'internal' });
    });

    it("hands back the host's own Response rather than rebuilding one", async () => {
        // A rebuilt Response has to special-case 204/304, whose constructor rejects a body.
        const response = fakeHostFetchResponse({ status: 204 });
        host.setFetchImpl(async () => response);

        expect(await createHostFetch(host)('https://www.youtube.com/')).toBe(response);
    });
});

describe('the manifest stays honest', () => {
    const globalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = globalFetch;
    });

    it('never reaches global fetch itself', async () => {
        const escaped = vi.fn(async () => fakeHostFetchResponse({ status: 200, body: '{}' }));
        globalThis.fetch = escaped as unknown as typeof globalThis.fetch;
        host.queueResponse({ status: 200, body: '{}' });

        await createHostFetch(host)('https://www.youtube.com/youtubei/v1/search', { method: 'POST', body: '{}' });

        expect(escaped).not.toHaveBeenCalled();
        expect(host.calls).toHaveLength(1);
    });

    it('does not let youtubei.js reach global fetch either', async () => {
        // THE regression test for this plugin's central claim. `permissions.network` is a promise
        // to the operator that this plugin reaches www.youtube.com and nothing else, and a plugin
        // runs in the host's own realm, so nothing STOPS the library going around `host.fetch` --
        // it simply does not, today, which was measured rather than assumed. A version bump is
        // exactly how that would change, silently, leaving the manifest a lie.
        //
        // The session is not expected to succeed here: the fake host serves it nothing usable. The
        // assertion is only that global fetch was never touched on the way to failing.
        const escaped = vi.fn(async () => fakeHostFetchResponse({ status: 200, body: '{}' }));
        globalThis.fetch = escaped as unknown as typeof globalThis.fetch;
        host.setFetchImpl(async () => fakeHostFetchResponse({ status: 200, body: '{}' }));

        const { Innertube } = await import('youtubei.js');
        await Innertube.create({ fetch: createHostFetch(host), retrieve_player: false }).catch(() => undefined);

        expect(escaped).not.toHaveBeenCalled();
        expect(host.calls.length).toBeGreaterThan(0);
    });
});
