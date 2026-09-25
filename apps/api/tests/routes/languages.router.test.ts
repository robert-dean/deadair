// The console-language routes through the real router, for the one thing a service test cannot see:
// which of them ask the policy service at all. The sign-in page loads its language from the two
// reads before anybody has signed in, so they must never ask; the two writes must ask for
// `platform.manage`, which only an admin holds. `requirePolicy` leaves the session itself to the
// policy service, so what this pins is the question each route puts to it.

import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { errorMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { PolicyService } from '@maroonedsoftware/policies';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguagesRouter } from '../../src/routes/languages.router.js';
import { ConsoleLanguagesService } from '../../src/modules/languages/console.languages.service.js';

// Explicitly, for the reason `art.router.test.ts` gives: `listen(0)` on the wildcard is flaky under
// a sandbox that has no route to every interface it binds.
const LOOPBACK = '127.0.0.1';

const PACK = {
    format: 'deadair.console-language',
    version: 1,
    locale: 'de',
    name: 'Deutsch',
    direction: 'ltr',
    madeFor: '0.35.0',
    catalog: { common: { action: { cancel: 'Abbrechen' } } },
};

let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

const send = (url: string, method = 'GET', body?: unknown): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
        const text = body === undefined ? undefined : JSON.stringify(body);
        const headers = text === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) };
        const req = request(url, { method, headers }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk as Buffer));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        if (text !== undefined) req.write(text);
        req.end();
    });

/** Every policy a route asked the policy service about, in order. */
let asked: unknown[] = [];

/** The router with nobody signed in, and a policy service that records the question and refuses it, as the real one does for no session. */
const serve = async (languages: Partial<ConsoleLanguagesService>): Promise<string> => {
    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    asked = [];
    const policies = {
        assert: vi.fn(async (policy: unknown) => {
            asked.push(policy);
            throw httpError(401);
        }),
    };
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) => (token === PolicyService ? policies : languages),
        };
        await next();
    });
    app.use(LanguagesRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('the console-language routes, signed out', () => {
    it('list the languages', async () => {
        const list = vi.fn(async () => ({ languages: [] }));
        const base = await serve({ list });

        const response = await send(`${base}/console/languages`);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ languages: [] });
        expect(asked).toEqual([]);
    });

    it('hand back a pack', async () => {
        const get = vi.fn(async () => PACK as never);
        const base = await serve({ get });

        const response = await send(`${base}/console/languages/de`);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual(PACK);
        expect(get).toHaveBeenCalledWith('de');
        expect(asked).toEqual([]);
    });

    it('refuse an import', async () => {
        const importPack = vi.fn();
        const base = await serve({ import: importPack });

        expect((await send(`${base}/console/languages/de`, 'PUT', PACK)).status).toBe(401);
        expect(importPack).not.toHaveBeenCalled();
        expect(asked).toEqual(['platform.manage']);
    });

    it('refuse a removal', async () => {
        const remove = vi.fn();
        const base = await serve({ remove });

        expect((await send(`${base}/console/languages/de`, 'DELETE')).status).toBe(401);
        expect(remove).not.toHaveBeenCalled();
        expect(asked).toEqual(['platform.manage']);
    });
});
