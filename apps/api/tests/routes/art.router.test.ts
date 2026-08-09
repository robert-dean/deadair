// The art route end to end, minus the database: the generated router, the real service, the real
// store over a temp directory, and the conditional-GET middleware that turns a revalidation into a
// 304. It is the only place the three meet, and the pieces they hand each other (a Buffer body, an
// octet-stream type, an ETag the middleware reads back) are exactly what a unit test cannot see.

import { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { request, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Koa from 'koa';
import { errorMiddleware } from '@maroonedsoftware/koa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArtRepository } from '../../src/modules/art/art.repository.js';
import { ArtRouter } from '../../src/routes/art.router.js';
import { ArtService } from '../../src/modules/art/art.service.js';
import { ArtStore } from '../../src/modules/art/art.store.js';
import { conditionalGetMiddleware } from '../../src/server/middleware/conditional.get.middleware.js';

const ID = '11111111-1111-4111-8111-111111111111';
const BYTES = Buffer.from('cover art');

/**
 * The address the test server binds. See the note in `render.router.test.ts`: `listen(0)` binds
 * the wildcard, whose ephemeral port is chosen without regard to what is already bound to
 * `127.0.0.1` alone, and a request to the loopback address then reaches the other listener rather
 * than this server.
 */
const LOOPBACK = '127.0.0.1';

let root: string;
let store: ArtStore;
let server: Server | undefined;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-art-router-test-'));
    store = new ArtStore(root);
});

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
    await rm(root, { recursive: true, force: true });
});

const send = (
    url: string,
    headers?: Record<string, string>,
): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }> =>
    new Promise((resolve, reject) => {
        const req = request(url, { headers }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk as Buffer));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks), headers: response.headers }));
        });
        req.on('error', reject);
        req.end();
    });

/** The API's chain around the art route: errors rendered, freshness applied, container stubbed. */
const serve = async (repository: Partial<ArtRepository>): Promise<string> => {
    const service = new ArtService(repository as ArtRepository, store);
    const app = new Koa();

    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = { get: () => service };
        await next();
    });
    app.use(conditionalGetMiddleware() as unknown as Koa.Middleware);
    app.use(ArtRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('GET /art/:id', () => {
    it('serves the cached bytes with a validator and a cache lifetime', async () => {
        const checksum = await store.write(BYTES, 'jpg');
        const base = await serve({ findById: async () => ({ id: ID, sourceUrl: 'https://cdn/x.jpg', checksum, ext: 'jpg' }) });

        const response = await send(`${base}/art/${ID}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(BYTES);
        // The format it actually is, not one octet-stream standing in for four. This used to be
        // wrong and survived only because a browser sniffs an <img>; it is also what stopped this
        // API sending X-Content-Type-Options: nosniff.
        expect(response.headers['content-type']).toBe('image/jpeg');
        expect(response.headers['etag']).toBe(`"${checksum}"`);
        expect(response.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('serves each stored format as itself', async () => {
        const checksum = await store.write(BYTES, 'png');
        const base = await serve({ findById: async () => ({ id: ID, sourceUrl: 'https://cdn/x.png', checksum, ext: 'png' }) });

        expect((await send(`${base}/art/${ID}`)).headers['content-type']).toBe('image/png');
    });

    it('answers a revalidation with 304 and no bytes', async () => {
        const checksum = await store.write(BYTES, 'jpg');
        const base = await serve({ findById: async () => ({ id: ID, sourceUrl: 'https://cdn/x.jpg', checksum, ext: 'jpg' }) });

        const response = await send(`${base}/art/${ID}`, { 'If-None-Match': `"${checksum}"` });

        expect(response.status).toBe(304);
        expect(response.body).toHaveLength(0);
    });

    it('404s an id nothing has cached', async () => {
        const base = await serve({ findById: async () => undefined });

        expect((await send(`${base}/art/${ID}`)).status).toBe(404);
    });

    // The param is declared `uuid`, so anything shaped like a path segment is rejected before the
    // service (and therefore the filesystem) is reached at all.
    it('rejects an id that is not a uuid', async () => {
        const base = await serve({ findById: async () => undefined });

        expect((await send(`${base}/art/not-a-uuid`)).status).toBe(400);
    });
});
