import { describe, expect, it } from 'vitest';
import { isPluginError, type HostFetchInit } from '@deadair/plugin-sdk';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { hostFetch } from '../src/llm.fetch.js';

/**
 * A host whose fetch records what it was handed. Nothing else here is
 * exercised. Recorded locally rather than off `host.calls`: several
 * assertions below want `init.signal`, which `RecordedFetchCall` leaves out.
 */
function hostWithSpy() {
    const calls: { url: string; init: HostFetchInit | undefined }[] = [];
    const host = createFakePluginHost();
    host.setFetchImpl(async (url: string, init?: HostFetchInit) => {
        calls.push({ url, init });
        return new Response('{}', { status: 200 });
    });

    return { host, calls };
}

describe('hostFetch', () => {
    it('sends a string url straight through', async () => {
        const { host, calls } = hostWithSpy();

        await hostFetch(host)('https://models.example/v1/chat/completions');

        expect(calls[0]?.url).toBe('https://models.example/v1/chat/completions');
    });

    it('asks for the whole of what the call has left, because a model may be slow to start answering', async () => {
        // The host's default is ten seconds to the response ARRIVING, which is the wrong bound for
        // a self-hosted model loading weights before its first token. It killed a real refill:
        // `POST … timed out after 10000ms`, reported upward as a model that named no records.
        const { host, calls } = hostWithSpy();
        host.seedRemainingMs(120_000);

        await hostFetch(host)('https://models.example/v1/chat/completions', { method: 'POST', body: '{}' });

        expect(calls[0]?.init?.timeoutMs).toBe(120_000);
    });

    it('reads the budget per call, since one provider serves a refill and a break writer alike', async () => {
        const { host, calls } = hostWithSpy();
        const fetch = hostFetch(host);

        host.seedRemainingMs(120_000);
        await fetch('https://models.example/v1/chat/completions', { method: 'POST', body: '{}' });
        host.seedRemainingMs(8_000);
        await fetch('https://models.example/v1/chat/completions', { method: 'POST', body: '{}' });

        expect(calls.map(call => call.init?.timeoutMs)).toEqual([120_000, 8_000]);
    });

    it('flattens a URL object, which the SDK is entitled to pass', async () => {
        const { host, calls } = hostWithSpy();

        await hostFetch(host)(new URL('https://models.example/v1/models'));

        expect(calls[0]?.url).toBe('https://models.example/v1/models');
    });

    it('carries method, headers and a string body', async () => {
        const { host, calls } = hostWithSpy();

        await hostFetch(host)('https://models.example/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"model":"x"}',
        });

        expect(calls[0]?.init).toMatchObject({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"model":"x"}',
        });
    });

    it('reads headers out of a Headers instance', async () => {
        const { host, calls } = hostWithSpy();

        await hostFetch(host)('https://models.example/v1/models', { headers: new Headers({ authorization: 'Bearer k' }) });

        expect(calls[0]?.init?.headers).toEqual({ authorization: 'Bearer k' });
    });

    it('reads headers out of an entry array', async () => {
        const { host, calls } = hostWithSpy();

        await hostFetch(host)('https://models.example/v1/models', { headers: [['X-Thing', 'v']] });

        expect(calls[0]?.init?.headers).toEqual({ 'x-thing': 'v' });
    });

    it('passes the abort signal on rather than dropping it', async () => {
        // Composed with the host's own deadline. Dropping it would leave a
        // generation the SDK abandoned still holding a socket.
        const { host, calls } = hostWithSpy();
        const controller = new AbortController();

        await hostFetch(host)('https://models.example/v1/models', { signal: controller.signal });

        expect(calls[0]?.init?.signal).toBe(controller.signal);
    });

    it('refuses a Request object loudly instead of dropping its body', async () => {
        const { host } = hostWithSpy();

        await expect(hostFetch(host)(new Request('https://models.example/v1/models'))).rejects.toSatisfy(
            error => isPluginError(error) && error.code === 'internal',
        );
    });

    it('refuses a non-string body loudly', async () => {
        const { host } = hostWithSpy();

        await expect(hostFetch(host)('https://models.example/v1/x', { method: 'POST', body: new Uint8Array([1, 2]) })).rejects.toSatisfy(
            error => isPluginError(error) && error.code === 'internal',
        );
    });

    it('refuses a method the host fetch does not offer', async () => {
        const { host } = hostWithSpy();

        await expect(hostFetch(host)('https://models.example/v1/x', { method: 'OPTIONS' })).rejects.toSatisfy(
            error => isPluginError(error) && error.code === 'internal',
        );
    });

    it('accepts a lower-case method, which the platform allows', async () => {
        const { host, calls } = hostWithSpy();

        await hostFetch(host)('https://models.example/v1/x', { method: 'post' });

        expect(calls[0]?.init?.method).toBe('POST');
    });
});
