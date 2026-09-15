import { SdkError } from '@deadair/sdk';
import { describe, expect, it } from 'vitest';

import { classify, describe as words, NotConfigured, retryAfterMs, type Failure } from '../../src/station/connection.failure.js';

function sdkError(status: number, headers: Record<string, string> = {}): SdkError {
    return new SdkError(status, 'status', {}, new Headers(headers));
}

describe('classify', () => {
    it('tells the station saying no apart from the station not being there', () => {
        expect(classify(sdkError(401))).toBe('unauthorised');
        expect(classify(sdkError(403))).toBe('forbidden');
        expect(classify(sdkError(409))).toBe('conflict');
        expect(classify(sdkError(429))).toBe('rateLimited');
        expect(classify(sdkError(502))).toBe('unreachable');
        expect(classify(sdkError(503))).toBe('unreachable');
        expect(classify(sdkError(504))).toBe('unreachable');
    });

    it('does not call a station that threw unreachable', () => {
        expect(classify(sdkError(500))).toBe('failed');
        expect(classify(sdkError(404))).toBe('failed');
    });

    it('reads Node’s spelling of a connection that failed, and the browsers’', () => {
        expect(classify(new TypeError('fetch failed'))).toBe('unreachable');
        expect(classify(new TypeError('Failed to fetch'))).toBe('unreachable');
    });

    it('counts a request that ran out of time as a station that did not answer', () => {
        expect(classify(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('unreachable');
    });

    it('does not read any TypeError as a connection failure', () => {
        expect(classify(new TypeError('Cannot read properties of undefined'))).toBe('failed');
        expect(classify('a string')).toBe('failed');
    });

    it('knows a plugin with no station', () => {
        expect(classify(new NotConfigured())).toBe('unconfigured');
    });
});

describe('retryAfterMs', () => {
    it('reads the seconds a 429 asks for', () => {
        expect(retryAfterMs(sdkError(429, { 'retry-after': '4' }))).toBe(4_000);
    });

    it('answers nothing it cannot read, and nothing for anything but a 429', () => {
        expect(retryAfterMs(sdkError(429))).toBeUndefined();
        expect(retryAfterMs(sdkError(429, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }))).toBeUndefined();
        expect(retryAfterMs(sdkError(503, { 'retry-after': '4' }))).toBeUndefined();
    });
});

describe('the words', () => {
    const failures: Failure[] = ['unconfigured', 'unreachable', 'unauthorised', 'forbidden', 'rateLimited', 'conflict', 'failed'];

    it('fit a key', () => {
        for (const failure of failures) {
            expect(words(failure).title.length, failure).toBeLessThanOrEqual(11);
        }
    });
});
