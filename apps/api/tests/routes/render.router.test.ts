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
import {
    errorMiddleware,
    bodyParserMiddleware,
    ServerKitBodyParser,
    ServerKitParserMappings,
    JsonParser,
    JsonParserOptions,
    defaultParserMappings,
} from '@maroonedsoftware/koa';
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

/** Like {@link send}, but writes a body — needed only by the JSON body limit test below. */
const postJson = (url: string, body: string): Promise<{ status: number }> =>
    new Promise((resolve, reject) => {
        const req = request(
            url,
            { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } },
            response => {
                response.on('data', () => undefined);
                response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
            },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });

/** The API's chain around the segment route: errors rendered, freshness applied, container stubbed. */
const serve = async (segment: Segment | undefined): Promise<string> => {
    const repository = { findById: async () => segment } as unknown as SegmentRepository;
    // Only the repository and the store are on this route: fetching a segment's audio
    // neither writes words nor speaks them, so the rest of the service's collaborators
    // are never reached and are stubbed to nothing rather than faked.
    const unused = {} as never;
    const service = new RenderService(
        repository,
        store,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
    );
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
    pads: [],
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
        const base = await serve({ id: ID, kind: 'talkbreak', state: 'planned', label: 'A talk break', source: 'render', pads: [] });

        expect((await send(`${base}/segments/${ID}/audio`)).status).toBe(404);
    });

    it('404s when the file has gone missing under the row', async () => {
        const base = await serve(ready('a'.repeat(64), 'mp3'));

        expect((await send(`${base}/segments/${ID}/audio`)).status).toBe(404);
    });
});

// The join's own route, and the reason it exists: a padded break is several takes with a soundboard
// hit between them, and the mixer runs in another container, so every part has to be fetchable. A
// take is not a segment and never will be, and neither is a pad — so this addresses the store the
// way the store addresses itself.
describe('GET /audio/:checksum/:ext', () => {
    it('serves bytes that no row names', async () => {
        const checksum = await store.write(BYTES, 'mp3');
        // Deliberately a segment the repository does NOT hold: nothing about this route consults a
        // row, which is the whole point.
        const base = await serve(undefined);

        const response = await send(`${base}/audio/${checksum}/mp3`);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('audio/mpeg');
        expect(response.headers['etag']).toBe(`"${checksum}"`);
        expect(response.body.equals(BYTES)).toBe(true);
    });

    it('says the bytes can be cached forever, because a checksum names bytes rather than a thing', async () => {
        const checksum = await store.write(BYTES, 'mp3');
        const base = await serve(undefined);

        const response = await send(`${base}/audio/${checksum}/mp3`);

        expect(response.headers['cache-control']).toContain('immutable');
    });

    it('404s an extension the store does not serve rather than composing a path out of it', async () => {
        const checksum = await store.write(BYTES, 'mp3');
        const base = await serve(undefined);

        // The path-safety half: both halves of the filename come from a URL, so a value that is not
        // one of the store's own formats is refused before anything joins it to a path.
        expect((await send(`${base}/audio/${checksum}/../../etc/passwd`)).status).not.toBe(200);
        expect((await send(`${base}/audio/${checksum}/exe`)).status).toBe(404);
    });

    it('404s a checksum the store has never held', async () => {
        const base = await serve(undefined);

        expect((await send(`${base}/audio/${'0'.repeat(64)}/mp3`)).status).toBe(404);
    });
});

// setup.server.ts raises the JSON parser's limit to 16mb globally (see the comment there for why
// global rather than a per-route subtype), so a body well above the kit's 1mb default — a persona
// import, in particular — must not be refused for its size. This exercises the same
// ServerKitBodyParser/bodyParserMiddleware chain every route runs, with a JsonParser built the same
// way setup.server.ts builds it, rather than the route business logic, which is not what a body
// size limit is about.
const serveWithJsonParser = async (jsonParser: JsonParser, onBody?: (ctx: Koa.Context) => void): Promise<string> => {
    const mappings = new ServerKitParserMappings();
    mappings.set('json', jsonParser);
    const bodyParser = new ServerKitBodyParser(mappings);

    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = { get: () => bodyParser };
        await next();
    });
    app.use(bodyParserMiddleware(['json']) as unknown as Koa.Middleware);
    app.use(async ctx => {
        onBody?.(ctx);
        ctx.status = 200;
    });

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('the JSON body limit', () => {
    it('accepts a 2 MB body rather than answering 413', async () => {
        const jsonParser = new JsonParser(Object.assign(new JsonParserOptions(), { limit: '16mb' }));
        const base = await serveWithJsonParser(jsonParser);

        const body = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) });
        const response = await postJson(`${base}/`, body);

        expect(response.status).toBe(200);
    });

    // The boundary the raised limit still has: something above it is refused rather than the limit
    // having been removed altogether. `raw-body`'s 413 is a plain error rather than an
    // `@maroonedsoftware/errors` HttpError, so `bodyParserMiddleware`'s catch (not something this
    // change touches) reports it as 422 — the boundary still bites, just under that status.
    it('still refuses a body over 16 MB rather than accepting it', async () => {
        const jsonParser = new JsonParser(Object.assign(new JsonParserOptions(), { limit: '16mb' }));
        const base = await serveWithJsonParser(jsonParser);

        const body = JSON.stringify({ data: 'x'.repeat(17 * 1024 * 1024) });
        const response = await postJson(`${base}/`, body);

        expect(response.status).toBe(422);
    });

    // The reason setup.server.ts builds its options on top of `defaultParserMappings.json`'s own
    // instance rather than a bare `new JsonParserOptions()`: a bare one has no reviver, so the
    // obvious way to raise the limit silently drops the bigint round-trip every other JSON route
    // gets for free. Built the same way setup.server.ts builds it, so a regression there fails here.
    it('keeps the bigint reviver in force at the raised limit', async () => {
        const jsonParserOptions = Object.assign(new JsonParserOptions(), defaultParserMappings.json!.options!.instance as JsonParserOptions, {
            limit: '16mb',
        });
        const jsonParser = new JsonParser(jsonParserOptions);

        let parsedValue: unknown;
        const base = await serveWithJsonParser(jsonParser, ctx => {
            parsedValue = (ctx as unknown as { parsedBody: { count: unknown } }).parsedBody.count;
        });

        const response = await postJson(`${base}/`, JSON.stringify({ count: '123n' }));

        expect(response.status).toBe(200);
        expect(parsedValue).toBe(123n);
    });
});
