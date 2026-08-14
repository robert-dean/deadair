// This API has two ways of saying "no such thing" and the client has to recognise both, because
// the host's contract turns on the difference between a miss and a fault: a miss is `{}` and gets a
// short-lived miss row, and a fault is logged and re-asked forever. Getting it wrong cost 66 albums
// out of 75 on the first live enrichment pass, so both shapes are pinned here.

import { describe, expect, it, vi } from 'vitest';
import type { PluginHost } from '@deadair/plugin-sdk';

import { LastfmClient, LastfmRequestError, LASTFM_ERROR } from '../src/lastfm.client.js';

/** A host whose `fetch` answers with one canned response. */
function hostAnswering(status: number, body: unknown, statusText = ''): { host: PluginHost; fetch: ReturnType<typeof vi.fn> } {
    const fetch = vi.fn(
        async () =>
            new Response(typeof body === 'string' ? body : JSON.stringify(body), {
                status,
                statusText,
                headers: { 'content-type': 'application/json' },
            }),
    );
    return { host: { fetch, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as PluginHost, fetch };
}

const client = (status: number, body: unknown) => new LastfmClient(hostAnswering(status, body).host, 'key', 'secret');

describe('a failure under HTTP 200, which is how most of them arrive', () => {
    it('is read off the body and carries the error number', async () => {
        const failing = client(200, { error: LASTFM_ERROR.invalidParameters, message: 'Track not found' });

        await expect(failing.get('track.getInfo')).rejects.toMatchObject({
            apiError: LASTFM_ERROR.invalidParameters,
            code: 'not_found',
        });
    });

    it("reads a bad key as the operator's problem rather than the upstream's", async () => {
        // `config` and not `upstream`, so the host's breaker does not quarantine the plugin as
        // though the service were down — which would hide the one message that helps.
        const failing = client(200, { error: LASTFM_ERROR.invalidApiKey, message: 'Invalid API key' });

        await expect(failing.get('artist.getInfo')).rejects.toMatchObject({ code: 'config' });
    });

    it('reads a rate limit as one, so the host backs off rather than retrying blind', async () => {
        const failing = client(200, { error: LASTFM_ERROR.rateLimit, message: 'Rate limit exceeded' });

        await expect(failing.get('artist.getInfo')).rejects.toMatchObject({ code: 'rate_limited' });
    });
});

describe('a failure with an HTTP status, which is how album.getInfo says it', () => {
    it('carries the error number out of the body of a 404', async () => {
        // The bug this exists for: the body used to be thrown away on any non-2xx, so an ordinary
        // "no such album" reached the host as an unexplained transport failure.
        const failing = client(404, { error: LASTFM_ERROR.invalidParameters, message: 'Album not found' });

        const error = await failing.get('album.getInfo').catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(LastfmRequestError);
        expect(error).toMatchObject({ status: 404, apiError: LASTFM_ERROR.invalidParameters, code: 'not_found' });
    });

    it("quotes the service's own reason, so a log line says why", async () => {
        const failing = client(404, { error: 6, message: 'Album not found' });

        await expect(failing.get('album.getInfo')).rejects.toThrow(/Album not found/);
    });

    it('still reports a 404 with no readable body, which is a real transport failure', async () => {
        const failing = client(404, '<html>gateway</html>');

        const error = await failing.get('album.getInfo').catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({ status: 404 });
        expect((error as LastfmRequestError).apiError).toBeUndefined();
    });

    it('reports a 500 as the service being down rather than a miss', async () => {
        // `unavailable` per the SDK's shared status mapping, which is the code that tells the host
        // to back off the whole plugin rather than to write a miss row against one album.
        await expect(client(500, '').get('artist.getInfo')).rejects.toMatchObject({ code: 'unavailable' });
    });
});

describe('a good answer', () => {
    it('comes back parsed', async () => {
        const ok = client(200, { artist: { name: 'Portishead' } });

        await expect(ok.get<{ artist: { name: string } }>('artist.getInfo')).resolves.toEqual({ artist: { name: 'Portishead' } });
    });

    it('refuses to write without a secret, rather than sending an unsigned request', async () => {
        const unsigned = new LastfmClient(hostAnswering(200, {}).host, 'key');

        expect(unsigned.canSign).toBe(false);
        await expect(unsigned.post('track.scrobble', {})).rejects.toMatchObject({ code: 'config' });
    });

    it('sends the key and the format on a read, and signs a write', async () => {
        const { host, fetch } = hostAnswering(200, {});
        await new LastfmClient(host, 'the-key', 'the-secret').post('track.scrobble', { sk: 'session' });

        const body = String((fetch.mock.calls[0]![1] as { body: string }).body);
        expect(body).toContain('api_key=the-key');
        expect(body).toContain('api_sig=');
        expect(body).toContain('format=json');
    });
});
