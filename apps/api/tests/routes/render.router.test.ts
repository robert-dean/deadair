// The segment audio route end to end, minus the database: the generated router, the real service,
// the real store over a temp directory, and the conditional-GET middleware.
//
// This route has two consumers and BOTH of them decide what to do with the bytes from the response
// header rather than from the bytes. A browser previewing a segment in an `<audio>` element does
// not sniff the way an `<img>` does, and Liquidsoap sends a HEAD before the GET, names the temp
// file it downloads to after the content type, and picks its decoder from that name. So the header
// is the thing worth pinning here, per format, through the real router — which is exactly what a
// unit test of the service cannot see.

import { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { request, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Koa from 'koa';
import { errorMiddleware } from '@maroonedsoftware/koa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RenderRouter } from '../../src/routes/render.router.js';
import { RenderService } from '../../src/modules/render/render.service.js';
import { SegmentRepository, type Segment } from '../../src/modules/render/segment.repository.js';
import { SEGMENT_CONTENT_TYPES, SegmentStore, type SegmentExtension } from '../../src/modules/render/segment.store.js';
import { conditionalGetMiddleware } from '../../src/server/middleware/conditional.get.middleware.js';

const ID = '11111111-1111-4111-8111-111111111111';
const BYTES = Buffer.from('a station ident');

/**
 * The address the test server binds, and it has to be this one rather than the wildcard.
 *
 * `listen(0)` binds `::` dual-stack, and the port the kernel picks for a wildcard bind is only
 * checked against other wildcard binds: a port already held by something listening on
 * `127.0.0.1` specifically is free as far as that allocation is concerned, and both sockets then
 * exist at once. Connecting to `127.0.0.1:<port>` afterwards reaches the more specific bind, so
 * the request is answered by whatever else is running on this machine and the assertion fails on
 * a status the route never returned. Binding the loopback address explicitly makes the collision
 * an `EADDRINUSE` the kernel refuses instead of a port two listeners quietly share, which is the
 * difference between a test that cannot be reached by anyone else's traffic and one that is
 * flaky once per sweep of the ephemeral range.
 */
const LOOPBACK = '127.0.0.1';

let root: string;
let store: SegmentStore;
let server: Server | undefined;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-render-router-test-'));
    store = new SegmentStore(root);
});

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
    await rm(root, { recursive: true, force: true });
});

const send = (
    url: string,
    options: { headers?: Record<string, string>; method?: string } = {},
): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }> =>
    new Promise((resolve, reject) => {
        const req = request(url, { headers: options.headers, method: options.method ?? 'GET' }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk as Buffer));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks), headers: response.headers }));
        });
        req.on('error', reject);
        req.end();
    });

/** The API's chain around the segment route: errors rendered, freshness applied, container stubbed. */
const serve = async (segment: Segment | undefined): Promise<string> => {
    const repository = { findById: async () => segment } as unknown as SegmentRepository;
    // Only the repository and the store are on this route: fetching a segment's audio
    // neither writes words nor speaks them, so the rest of the service's collaborators
    // are never reached and are stubbed to nothing rather than faked.
    const unused = {} as never;
    const service = new RenderService(repository, store, unused, unused, unused, unused, unused, unused);
    const app = new Koa();

    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = { get: () => service };
        await next();
    });
    app.use(conditionalGetMiddleware() as unknown as Koa.Middleware);
    app.use(RenderRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

const ready = (checksum: string, ext: SegmentExtension): Segment => ({
    id: ID,
    kind: 'ident',
    state: 'ready',
    label: 'Top of the hour',
    source: 'library',
    audioChecksum: checksum,
    audioExt: ext,
});

describe('GET /segments/:id/audio', () => {
    it('serves the bytes with the checksum as the validator', async () => {
        const checksum = await store.write(BYTES, 'mp3');
        const base = await serve(ready(checksum, 'mp3'));

        const response = await send(`${base}/segments/${ID}/audio`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(BYTES);
        expect(response.headers['etag']).toBe(`"${checksum}"`);
        expect(response.headers['cache-control']).toBe('public, max-age=86400');
    });

    // The load-bearing assertion in this file: every format is announced as itself, because the
    // consumers choose a decoder from this header. Serving a wav as audio/mpeg fails as silence.
    it.each(Object.entries(SEGMENT_CONTENT_TYPES))('serves a %s as %s', async (ext, contentType) => {
        const checksum = await store.write(BYTES, ext as SegmentExtension);
        const base = await serve(ready(checksum, ext as SegmentExtension));

        expect((await send(`${base}/segments/${ID}/audio`)).headers['content-type']).toBe(contentType);
    });

    // Liquidsoap HEADs before it GETs and reads the type off the HEAD. @koa/router registers HEAD
    // for every GET route, so this answers with the header and no body.
    it('answers the HEAD that Liquidsoap sends before fetching', async () => {
        const checksum = await store.write(BYTES, 'mp3');
        const base = await serve(ready(checksum, 'mp3'));

        const response = await send(`${base}/segments/${ID}/audio`, { method: 'HEAD' });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('audio/mpeg');
        expect(response.body).toHaveLength(0);
    });

    it('answers a revalidation with 304 and no bytes', async () => {
        const checksum = await store.write(BYTES, 'mp3');
        const base = await serve(ready(checksum, 'mp3'));

        const response = await send(`${base}/segments/${ID}/audio`, { headers: { 'If-None-Match': `"${checksum}"` } });

        expect(response.status).toBe(304);
        expect(response.body).toHaveLength(0);
    });

    it('404s a segment that has no audio', async () => {
        const base = await serve({ id: ID, kind: 'talkbreak', state: 'planned', label: 'A talk break', source: 'render' });

        expect((await send(`${base}/segments/${ID}/audio`)).status).toBe(404);
    });

    it('404s when the file has gone missing under the row', async () => {
        const base = await serve(ready('a'.repeat(64), 'mp3'));

        expect((await send(`${base}/segments/${ID}/audio`)).status).toBe(404);
    });
});
