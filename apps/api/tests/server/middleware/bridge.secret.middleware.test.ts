// This middleware IS the gate on the playout bridge. Nothing behind it checks the secret
// any more, so a hole here is a hole in every bridge route at once — including the one
// Icecast blocks on, where a wrong answer refuses listeners the mount.
//
// The prefix match is as load-bearing as the compare: it is what makes a route added under
// /playout/bridge/ protected without anyone remembering to protect it, and what keeps the
// gate off the rest of the app.

import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { ServerKitRouter, errorMiddleware } from '@maroonedsoftware/koa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_PATH_PREFIX, bridgeSecretMiddleware } from '../../../src/server/middleware/bridge.secret.middleware.js';
import { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';

const SECRET = 'bridge-secret';

// Explicitly, for the reason `art.router.test.ts` gives: `listen(0)` on the wildcard is flaky under a
// sandbox that has no route to every interface it binds.
const LOOPBACK = '127.0.0.1';

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

    it.each(['/PLAYOUT/BRIDGE/aired', '/Playout/Bridge/Listener', '/playout/BRIDGE/aired/'])(
        'gates %s, a spelling the case-insensitive router serves as a bridge route',
        async path => {
            expect((await run(request(path))).status).toBe(401);
            expect(await run(request(path, { 'x-playout-secret': SECRET }))).toEqual({ passed: true });
        },
    );

    it('matches a path segment, not a string prefix', async () => {
        // Without the trailing slash on BRIDGE_PATH_PREFIX this would be gated by accident,
        // and an accidental gate is as much of a surprise as an accidental hole.
        const result = await run(request('/playout/bridgehead'));

        expect(result.passed).toBe(true);
    });
});

// The gate is only as wide as the paths the ROUTER would serve, and `@koa/router` is case-insensitive
// and ignores a trailing slash. So this mounts a real router behind the real middleware and asks for
// every spelling of a bridge route somebody might try: each one is either refused by the gate or
// unknown to the router, and none of them reaches the handler.
describe('bridgeSecretMiddleware against the router it guards', () => {
    let server: Server | undefined;

    afterEach(async () => {
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        server = undefined;
    });

    const serve = async () => {
        const handled = vi.fn();
        const router = ServerKitRouter();
        router.post('/playout/bridge/aired', async ctx => {
            handled(ctx.path);
            ctx.status = 200;
            ctx.body = 'served';
        });

        const app = new Koa();
        app.use(errorMiddleware() as unknown as Koa.Middleware);
        app.use(async (ctx, next) => {
            (ctx as unknown as { container: unknown }).container = request(ctx.path).container;
            await next();
        });
        app.use(bridgeSecretMiddleware() as unknown as Koa.Middleware);
        app.use(router.routes() as unknown as Koa.Middleware);

        server = app.listen(0, LOOPBACK);
        await new Promise<void>(resolve => server!.once('listening', () => resolve()));
        return { base: `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`, handled };
    };

    const post = (url: string, headers: Record<string, string> = {}): Promise<number> =>
        new Promise((resolve, reject) => {
            const req = httpRequest(url, { method: 'POST', headers }, response => {
                response.resume();
                response.on('end', () => resolve(response.statusCode ?? 0));
            });
            req.on('error', reject);
            req.end();
        });

    it('serves the route itself to a caller holding the secret, so the harness is real', async () => {
        const { base, handled } = await serve();

        expect(await post(`${base}/playout/bridge/aired`, { 'x-playout-secret': SECRET })).toBe(200);
        expect(handled).toHaveBeenCalledOnce();
    });

    it.each([
        '/playout/bridge/aired',
        '/PLAYOUT/BRIDGE/AIRED',
        '/Playout/Bridge/aired',
        '/playout/BRIDGE/aired',
        '/playout/bridge/aired/',
        '/PLAYOUT/bridge/aired/',
        '/playout/%62ridge/aired',
        '/playout//bridge/aired',
    ])('never serves %s without the secret', async path => {
        const { base, handled } = await serve();

        const status = await post(`${base}${path}`);

        expect([401, 404]).toContain(status);
        expect(handled).not.toHaveBeenCalled();
    });
});
