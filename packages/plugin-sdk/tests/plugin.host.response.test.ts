import { describe, expect, it } from 'vitest';

import { jsonBody, tryJsonBody } from '../src/plugin.host.response.js';
import type { HostFetchResponse } from '../src/plugin.host.js';

const response = (body: string, overrides: Partial<HostFetchResponse> = {}): HostFetchResponse => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    setCookie: [],
    body,
    ok: true,
    url: 'https://api.example.com/v1/tracks',
    redirected: false,
    ...overrides,
});

describe('jsonBody', () => {
    it('parses the body', () => {
        expect(jsonBody<{ tracks: number }>(response('{"tracks":3}'))).toEqual({ tracks: 3 });
    });

    it('names the call and quotes the body when it is not JSON', () => {
        expect(() => jsonBody(response('<html>rate limited</html>', { status: 429 }))).toThrow(
            /expected JSON from https:\/\/api\.example\.com\/v1\/tracks \(HTTP 429\) but got <html>rate limited<\/html>/,
        );
    });

    it('says so rather than quoting nothing when the body is empty', () => {
        expect(() => jsonBody(response('   '))).toThrow(/but got <empty body>/);
    });

    it('truncates a long body instead of pasting it whole into the message', () => {
        const message = (() => {
            try {
                jsonBody(response('!'.repeat(500)));
                return '';
            } catch (error) {
                return error instanceof Error ? error.message : '';
            }
        })();

        expect(message).toMatch(/!{120}…/);
        expect(message).not.toMatch(/!{121}/);
    });

    it('parses a non-ok response, leaving the caller to decide what the status means', () => {
        expect(jsonBody(response('{"error":"not found"}', { status: 404, ok: false }))).toEqual({ error: 'not found' });
    });
});

describe('tryJsonBody', () => {
    it('parses the body', () => {
        expect(tryJsonBody(response('[1,2]'))).toEqual([1, 2]);
    });

    it('is undefined rather than a throw when the body will not parse', () => {
        expect(tryJsonBody(response('not json'))).toBeUndefined();
    });
});
