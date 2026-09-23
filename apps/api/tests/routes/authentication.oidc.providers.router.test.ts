// The sign-in page asks this before anybody is signed in, so the route has to be public: a
// generated route with no security block would gate on a session and the page would draw no
// provider buttons for the one person who needs them. Served over a real socket for that reason.

import { AddressInfo } from 'node:net';
import { get, Server } from 'node:http';
import Koa from 'koa';
import { errorMiddleware } from '@maroonedsoftware/koa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationRouter } from '../../src/routes/authentication.router.js';

const LOOPBACK = '127.0.0.1';

let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

const serve = async (listOidcProviders: () => Promise<unknown>): Promise<string> => {
    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: () => unknown } }).container = { get: () => ({ listOidcProviders }) };
        await next();
    });
    app.use(AuthenticationRouter.routes() as unknown as Koa.Middleware);
    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

const fetchJson = (url: string): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
        get(url, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk as Buffer));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        }).on('error', reject);
    });

describe('GET /auth/login/oidc/providers', () => {
    it('answers the providers to somebody who is not signed in', async () => {
        const listOidcProviders = vi.fn().mockResolvedValue([{ name: 'authelia', label: 'Authelia' }]);
        const url = await serve(listOidcProviders);

        const response = await fetchJson(`${url}/auth/login/oidc/providers`);

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual([{ name: 'authelia', label: 'Authelia' }]);
    });

    it('answers an empty list when none is set up', async () => {
        const url = await serve(vi.fn().mockResolvedValue([]));
        expect(JSON.parse((await fetchJson(`${url}/auth/login/oidc/providers`)).body)).toEqual([]);
    });
});
