import { describe, expect, it, vi } from 'vitest';

import type { HostFetchInit } from '@deadair/plugin-sdk';

import { REQUEST_TIMEOUT_MS } from '../src/spotify.manifest.js';
import { createHostFetch, QUOTA_BACKOFF_MS, QUOTA_EXCEEDED_REASON, SpotifyRequestError, SpotifyResponseValidator } from '../src/spotify.fetch.js';
import { createFakePluginHost, fakeHostFetchResponse } from './fake.plugin.host.js';

describe('createHostFetch', () => {
    it('passes method, headers (lowercased) and body through to host.fetch, with the bearer attached', async () => {
        const host = createFakePluginHost();
        host.queueResponse({ status: 200, body: '{"ok":true}' });
        const getBearer = vi.fn(async () => 'token-1');
        const forceRefresh = vi.fn(async () => 'token-2');
        const requestImpl = createHostFetch(host, getBearer, forceRefresh);

        const response = await requestImpl('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: { 'X-Test': 'yes', 'Content-Type': 'application/json' },
            body: '{"volume":50}',
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('{"ok":true}');
        expect(host.calls).toHaveLength(1);
        const [call] = host.calls;
        expect(call.url).toBe('https://api.spotify.com/v1/me/player');
        expect(call.method).toBe('PUT');
        expect(call.headers?.['x-test']).toBe('yes');
        expect(call.headers?.['content-type']).toBe('application/json');
        // No un-lowercased duplicates leaked through.
        expect(call.headers?.['X-Test']).toBeUndefined();
        expect(call.headers?.authorization).toBe('Bearer token-1');
        expect(call.body).toBe('{"volume":50}');
        expect(forceRefresh).not.toHaveBeenCalled();
    });

    it('accepts a Request and a URL as input, not only a string', async () => {
        const host = createFakePluginHost();
        host.queueResponse({});
        host.queueResponse({});
        const requestImpl = createHostFetch(
            host,
            vi.fn(async () => 'token'),
            vi.fn(async () => 'token'),
        );

        await requestImpl(new URL('https://api.spotify.com/v1/albums'), undefined);
        await requestImpl(new Request('https://api.spotify.com/v1/tracks'), undefined);

        expect(host.calls[0].url).toBe('https://api.spotify.com/v1/albums');
        expect(host.calls[1].url).toBe('https://api.spotify.com/v1/tracks');
    });

    it('defaults to GET when no method is given', async () => {
        const host = createFakePluginHost();
        host.queueResponse({});
        const requestImpl = createHostFetch(
            host,
            vi.fn(async () => 'token'),
            vi.fn(async () => 'token'),
        );

        await requestImpl('https://api.spotify.com/v1/me', undefined);

        expect(host.calls[0].method).toBe('GET');
        expect(host.calls[0].headers).toBeDefined();
    });

    it('respects the request timeout budget from the manifest', async () => {
        const host = createFakePluginHost();
        host.queueResponse({});
        const requestImpl = createHostFetch(
            host,
            vi.fn(async () => 'token'),
            vi.fn(async () => 'token'),
        );

        await requestImpl('https://api.spotify.com/v1/me', undefined);

        const [url, init] = (host.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, HostFetchInit];
        expect(url).toBe('https://api.spotify.com/v1/me');
        expect(init.timeoutMs).toBe(REQUEST_TIMEOUT_MS);
    });

    it('throws on an unsupported method', async () => {
        const host = createFakePluginHost();
        const requestImpl = createHostFetch(
            host,
            vi.fn(async () => 'token'),
            vi.fn(async () => 'token'),
        );

        await expect(requestImpl('https://api.spotify.com/v1/me', { method: 'TRACE' })).rejects.toThrow(/unsupported method/);
    });

    it('rejects a non-string request body', async () => {
        const host = createFakePluginHost();
        const requestImpl = createHostFetch(
            host,
            vi.fn(async () => 'token'),
            vi.fn(async () => 'token'),
        );

        await expect(
            requestImpl('https://api.spotify.com/v1/me', { method: 'POST', body: new Uint8Array([1, 2, 3]) as unknown as BodyInit }),
        ).rejects.toThrow(/only supports string request bodies/);
    });

    it('turns a 204/205/304 body into null instead of an empty string, and does not throw', async () => {
        for (const status of [204, 205, 304]) {
            const host = createFakePluginHost();
            host.queueResponse({ status, statusText: '', body: '' });
            const requestImpl = createHostFetch(
                host,
                vi.fn(async () => 'token'),
                vi.fn(async () => 'token'),
            );

            const response = await requestImpl('https://api.spotify.com/v1/me/player/pause', { method: 'PUT' });

            expect(response.status).toBe(status);
            expect(response.body).toBeNull();
        }
    });

    it('re-issues the request exactly once on a 401, with the refreshed bearer on the retry', async () => {
        const host = createFakePluginHost();
        let fetchCalls = 0;
        host.setFetchImpl(async () => {
            fetchCalls += 1;
            return fetchCalls === 1
                ? fakeHostFetchResponse({ status: 401, statusText: 'Unauthorized', body: '' })
                : fakeHostFetchResponse({ status: 200, body: '{"ok":true}' });
        });
        const getBearer = vi.fn(async () => 'stale-token');
        const forceRefresh = vi.fn(async () => 'fresh-token');
        const requestImpl = createHostFetch(host, getBearer, forceRefresh);

        const response = await requestImpl('https://api.spotify.com/v1/me', undefined);

        expect(response.status).toBe(200);
        expect(forceRefresh).toHaveBeenCalledTimes(1);
        expect(host.calls).toHaveLength(2);
        expect(host.calls[0].headers?.authorization).toBe('Bearer stale-token');
        expect(host.calls[1].headers?.authorization).toBe('Bearer fresh-token');
    });

    it('returns a second 401 as-is rather than retrying forever', async () => {
        const host = createFakePluginHost();
        host.setFetchImpl(async () => fakeHostFetchResponse({ status: 401, statusText: 'Unauthorized', body: '' }));
        const getBearer = vi.fn(async () => 'stale-token');
        const forceRefresh = vi.fn(async () => 'still-stale-token');
        const requestImpl = createHostFetch(host, getBearer, forceRefresh);

        const response = await requestImpl('https://api.spotify.com/v1/me', undefined);

        expect(response.status).toBe(401);
        expect(forceRefresh).toHaveBeenCalledTimes(1);
        expect(host.calls).toHaveLength(2);
    });
});

describe('SpotifyResponseValidator', () => {
    it('resolves without throwing for a 2xx response', async () => {
        const validator = new SpotifyResponseValidator();
        await expect(validator.validateResponse(new Response('{"ok":true}', { status: 200 }))).resolves.toBeUndefined();
    });

    it('resolves for other 20x statuses too', async () => {
        const validator = new SpotifyResponseValidator();
        await expect(validator.validateResponse(new Response(null, { status: 204 }))).resolves.toBeUndefined();
    });

    it('throws a SpotifyRequestError carrying the status and body for a non-2xx response', async () => {
        const validator = new SpotifyResponseValidator();
        const response = new Response('{"error":"not found"}', { status: 404, statusText: 'Not Found' });

        await expect(validator.validateResponse(response)).rejects.toMatchObject({
            name: 'SpotifyRequestError',
            status: 404,
            body: '{"error":"not found"}',
        });
    });

    it('is a genuine instance of SpotifyRequestError, not just a matching shape', async () => {
        const validator = new SpotifyResponseValidator();
        const response = new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });

        try {
            await validator.validateResponse(response);
            expect.unreachable('validateResponse should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(SpotifyRequestError);
            const spotifyError = error as SpotifyRequestError;
            expect(spotifyError.status).toBe(429);
            expect(spotifyError.body).toBe('rate limited');
            expect(spotifyError.message).toBe('Spotify API request failed: HTTP 429 Too Many Requests');
        }
    });

    it('classifies the status for the host: what the plugin branches on is `status`, what the host maps is `code`', async () => {
        const validator = new SpotifyResponseValidator();
        const classify = async (status: number): Promise<string> => {
            try {
                await validator.validateResponse(new Response('body', { status }));
                return 'did not throw';
            } catch (error) {
                return (error as SpotifyRequestError).code;
            }
        };

        expect(await classify(401)).toBe('auth');
        expect(await classify(404)).toBe('not_found');
        expect(await classify(429)).toBe('rate_limited');
        expect(await classify(500)).toBe('unavailable');
        expect(await classify(400)).toBe('upstream');
    });

    it('marks an auth failure non-retryable and a server error retryable', async () => {
        const validator = new SpotifyResponseValidator();
        const retryableFor = async (status: number): Promise<boolean> => {
            try {
                await validator.validateResponse(new Response('body', { status }));
                return false;
            } catch (error) {
                return (error as SpotifyRequestError).retryable;
            }
        };

        expect(await retryableFor(401)).toBe(false);
        expect(await retryableFor(503)).toBe(true);
    });

    it('treats a 403 as one refused resource, not a dead connection', async () => {
        const validator = new SpotifyResponseValidator();

        // A 403 on one playlist used to classify `auth`, which the host's
        // breaker quarantines on the first failure: the whole Spotify plugin
        // went `failed` and every later request answered 503. `forbidden` is
        // resource-scoped, so the host does not count it against the plugin.
        await expect(validator.validateResponse(new Response('nope', { status: 403 }))).rejects.toMatchObject({
            code: 'forbidden',
            status: 403,
        });
    });

    it("puts Spotify's own explanation in the message, since the status alone does not say what to fix", async () => {
        const validator = new SpotifyResponseValidator();
        const body = JSON.stringify({ error: { status: 403, message: 'Insufficient client scope' } });

        await expect(validator.validateResponse(new Response(body, { status: 403 }))).rejects.toMatchObject({
            message: 'Spotify API request failed: HTTP 403 Insufficient client scope',
        });
    });

    it('falls back to the bare status when the body is not a Spotify error envelope', async () => {
        const validator = new SpotifyResponseValidator();

        // No dangling space where `statusText` would be: over HTTP/2 it is
        // always empty, which is every real call to Spotify.
        await expect(validator.validateResponse(new Response('<html>gateway</html>', { status: 403 }))).rejects.toMatchObject({
            message: 'Spotify API request failed: HTTP 403',
        });
    });

    it("carries Spotify's Retry-After through as milliseconds", async () => {
        const validator = new SpotifyResponseValidator();
        const response = new Response('rate limited', { status: 429, headers: { 'retry-after': '30' } });

        await expect(validator.validateResponse(response)).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 30_000 });
    });

    it('holds a quota 429 for the long fixed window instead of its Retry-After', async () => {
        const validator = new SpotifyResponseValidator();
        const body = JSON.stringify({ error: { status: 429, message: 'API rate limit exceeded', reason: 'QUOTA_EXCEEDED' } });
        // A short header alongside an exhausted allowance is exactly the case
        // this exists for: honouring it spends the next window on the same refusal.
        const response = new Response(body, { status: 429, headers: { 'retry-after': '1' } });

        await expect(validator.validateResponse(response)).rejects.toMatchObject({
            code: 'rate_limited',
            reason: QUOTA_EXCEEDED_REASON,
            quotaExhausted: true,
            retryAfterMs: QUOTA_BACKOFF_MS,
        });
    });

    it('holds a quota 429 that came with no Retry-After at all', async () => {
        const validator = new SpotifyResponseValidator();
        const body = JSON.stringify({ error: { status: 429, reason: 'QUOTA_EXCEEDED' } });

        await expect(validator.validateResponse(new Response(body, { status: 429 }))).rejects.toMatchObject({
            quotaExhausted: true,
            retryAfterMs: QUOTA_BACKOFF_MS,
        });
    });

    it('says in words that a quota 429 is not a burst limit, since both arrive as the same status', async () => {
        const validator = new SpotifyResponseValidator();
        const body = JSON.stringify({ error: { status: 429, message: 'API rate limit exceeded', reason: 'QUOTA_EXCEEDED' } });

        await expect(validator.validateResponse(new Response(body, { status: 429 }))).rejects.toMatchObject({
            message:
                "Spotify API request failed: HTTP 429 API rate limit exceeded (quota exhausted: the app's allowance is spent, not a burst limit)",
        });
    });

    it('leaves a burst 429 on its own Retry-After, and does not call it a quota failure', async () => {
        const validator = new SpotifyResponseValidator();
        const body = JSON.stringify({ error: { status: 429, message: 'API rate limit exceeded' } });
        const response = new Response(body, { status: 429, headers: { 'retry-after': '30' } });

        await expect(validator.validateResponse(response)).rejects.toMatchObject({
            reason: undefined,
            quotaExhausted: false,
            retryAfterMs: 30_000,
            message: 'Spotify API request failed: HTTP 429 API rate limit exceeded',
        });
    });

    it('reads a reason off any status, and only lets it change the wait on a 429', async () => {
        const validator = new SpotifyResponseValidator();
        // Spotify's reasons are not 429-only (PREMIUM_REQUIRED, NO_ACTIVE_DEVICE),
        // so the field is populated wherever it appears; the quota branch is not.
        const body = JSON.stringify({ error: { status: 403, message: 'Player command failed', reason: 'PREMIUM_REQUIRED' } });

        await expect(validator.validateResponse(new Response(body, { status: 403 }))).rejects.toMatchObject({
            reason: 'PREMIUM_REQUIRED',
            quotaExhausted: false,
            retryAfterMs: undefined,
        });
    });

    it('ignores a reason on a body that is not a Spotify error envelope', async () => {
        const validator = new SpotifyResponseValidator();

        await expect(validator.validateResponse(new Response('<html>gateway</html>', { status: 429 }))).rejects.toMatchObject({
            reason: undefined,
            quotaExhausted: false,
        });
    });

    it('ignores a Retry-After it cannot read rather than inventing a wait', async () => {
        const validator = new SpotifyResponseValidator();
        const dated = new Response('rate limited', { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } });

        await expect(validator.validateResponse(dated)).rejects.toMatchObject({ retryAfterMs: undefined });
        await expect(validator.validateResponse(new Response('rate limited', { status: 429 }))).rejects.toMatchObject({ retryAfterMs: undefined });
    });

    it('records the upstream status as a diagnostic, separate from the code the host maps', async () => {
        const validator = new SpotifyResponseValidator();

        await expect(validator.validateResponse(new Response('nope', { status: 404 }))).rejects.toMatchObject({
            code: 'not_found',
            upstreamStatus: 404,
            status: 404,
        });
    });

    it('leaves body undefined when the response text cannot be read', async () => {
        const validator = new SpotifyResponseValidator();
        const response = new Response('irrelevant', { status: 500, statusText: 'Internal Server Error' });
        vi.spyOn(response, 'text').mockRejectedValueOnce(new Error('stream already consumed'));

        await expect(validator.validateResponse(response)).rejects.toMatchObject({
            status: 500,
            body: undefined,
        });
    });
});
