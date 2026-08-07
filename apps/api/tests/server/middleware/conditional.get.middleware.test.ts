// Run against a real Koa app rather than a hand-built ctx: the thing under test is a claim about
// Koa's own behaviour (that `ctx.fresh` matches an If-None-Match, and that assigning 304 drops the
// body), and a fake ctx would only re-assert the claim rather than check it.

import { AddressInfo } from 'node:net';
import { request, Server } from 'node:http';
import Koa from 'koa';
import { afterEach, describe, expect, it } from 'vitest';

import { conditionalGetMiddleware } from '../../../src/server/middleware/conditional.get.middleware.js';

const ETAG = '"cafebabe"';

let server: Server | undefined;

/**
 * A raw HTTP client, deliberately not `fetch`.
 *
 * undici sends `Cache-Control: no-cache` on every request, and a no-cache request is stale by
 * definition (RFC 7234 via the `fresh` package), so `fetch` can never observe a 304 no matter what
 * the server does. A browser revalidating an expired cache entry sends the validator without it,
 * which is what this sends.
 */
const send = (url: string, options: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Buffer }> =>
    new Promise((resolve, reject) => {
        const req = request(url, { method: options.method ?? 'GET', headers: options.headers }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk as Buffer));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
    });

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

/** Boots an app whose single route answers with `body`, plus whatever headers the test wants. */
const serve = async (handler: (ctx: Koa.Context) => void): Promise<string> => {
    const app = new Koa();
    app.use(conditionalGetMiddleware() as unknown as Koa.Middleware);
    app.use(async ctx => handler(ctx));

    server = app.listen(0);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
};

const withEtag = (ctx: Koa.Context): void => {
    ctx.set('ETag', ETAG);
    ctx.type = 'application/octet-stream';
    ctx.body = Buffer.from('cover art');
};

describe('conditionalGetMiddleware', () => {
    it('serves the body when the client presents no validator', async () => {
        const base = await serve(withEtag);

        const response = await send(`${base}/art/x`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(Buffer.from('cover art'));
    });

    it('answers 304 with no body when the presented ETag still matches', async () => {
        const base = await serve(withEtag);

        const response = await send(`${base}/art/x`, { headers: { 'If-None-Match': ETAG } });

        expect(response.status).toBe(304);
        expect(response.body).toHaveLength(0);
    });

    it('serves the body when the presented ETag is stale', async () => {
        const base = await serve(withEtag);

        const response = await send(`${base}/art/x`, { headers: { 'If-None-Match': '"stale"' } });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(Buffer.from('cover art'));
    });

    // A reload is not a revalidation: the client is asking for the bytes whatever it holds.
    it('serves the body to a client that asked for no-cache, validator or not', async () => {
        const base = await serve(withEtag);

        const response = await send(`${base}/art/x`, { headers: { 'If-None-Match': ETAG, 'Cache-Control': 'no-cache' } });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(Buffer.from('cover art'));
    });

    it('leaves a response that set no ETag alone', async () => {
        const base = await serve(ctx => {
            ctx.body = { ok: true };
        });

        const response = await send(`${base}/anything`, { headers: { 'If-None-Match': ETAG } });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body.toString())).toEqual({ ok: true });
    });

    it('leaves a non-200 alone even when the validator matches', async () => {
        const base = await serve(ctx => {
            ctx.status = 201;
            ctx.set('ETag', ETAG);
            ctx.body = { created: true };
        });

        const response = await send(`${base}/anything`, { headers: { 'If-None-Match': ETAG } });

        expect(response.status).toBe(201);
    });

    it('leaves a write alone: a matching validator on a POST is not a revalidation', async () => {
        const base = await serve(withEtag);

        const response = await send(`${base}/art/x`, { method: 'POST', headers: { 'If-None-Match': ETAG } });

        expect(response.status).toBe(200);
    });
});
