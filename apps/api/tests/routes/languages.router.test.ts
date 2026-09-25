// The console-language routes through the real router, for the one thing a service test cannot see:
// who reaches each one. The sign-in page loads its language from the two reads before anybody has
// signed in, so they answer with no session and ask nothing; importing and removing ask for
// `platform.manage`, which only an admin holds; and an operator's own choice asks for
// `platform.view`, which every operator role grants.

import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { errorMiddleware, JsonParser, JsonParserOptions, ServerKitBodyParser, ServerKitParserMappings } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { PolicyService } from '@maroonedsoftware/policies';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
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

/**
 * The router, signed out or signed in. Signed out is the authentication middleware's own sentinel,
 * which `requirePolicy` refuses before asking anything. Signed in is a session, and a policy service
 * that records each question and refuses it, so a route that asks gets no further.
 */
const serve = async (languages: Partial<ConsoleLanguagesService>, signedIn = false): Promise<string> => {
    // The real JSON parser, which the router resolves from the request's container.
    const mappings = new ServerKitParserMappings();
    mappings.set('json', new JsonParser(new JsonParserOptions()));
    const bodyParser = new ServerKitBodyParser(mappings);

    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    asked = [];
    const policies = {
        assert: vi.fn(async (policy: unknown) => {
            asked.push(policy);
            throw httpError(403);
        }),
    };
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) => (token === PolicyService ? policies : token === ServerKitBodyParser ? bodyParser : languages),
        };
        (ctx as unknown as { authenticationSession: unknown }).authenticationSession = signedIn
            ? { subject: 'admin-1' }
            : invalidAuthenticationSession;
        await next();
    });
    app.use(LanguagesRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('signed out', () => {
    it('lists the languages, asking nothing', async () => {
        const list = vi.fn(async () => ({ languages: [] }));
        const base = await serve({ list });

        const response = await send(`${base}/console/languages`);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ languages: [] });
        expect(asked).toEqual([]);
    });

    it('hands back a pack, asking nothing', async () => {
        const get = vi.fn(async () => PACK as never);
        const base = await serve({ get });

        const response = await send(`${base}/console/languages/de`);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual(PACK);
        expect(get).toHaveBeenCalledWith('de');
    });

    it('refuses everything else', async () => {
        const handlers = { import: vi.fn(), remove: vi.fn(), choice: vi.fn(), choose: vi.fn() };
        const base = await serve(handlers);

        expect((await send(`${base}/console/languages/de`, 'PUT', PACK)).status).toBe(401);
        expect((await send(`${base}/console/languages/de`, 'DELETE')).status).toBe(401);
        expect((await send(`${base}/console/language`)).status).toBe(401);
        expect((await send(`${base}/console/language`, 'PUT', { locale: 'de' })).status).toBe(401);
        for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
    });
});

describe('signed in', () => {
    it('asks for platform.manage to import or remove a language', async () => {
        const handlers = { import: vi.fn(), remove: vi.fn() };
        const base = await serve(handlers, true);

        expect((await send(`${base}/console/languages/de`, 'PUT', PACK)).status).toBe(403);
        expect((await send(`${base}/console/languages/de`, 'DELETE')).status).toBe(403);
        expect(asked).toEqual(['platform.manage', 'platform.manage']);
        expect(handlers.import).not.toHaveBeenCalled();
    });

    it('asks only platform.view to read or keep your own choice', async () => {
        const choice = vi.fn(async () => ({ locale: 'de' }));
        const choose = vi.fn(async () => ({}));
        const base = await serve({ choice, choose }, true);

        // Every operator role grants it; the stub refuses it here only so the question is recorded.
        expect((await send(`${base}/console/language`)).status).toBe(403);
        expect((await send(`${base}/console/language`, 'PUT', {})).status).toBe(403);
        expect(asked).toEqual(['platform.view', 'platform.view']);
    });
});
