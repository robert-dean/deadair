// `POST /auth/factors/start` end to end, minus the service: the generated router with its own
// `bodyParserMiddleware`, a real JSON parser, and the error middleware that renders an `httpError`.
//
// It exists because of what the bug looked like from outside. A well-formed email body answered
// `400 {"_root":"Expected object"}`, which is what `parseAndValidate` reports when the value it was
// handed is not an object — so the natural reading was that the body never reached the route, and
// the search went into `bodyParserMiddleware`, `authenticationMiddleware` and the middleware order.
// It was none of those: the body arrived intact and the service returned `undefined`. A unit test
// on the service cannot tell those two apart, because it hands the service a parsed object itself.
// This one can: it puts real bytes on a real socket, so a status that is anything but the service's
// own is a body that did not arrive.

import { AddressInfo } from 'node:net';
import { request, Server } from 'node:http';
import Koa from 'koa';
import { errorMiddleware, JsonParser, JsonParserOptions, ServerKitBodyParser, ServerKitParserMappings } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationFactorRouter } from '../../src/routes/authentication.factor.router.js';
import { AuthenticationService } from '../../src/modules/authentication/authentication.service.js';

/** See `art.router.test.ts`: `listen(0)` binds the wildcard, so a loopback request can reach elsewhere. */
const LOOPBACK = '127.0.0.1';

let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

const post = (url: string, body: string, contentType = 'application/json'): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
        const payload = Buffer.from(body);
        const req = request(
            url,
            { method: 'POST', headers: { 'content-type': contentType, 'content-length': String(payload.byteLength) } },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(chunk as Buffer));
                response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
            },
        );
        req.on('error', reject);
        req.end(payload);
    });

/**
 * The chain the API puts around this route: errors rendered, and a container that answers the two
 * tokens the route resolves — the body parser its middleware asks for, and the service itself.
 *
 * The parser is the real one rather than a stub, because "did the bytes become an object" is the
 * whole question this file exists to answer.
 */
const serve = async (service: Partial<AuthenticationService>): Promise<string> => {
    const mappings = new ServerKitParserMappings();
    mappings.set('json', new JsonParser(new JsonParserOptions()));
    const bodyParser = new ServerKitBodyParser(mappings);

    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) => (token === ServerKitBodyParser ? bodyParser : service),
        };
        await next();
    });
    app.use(AuthenticationFactorRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('POST /auth/factors/start', () => {
    it('hands the parsed body to the service, method and all', async () => {
        const startFactorChallenge = vi.fn().mockResolvedValue({ method: 'fido', fido_challenge_id: 'c1' });
        const url = await serve({ startFactorChallenge });

        const response = await post(`${url}/auth/factors/start`, JSON.stringify({ method: 'fido', mfa_challenge_id: 'mfa-1' }));

        expect(response.status).toBe(200);
        expect(startFactorChallenge).toHaveBeenCalledWith({ method: 'fido', mfa_challenge_id: 'mfa-1' });
    });

    it('reaches the service with an email body too, which is the one that used to look unparsed', async () => {
        const startFactorChallenge = vi.fn().mockResolvedValue({ method: 'email', email_challenge_id: 'c1' });
        const url = await serve({ startFactorChallenge });

        await post(`${url}/auth/factors/start`, JSON.stringify({ method: 'email', mfa_challenge_id: 'mfa-1' }));

        expect(startFactorChallenge).toHaveBeenCalledWith({ method: 'email', mfa_challenge_id: 'mfa-1' });
    });

    it('renders the service’s 501 rather than turning it into a request-validation failure', async () => {
        const url = await serve({
            startFactorChallenge: () => Promise.reject(httpError(501).withDetails({ method: 'email factor challenges are not implemented' })),
        });

        const response = await post(`${url}/auth/factors/start`, JSON.stringify({ method: 'email', mfa_challenge_id: 'mfa-1' }));

        expect(response.status).toBe(501);
    });

    it('answers 400 with the offending field when the body really is wrong', async () => {
        const url = await serve({ startFactorChallenge: vi.fn() });

        const response = await post(`${url}/auth/factors/start`, JSON.stringify({ method: 'nonsense' }));

        expect(response.status).toBe(400);
        expect(JSON.parse(response.body).details).toHaveProperty('method');
    });

    it('answers 411 when there is no body at all, which is what an absent one actually looks like', async () => {
        const url = await serve({ startFactorChallenge: vi.fn() });

        const response = await post(`${url}/auth/factors/start`, '');

        expect(response.status).toBe(411);
    });
});
