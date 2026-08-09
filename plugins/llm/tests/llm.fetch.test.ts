import { describe, expect, it, vi } from 'vitest';
import { isPluginError, type HostFetchInit, type PluginHost } from '@deadair/plugin-sdk';

import { hostFetch } from '../src/llm.fetch.js';

/** A host whose fetch records what it was handed. Nothing else here is exercised. */
function hostWithSpy() {
    const calls: { url: string; init: HostFetchInit | undefined }[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: HostFetchInit) => {
        calls.push({ url, init });
        return new Response('{}', { status: 200 });
    });

    return { host: { fetch: fetchSpy } as unknown as PluginHost, calls };
}

describe('hostFetch', () => {
    it('sends a string url straight through', async () => {
        const { host, calls } = hostWithSpy();

        await hostFetch(host)('https://models.example/v1/chat/completions');

        expect(calls[0]?.url).toBe('https://models.example/v1/chat/completions');
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
