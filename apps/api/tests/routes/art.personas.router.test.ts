// The portrait routes through the real chain, for the one thing a service test cannot see: the ORDER
// they are mounted in. `/art/personas` also matches `/art/{id}`, so with the routers the other way
// round the listing answers 400 from a check on a different route and never runs.

import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { errorMiddleware } from '@maroonedsoftware/koa';
import { PolicyService } from '@maroonedsoftware/policies';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtPersonasRouter } from '../../src/routes/art.personas.router.js';
import { ArtRouter } from '../../src/routes/art.router.js';
import { PersonaArtworkService } from '../../src/modules/art/persona.artwork.service.js';
import { ArtService } from '../../src/modules/art/art.service.js';

// Explicitly, for the reason `art.router.test.ts` gives at length: `listen(0)` on the wildcard is
// flaky under a sandbox that has no route to every interface it binds.
const LOOPBACK = '127.0.0.1';

const PERSONA = '22222222-2222-4222-8222-222222222222';
const LISTING = { portraits: [{ personaId: PERSONA, url: 'art/asset-1/cover.png' }] };

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
const serve = async (portraits: Partial<PersonaArtworkService>, art: Partial<ArtService> = {}): Promise<string> => {
    const app = new Koa();

    app.use(errorMiddleware() as unknown as Koa.Middleware);
    // `requirePolicy` reads the session off the context and asserts through the container's
    // `PolicyService`. Both are satisfied rather than exercised: which policy each route carries is
    // the contract's business, and this file is about which ROUTER answers.
    const policies = { assert: vi.fn(async () => undefined) };
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) => (token === PersonaArtworkService ? portraits : token === PolicyService ? policies : art),
        };
        (ctx as unknown as { authenticationSession: unknown }).authenticationSession = { actor: { id: 'test' } };
        await next();
    });
    app.use(ArtPersonasRouter.routes() as unknown as Koa.Middleware);
    app.use(ArtRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('GET /art/personas', () => {
    it('reaches the listing rather than the art route it shares a shape with', async () => {
        const listPortraits = vi.fn(async () => LISTING);
        const getArt = vi.fn();
        const base = await serve({ listPortraits }, { getArt });

        const response = await send(`${base}/art/personas`);

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual(LISTING);
        expect(getArt).not.toHaveBeenCalled();
    });
});

describe('DELETE /art/personas/:personaId', () => {
    it('reaches the removal rather than the art file route', async () => {
        const removePortrait = vi.fn(async () => ({ portraits: [] }));
        const getArtFile = vi.fn();
        const base = await serve({ removePortrait }, { getArtFile });

        const response = await send(`${base}/art/personas/${PERSONA}`, 'DELETE');

        expect(response.status).toBe(200);
        expect(removePortrait).toHaveBeenCalledWith(PERSONA);
        expect(getArtFile).not.toHaveBeenCalled();
    });
});
