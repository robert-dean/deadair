// The break-artwork routes through the real chain, for the one thing a service test cannot see: the
// ORDER these are mounted in. `/art/breaks` also matches `/art/{id}`, whose id is a uuid, so with
// the routers the other way round every operation here answers 400 from a check on a different
// route and never runs.

import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { errorMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { PolicyService } from '@maroonedsoftware/policies';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtBreaksRouter } from '../../src/routes/art.breaks.router.js';
import { ArtRouter } from '../../src/routes/art.router.js';
import { BreakArtworkService } from '../../src/modules/art/break.artwork.service.js';
import { ArtService } from '../../src/modules/art/art.service.js';

// Explicitly, for the reason `art.router.test.ts` gives at length: `listen(0)` on the wildcard is
// flaky under a sandbox that has no route to every interface it binds.
const LOOPBACK = '127.0.0.1';

const LISTING = { breaks: [{ kind: 'weather', url: 'art/asset-1/cover.png', source: 'shipped' as const, hasShipped: true }] };

let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

const send = (url: string, method = 'GET'): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
        const req = request(url, { method }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk as Buffer));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        req.end();
    });

/**
 * Both art routers, mounted in the order `routes.setup.ts` mounts them, with the policy middleware
 * satisfied and the container stubbed.
 */
const serve = async (breaks: Partial<BreakArtworkService>, art: Partial<ArtService> = {}): Promise<string> => {
    const app = new Koa();

    app.use(errorMiddleware() as unknown as Koa.Middleware);
    // `requirePolicy` reads the session off the context and asserts through the container's
    // `PolicyService`. Both are satisfied rather than exercised: which policy each route carries is
    // the contract's business, and this file is about which ROUTER answers.
    const policies = { assert: vi.fn(async () => undefined) };
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) => (token === BreakArtworkService ? breaks : token === PolicyService ? policies : art),
        };
        (ctx as unknown as { authenticationSession: unknown }).authenticationSession = { actor: { id: 'test' } };
        await next();
    });
    app.use(ArtBreaksRouter.routes() as unknown as Koa.Middleware);
    app.use(ArtRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('GET /art/breaks', () => {
    it('reaches the listing rather than the art route it shares a shape with', async () => {
        const listBreaks = vi.fn(async () => LISTING);
        const getArt = vi.fn();
        const base = await serve({ listBreaks }, { getArt });

        const response = await send(`${base}/art/breaks`);

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual(LISTING);
        // The proof that the order is doing the work: `/art/{id}` never saw it.
        expect(getArt).not.toHaveBeenCalled();
    });

    it('leaves a real art id to the art route', async () => {
        const listBreaks = vi.fn();
        const getArt = vi.fn(async () => ({
            contentType: 'image/png' as const,
            body: Buffer.from('bytes'),
            headers: { cacheControl: 'no-cache', etag: '"x"' },
        }));
        const base = await serve({ listBreaks }, { getArt });

        const response = await send(`${base}/art/11111111-1111-4111-8111-111111111111`);

        expect(response.status).toBe(200);
        expect(getArt).toHaveBeenCalled();
        expect(listBreaks).not.toHaveBeenCalled();
    });
});

describe('DELETE /art/breaks/:kind', () => {
    it('reaches the revert rather than the art file route', async () => {
        const revertBreak = vi.fn(async () => LISTING);
        const getArtFile = vi.fn();
        const base = await serve({ revertBreak }, { getArtFile });

        const response = await send(`${base}/art/breaks/weather`, 'DELETE');

        expect(response.status).toBe(200);
        expect(revertBreak).toHaveBeenCalledWith('weather');
        expect(getArtFile).not.toHaveBeenCalled();
    });

    it('answers a kind nothing is shipped for with the 404 the service raises', async () => {
        const revertBreak = vi.fn(async () => {
            throw httpError(404).withDetails({ message: 'this station ships no picture for a talkbreak break' });
        });
        const base = await serve({ revertBreak });

        expect((await send(`${base}/art/breaks/talkbreak`, 'DELETE')).status).toBe(404);
    });
});
