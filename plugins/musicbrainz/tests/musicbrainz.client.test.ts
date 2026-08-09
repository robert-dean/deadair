import { beforeEach, describe, expect, it } from 'vitest';

import { MusicBrainzClient, MusicBrainzRequestError } from '../src/musicbrainz.client.js';
import { createFakePluginHost, type FakePluginHost } from './fake.plugin.host.js';

let host: FakePluginHost;
let client: MusicBrainzClient;

beforeEach(() => {
    host = createFakePluginHost();
    client = new MusicBrainzClient(host, 'https://musicbrainz.org/ws/2/', 'station@example.test');
});

describe('MusicBrainzClient', () => {
    it('asks for JSON and identifies itself with the operator contact', async () => {
        host.queueResponse({ body: '{"id":"art-1"}' });

        await client.get('artist/art-1', { inc: 'url-rels' });

        const call = host.calls[0]!;
        expect(call.url).toBe('https://musicbrainz.org/ws/2/artist/art-1?inc=url-rels&fmt=json');
        expect(call.headers?.['user-agent']).toBe('deadair-musicbrainz/0.0.1 ( mailto:station@example.test )');
        expect(call.headers?.accept).toBe('application/json');
    });

    it('does not double the slash on a baseUrl that ends in one', async () => {
        host.queueResponse({ body: '{}' });
        await client.get('recording');
        expect(host.calls[0]!.url).toBe('https://musicbrainz.org/ws/2/recording?fmt=json');
    });

    it('parses the body it was given', async () => {
        host.queueResponse({ body: '{"recordings":[{"id":"rec-1"}]}' });
        await expect(client.get('recording')).resolves.toEqual({ recordings: [{ id: 'rec-1' }] });
    });

    it('reports a 404 as not_found, which a caller can treat as a miss', async () => {
        host.queueResponse({ status: 404, statusText: 'Not Found', body: '{"error":"Not Found"}' });

        const error = await client.get('isrc/nope').catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(MusicBrainzRequestError);
        expect(error).toMatchObject({ status: 404, code: 'not_found', retryable: false, upstreamStatus: 404 });
    });

    it('quotes the upstream explanation, which is the useful half of a 400', async () => {
        host.queueResponse({ status: 400, statusText: 'Bad Request', body: '{"error":"invalid inc parameter"}' });

        const error = (await client.get('recording').catch((thrown: unknown) => thrown)) as MusicBrainzRequestError;
        expect(error.message).toContain('invalid inc parameter');
        expect(error.code).toBe('config');
    });

    it('tells a throttling 503 from a broken one by its Retry-After', async () => {
        host.queueResponse({ status: 503, headers: { 'retry-after': '3' }, body: '' });
        const throttled = (await client.get('recording').catch((thrown: unknown) => thrown)) as MusicBrainzRequestError;
        expect(throttled).toMatchObject({ code: 'rate_limited', retryable: true, retryAfterMs: 3000 });

        host.queueResponse({ status: 503, body: '' });
        const down = (await client.get('recording').catch((thrown: unknown) => thrown)) as MusicBrainzRequestError;
        expect(down).toMatchObject({ code: 'unavailable', retryable: true });
        expect(down.retryAfterMs).toBeUndefined();
    });

    it('survives a non-JSON error body', async () => {
        host.queueResponse({ status: 502, statusText: 'Bad Gateway', body: '<html>nginx</html>' });

        const error = (await client.get('recording').catch((thrown: unknown) => thrown)) as MusicBrainzRequestError;
        expect(error.message).toBe('MusicBrainz request failed: HTTP 502 Bad Gateway');
        expect(error.code).toBe('unavailable');
    });
});
