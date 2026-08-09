// This middleware IS the gate on the playout bridge. Nothing behind it checks the secret
// any more, so a hole here is a hole in every bridge route at once — including the one
// Icecast blocks on, where a wrong answer refuses listeners the mount.
//
// The prefix match is as load-bearing as the compare: it is what makes a route added under
// /playout/bridge/ protected without anyone remembering to protect it, and what keeps the
// gate off the rest of the app.

import { describe, expect, it, vi } from 'vitest';

import { BRIDGE_PATH_PREFIX, bridgeSecretMiddleware } from '../../../src/server/middleware/bridge.secret.middleware.js';
import { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';

const SECRET = 'bridge-secret';

/**
 * A request as Koa presents it, with only the parts this middleware touches: the path, the
 * raw headers, and the scoped container it resolves the endpoint from.
 */
const request = (path: string, headers: Record<string, string> = {}, secret: string = SECRET) => ({
    path,
    req: { headers },
    container: { get: (token: unknown) => (token === LiquidsoapEndpoint ? { secret: () => secret } : undefined) },
});

/** Runs the middleware and reports whether it passed the request through, or what it threw. */
async function run(ctx: ReturnType<typeof request>): Promise<{ passed: boolean; status?: number }> {
    const next = vi.fn(async () => {});
    try {
        await bridgeSecretMiddleware()(ctx as never, next);
        return { passed: next.mock.calls.length > 0 };
    } catch (error) {
        return { passed: false, status: (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode };
    }
}

describe('bridgeSecretMiddleware', () => {
    it('lets a call through when the secret matches', async () => {
        const result = await run(request(`${BRIDGE_PATH_PREFIX}aired`, { 'x-playout-secret': SECRET }));

        expect(result.passed).toBe(true);
    });

    it('refuses a wrong secret with a 401', async () => {
        const result = await run(request(`${BRIDGE_PATH_PREFIX}aired`, { 'x-playout-secret': 'not-the-secret' }));

        expect(result.passed).toBe(false);
        expect(result.status).toBe(401);
    });

    it('refuses a missing secret with a 401 rather than passing it to the handler', async () => {
        // Nothing behind this validates the header any more, so an absent one has to be
        // refused here or it reaches a route as an unauthenticated call.
        const result = await run(request(`${BRIDGE_PATH_PREFIX}listener`));

        expect(result.passed).toBe(false);
        expect(result.status).toBe(401);
    });

    it('refuses an empty secret, which would otherwise match an unseeded bridge', async () => {
        const result = await run(request(`${BRIDGE_PATH_PREFIX}listener`, { 'x-playout-secret': '' }));

        expect(result.passed).toBe(false);
        expect(result.status).toBe(401);
    });

    it('answers 404 while the bridge is unconfigured, since nothing could match', async () => {
        // Not a refusal of this caller: the bridge cannot serve anyone yet, and a 401 would
        // send an operator looking for a mismatch that does not exist.
        const result = await run(request(`${BRIDGE_PATH_PREFIX}aired`, { 'x-playout-secret': 'anything' }, ''));

        expect(result.passed).toBe(false);
        expect(result.status).toBe(404);
    });

    it('leaves every path outside the prefix alone', async () => {
        // The console's own playout routes are session-gated by policy and must not be asked
        // for a secret they have no way to present.
        const result = await run(request('/playout/status'));

        expect(result.passed).toBe(true);
    });

    it('matches a path segment, not a string prefix', async () => {
        // Without the trailing slash on BRIDGE_PATH_PREFIX this would be gated by accident,
        // and an accidental gate is as much of a surprise as an accidental hole.
        const result = await run(request('/playout/bridgehead'));

        expect(result.passed).toBe(true);
    });
});
