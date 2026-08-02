import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import {
    isRateLimited,
    MAX_ATTEMPTS,
    MAX_WAIT_MS,
    retryAfterMs,
    retryOnTransient,
    retryOnTransientMutation,
    transientRetryDelay,
} from '../../src/api/retry.policy';

function failure(status: number, headers: Record<string, string> = {}): SdkError {
    return new SdkError(status, 'Error', {}, new Headers(headers));
}

/** A 429 exactly as `rateLimiterMiddleware` sends it: `retry-after` in fractional seconds. */
function rateLimited(retryAfter: string): SdkError {
    return failure(429, { 'retry-after': retryAfter, 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '0' });
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('isRateLimited', () => {
    it('is true only for a 429', () => {
        expect(isRateLimited(rateLimited('2'))).toBe(true);
        expect(isRateLimited(failure(503))).toBe(false);
        expect(isRateLimited(new TypeError('offline'))).toBe(false);
    });
});

describe('retryAfterMs', () => {
    it('reads whole seconds', () => {
        expect(retryAfterMs(rateLimited('3'))).toBe(3000);
    });

    it('reads the fractional seconds the API actually sends', () => {
        // msBeforeNext/1000 for a 420ms window. Parsing as an int would floor this to 0 and
        // produce a hot retry loop.
        expect(retryAfterMs(rateLimited('0.42'))).toBe(420);
    });

    it('reads the HTTP-date form a proxy might substitute', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
        expect(retryAfterMs(rateLimited('Sun, 02 Aug 2026 12:00:05 GMT'))).toBe(5000);
    });

    it('never returns a negative wait for a date already past', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
        expect(retryAfterMs(rateLimited('Sun, 02 Aug 2026 11:59:55 GMT'))).toBe(0);
    });

    it('is undefined when the header is absent or junk', () => {
        expect(retryAfterMs(failure(429))).toBeUndefined();
        expect(retryAfterMs(rateLimited('soon-ish'))).toBeUndefined();
        expect(retryAfterMs(new TypeError('offline'))).toBeUndefined();
    });
});

describe('retryOnTransient', () => {
    it.each([400, 401, 403, 404, 409, 422])('does not retry a %i, which is a verdict', status => {
        expect(retryOnTransient(0, failure(status))).toBe(false);
    });

    it.each([500, 502, 503])('retries a %i, which is a failure to answer', status => {
        expect(retryOnTransient(0, failure(status))).toBe(true);
    });

    it('retries the two 4xx that say when rather than no', () => {
        expect(retryOnTransient(0, failure(408))).toBe(true);
        expect(retryOnTransient(0, rateLimited('1'))).toBe(true);
    });

    it('retries a rejection that never reached the server', () => {
        expect(retryOnTransient(0, new TypeError('Failed to fetch'))).toBe(true);
    });

    it('stops at the attempt cap', () => {
        expect(retryOnTransient(MAX_ATTEMPTS - 1, failure(503))).toBe(true);
        expect(retryOnTransient(MAX_ATTEMPTS, failure(503))).toBe(false);
    });

    it('gives up rather than waiting out a limiter window longer than the cap', () => {
        const seconds = (MAX_WAIT_MS / 1000 + 5).toString();
        expect(retryOnTransient(0, rateLimited(seconds))).toBe(false);
    });
});

describe('retryOnTransientMutation', () => {
    it('retries only the refused-before-it-ran statuses', () => {
        expect(retryOnTransientMutation(0, rateLimited('1'))).toBe(true);
        expect(retryOnTransientMutation(0, failure(408))).toBe(true);
    });

    it('refuses a 5xx, which may have applied', () => {
        expect(retryOnTransientMutation(0, failure(500))).toBe(false);
        expect(retryOnTransientMutation(0, failure(503))).toBe(false);
    });

    it('refuses a transport failure, which may also have applied', () => {
        // The request could have reached the server and died on the way back.
        expect(retryOnTransientMutation(0, new TypeError('Failed to fetch'))).toBe(false);
    });

    it('still honours the attempt cap and the wait ceiling', () => {
        expect(retryOnTransientMutation(MAX_ATTEMPTS, rateLimited('1'))).toBe(false);
        expect(retryOnTransientMutation(0, rateLimited((MAX_WAIT_MS / 1000 + 5).toString()))).toBe(false);
    });
});

describe('transientRetryDelay', () => {
    it("uses the server's own wait when it gave one", () => {
        expect(transientRetryDelay(0, rateLimited('2'))).toBe(2000);
        expect(transientRetryDelay(3, rateLimited('0.5'))).toBe(500);
    });

    it('clamps a long wait to the ceiling', () => {
        expect(transientRetryDelay(0, rateLimited('600'))).toBe(MAX_WAIT_MS);
    });

    it('backs off exponentially with jitter when there is no header', () => {
        // Full jitter: the delay is a random point in [0, ceiling), so pinning random pins the value.
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(transientRetryDelay(0, failure(503))).toBe(500);
        expect(transientRetryDelay(1, failure(503))).toBe(1000);
        expect(transientRetryDelay(2, failure(503))).toBe(2000);
    });

    it('caps the backoff ceiling for a long-running retry', () => {
        vi.spyOn(Math, 'random').mockReturnValue(1);
        expect(transientRetryDelay(20, failure(503))).toBe(30_000);
    });
});
