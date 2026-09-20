// The client, whose one real job is that Deezer reports most failures with HTTP 200 and an error
// object in the body. A client that only checked `response.ok` would hand the mapping a document
// with no `data` and every one of those failures would read as "this artist has no neighbours".

import { describe, expect, it } from 'vitest';

import { DeezerClient, DeezerRequestError } from '../src/deezer.client.js';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

function client() {
    const host = createFakePluginHost();
    return { host, client: new DeezerClient(host) };
}

describe('DeezerClient', () => {
    it('builds the url from the path and the query, and identifies itself', async () => {
        const { host, client: deezer } = client();
        host.queueResponse({ body: JSON.stringify({ data: [] }) });

        await deezer.get('artist/27/related', { limit: '5' });

        expect(host.calls[0]?.url).toBe('https://api.deezer.com/artist/27/related?limit=5');
        expect(host.calls[0]?.headers?.['user-agent']).toBe(deezer.identity);
        expect(deezer.identity).toContain('deadair-deezer/');
    });

    it('sends no query string when there are no parameters', async () => {
        const { host, client: deezer } = client();
        host.queueResponse({ body: JSON.stringify({ id: 27 }) });

        await deezer.get('artist/27');

        expect(host.calls[0]?.url).toBe('https://api.deezer.com/artist/27');
    });

    it('raises a 200 that carries an error object, keeping Deezer’s own code', async () => {
        const { host, client: deezer } = client();
        host.queueResponse({ body: JSON.stringify({ error: { type: 'DataException', message: 'no data', code: 800 } }) });

        const error = await deezer.get('artist/0/related').catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(DeezerRequestError);
        expect((error as DeezerRequestError).upstreamCode).toBe(800);
        expect((error as DeezerRequestError).isNoData).toBe(true);
        expect((error as DeezerRequestError).message).toContain('no data');
    });

    it('tells a real fault apart from an empty answer', async () => {
        const { host, client: deezer } = client();
        host.queueResponse({ body: JSON.stringify({ error: { type: 'QuotaException', message: 'quota exceeded', code: 4 } }) });

        const error = (await deezer.get('artist/27/top').catch((thrown: unknown) => thrown)) as DeezerRequestError;

        expect(error.isNoData).toBe(false);
    });

    it('raises a non-2xx with the status on it', async () => {
        const { host, client: deezer } = client();
        host.queueResponse({ body: 'upstream is down', status: 502 });

        const error = (await deezer.get('artist/27').catch((thrown: unknown) => thrown)) as DeezerRequestError;

        expect(error).toBeInstanceOf(DeezerRequestError);
        expect(error.status).toBe(502);
        expect(error.isNoData).toBe(false);
    });

    it('returns the parsed body when the call succeeds', async () => {
        const { host, client: deezer } = client();
        host.queueResponse({ body: JSON.stringify({ data: [{ id: 5, name: 'Kalax' }] }) });

        expect(await deezer.get<{ data: { id: number; name: string }[] }>('artist/1/related')).toEqual({ data: [{ id: 5, name: 'Kalax' }] });
    });
});
