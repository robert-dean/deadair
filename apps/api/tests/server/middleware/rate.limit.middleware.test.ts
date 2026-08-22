// The key is the whole of this middleware. Get it wrong one way and every client behind the
// edge shares one bucket, which is the bug it was written for; get it wrong the other way and
// anyone who can reach the API directly mints a fresh bucket per header they invent, which is
// the limiter switched off while still appearing to run.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { TRUST_PROXY_KEY, clientAddress, rateLimitMiddleware } from '../../../src/server/middleware/rate.limit.middleware.js';

const PEER = '172.18.0.4';

/** A request as Koa presents it, with only the two parts the key is taken from. */
const request = (headers: Record<string, string | string[]> = {}, ip: string = PEER) => ({ ip, req: { headers } });

/**
 * A config layer that answers with STRINGS, which is what every real one does.
 *
 * A double handing back a real boolean here would pass whatever `settingIsOn` did with it,
 * which is the failure `setting.flags.ts` exists for, so the off case below is tested with
 * the string an operator's `.env` actually holds.
 */
const configWith = (trustProxy: string | undefined): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key === TRUST_PROXY_KEY && trustProxy !== undefined ? trustProxy : fallback) }) as AppConfig;

describe('clientAddress', () => {
    it('is the socket peer when no proxy is trusted, whatever the caller claims', () => {
        // The important half: an untrusted forwarded header is not evidence, and reading one
        // would let any caller pick their own bucket.
        expect(clientAddress(request({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '9.9.9.9' }) as never, false)).toBe(PEER);
    });

    it('prefers x-real-ip, which the edge sets rather than appends', () => {
        expect(clientAddress(request({ 'x-real-ip': '203.0.113.7' }) as never, true)).toBe('203.0.113.7');
    });

    it('takes the LAST forwarded hop, because the first one is whatever the client wrote', () => {
        // nginx appends with $proxy_add_x_forwarded_for, so a client sending its own header
        // produces `<their claim>, <real peer>`. Koa's ctx.ip would take the claim.
        expect(clientAddress(request({ 'x-forwarded-for': '10.0.0.1, 203.0.113.7' }) as never, true)).toBe('203.0.113.7');
    });

    it('falls back to the peer for a caller that arrives with no forwarded header at all', () => {
        // Liquidsoap, which talks to the API directly and never passes the edge. Trusting a
        // proxy must not cost a direct caller its own key.
        expect(clientAddress(request() as never, true)).toBe(PEER);
    });

    it('ignores a header that is present and says nothing', () => {
        expect(clientAddress(request({ 'x-real-ip': '   ', 'x-forwarded-for': ' , ' }) as never, true)).toBe(PEER);
    });
});

describe('rateLimitMiddleware', () => {
    /** A limiter that records what it was asked about and always allows. */
    const permissive = () => {
        const keys: string[] = [];
        return { keys, limiter: { points: 100, consume: async (key: string) => void keys.push(key) } };
    };

    it('keys on the peer while TRUST_PROXY is off, including when it is the STRING "false"', async () => {
        // `config.get(key, false)` answers the string 'false', which is truthy. A double that
        // coerced on the way out would hide that and this test would pass either way.
        for (const off of [undefined, 'false', 'off', '0']) {
            const { keys, limiter } = permissive();

            await rateLimitMiddleware(limiter as never, configWith(off))(request({ 'x-real-ip': '203.0.113.7' }) as never, vi.fn());

            expect(keys).toEqual([PEER]);
        }
    });

    it('keys on the forwarded caller once an operator says the edge is real', async () => {
        const { keys, limiter } = permissive();

        await rateLimitMiddleware(limiter as never, configWith('true'))(request({ 'x-real-ip': '203.0.113.7' }) as never, vi.fn());

        expect(keys).toEqual(['203.0.113.7']);
    });

    it('gives two clients behind one edge two budgets, which is the bug it was written for', async () => {
        const { keys, limiter } = permissive();
        const middleware = rateLimitMiddleware(limiter as never, configWith('true'));

        await middleware(request({ 'x-real-ip': '203.0.113.7' }) as never, vi.fn());
        await middleware(request({ 'x-real-ip': '203.0.113.8' }) as never, vi.fn());

        expect(new Set(keys).size).toBe(2);
    });

    it('answers 429 with what a client backs off on, rather than a bare refusal', async () => {
        const limiter = {
            points: 100,
            consume: async () => {
                throw { msBeforeNext: 4000, remainingPoints: 0 };
            },
        };

        const thrown = await rateLimitMiddleware(limiter as never, configWith('false'))(request() as never, vi.fn()).catch(
            (error: unknown) => error as { status?: number; statusCode?: number; headers?: Record<string, string> },
        );

        expect(thrown.status ?? thrown.statusCode).toBe(429);
        expect(thrown.headers?.['retry-after']).toBe('4');
        expect(thrown.headers?.['x-ratelimit-limit']).toBe('100');
    });

    it('lets a request through when the limiter allows it', async () => {
        const next = vi.fn(async () => {});

        await rateLimitMiddleware(permissive().limiter as never, configWith('false'))(request() as never, next);

        expect(next).toHaveBeenCalledOnce();
    });
});
