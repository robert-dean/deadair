import { describe, expect, it } from 'vitest';

import { jsonBody, tryJsonBody } from '../src/plugin.host.response.js';

/**
 * A `Response` shaped like one `host.fetch` returns.
 *
 * `url` is defined in rather than passed to the constructor: it is read-only
 * and empty on a hand-built response, and it is the field that makes these
 * error messages name which call failed.
 */
const response = (body: string, init: ResponseInit = {}): Response => {
    const built = new Response(body, { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, ...init });
    Object.defineProperty(built, 'url', { value: 'https://api.example.com/v1/tracks' });
    return built;
};

describe('jsonBody', () => {
    it('parses the body', async () => {
        await expect(jsonBody<{ tracks: number }>(response('{"tracks":3}'))).resolves.toEqual({ tracks: 3 });
    });

    it('names the call and quotes the body when it is not JSON', async () => {
        await expect(jsonBody(response('<html>rate limited</html>', { status: 429 }))).rejects.toThrow(
            /expected JSON from https:\/\/api\.example\.com\/v1\/tracks \(HTTP 429\) but got <html>rate limited<\/html>/,
        );
    });

    it('says so rather than quoting nothing when the body is empty', async () => {
        await expect(jsonBody(response('   '))).rejects.toThrow(/but got <empty body>/);
    });

    it('truncates a long body instead of pasting it whole into the message', async () => {
        const message = await jsonBody(response('!'.repeat(500))).then(
            () => '',
            (error: unknown) => (error instanceof Error ? error.message : ''),
        );

        expect(message).toMatch(/!{120}…/);
        expect(message).not.toMatch(/!{121}/);
    });

    it('parses a non-ok response, leaving the caller to decide what the status means', async () => {
        await expect(jsonBody(response('{"error":"not found"}', { status: 404 }))).resolves.toEqual({ error: 'not found' });
    });

    it('lets a body that fails to READ through as itself', async () => {
        // The host refusing an oversized body is a different event from a server
        // answering with something that is not JSON, and relabelling it would
        // lose the code the caller branches on.
        const unreadable = new Response(
            new ReadableStream<Uint8Array>({
                pull() {
                    throw new Error('over the byte limit');
                },
            }),
        );

        await expect(jsonBody(unreadable)).rejects.toThrow(/over the byte limit/);
    });
});

describe('tryJsonBody', () => {
    it('parses the body', async () => {
        await expect(tryJsonBody(response('[1,2]'))).resolves.toEqual([1, 2]);
    });

    it('is undefined rather than a throw when the body will not parse', async () => {
        await expect(tryJsonBody(response('not json'))).resolves.toBeUndefined();
    });

    it('still rejects when the body fails to read, rather than reporting it as empty', async () => {
        const unreadable = new Response(
            new ReadableStream<Uint8Array>({
                pull() {
                    throw new Error('over the byte limit');
                },
            }),
        );

        await expect(tryJsonBody(unreadable)).rejects.toThrow(/over the byte limit/);
    });
});
