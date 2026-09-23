// The OAuth endpoints whose shapes the RFCs fix, over a real socket, in front of the library's real
// authorization server built from its own parts over an in-memory cache and client store. What is
// under test is what an MCP client sees: 404 while OAuth is off, the discovery documents, 201 and an
// RFC 7591 body from registration, RFC 6749 error bodies from the token endpoint, both of its body
// encodings, and a client's HTTP Basic credential surviving the authentication middleware that
// deletes every Authorization header.

import { AddressInfo } from 'node:net';
import { request, Server } from 'node:http';
import Koa from 'koa';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';
import {
    AuthorizationCodeService,
    AuthorizationCodeServiceOptions,
    AuthorizationRequestStore,
    AuthorizationRequestStoreOptions,
    DynamicClientRegistrationService,
    OAuthAuthorizationServer,
    OAuthAuthorizationServerOptions,
    OAuthClientOptions,
    OAuthClientResolver,
    OAuthTokenEndpoint,
    type AuthenticationSessionService,
    type OAuthClient,
    type OAuthClientRepository,
} from '@maroonedsoftware/authentication';
import type { CacheProvider } from '@maroonedsoftware/cache';
import {
    errorMiddleware,
    FormParser,
    FormParserOptions,
    JsonParser,
    JsonParserOptions,
    ServerKitBodyParser,
    ServerKitParserMappings,
} from '@maroonedsoftware/koa';

import { OAuthProtocolRouter } from '../../src/routes/oauth.protocol.router.js';
import { oauthClientCredentialMiddleware } from '../../src/server/middleware/oauth.client.credential.middleware.js';
import { settingsConfig } from '../utils/settings.config.js';

const LOOPBACK = '127.0.0.1';
const ORIGIN = 'https://radio.example.com';
let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

function inMemoryCache(): CacheProvider {
    const store = new Map<string, string>();
    return {
        get: async (key: string) => store.get(key),
        set: async (key: string, value: string) => void store.set(key, value),
        delete: async (key: string) => void store.delete(key),
        add: async (key: string, value: string) => (store.has(key) ? false : (store.set(key, value), true)),
    } as unknown as CacheProvider;
}

function authorizationServer(): OAuthAuthorizationServer {
    const clients = new Map<string, OAuthClient>();
    const repository = {
        findByClientId: async (id: string) => clients.get(id),
        create: async (client: OAuthClient) => (clients.set(client.clientId, client), client),
        touchLastUsed: async () => undefined,
        deleteExpired: async () => 0,
    } as unknown as OAuthClientRepository;
    const cache = inMemoryCache();
    const options = new OAuthAuthorizationServerOptions(
        ORIGIN,
        `${ORIGIN}/oauth/authorize`,
        `${ORIGIN}/api/auth/oauth/token`,
        [`${ORIGIN}/api/mcp`],
        ['mcp'],
        `${ORIGIN}/api/auth/oauth/register`,
    );
    const clientOptions = new OAuthClientOptions();
    const resolver = new OAuthClientResolver(repository, clientOptions);
    const codes = new AuthorizationCodeService(cache, new AuthorizationCodeServiceOptions());
    return new OAuthAuthorizationServer(
        options,
        resolver,
        new AuthorizationRequestStore(cache, new AuthorizationRequestStoreOptions()),
        codes,
        new OAuthTokenEndpoint({} as AuthenticationSessionService, resolver, codes, options),
        new DynamicClientRegistrationService(repository, clientOptions),
    );
}

async function serve(enabled = 'true'): Promise<string> {
    const config = settingsConfig({ APP_BASE_URL: ORIGIN, 'oauth.enabled': enabled }).config;
    const mappings = new ServerKitParserMappings();
    mappings.set('json', new JsonParser(new JsonParserOptions()));
    mappings.set('urlencoded', new FormParser(new FormParserOptions()));
    const bodyParser = new ServerKitBodyParser(mappings);
    const facade = authorizationServer();

    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) =>
                token === ServerKitBodyParser ? bodyParser : token === AppConfig ? config : token === OAuthAuthorizationServer ? facade : undefined,
        };
        await next();
    });
    app.use(oauthClientCredentialMiddleware() as unknown as Koa.Middleware);
    // What ServerKit's authentication middleware does to every request.
    app.use(async (ctx, next) => {
        delete ctx.req.headers.authorization;
        await next();
    });
    app.use(OAuthProtocolRouter.routes() as unknown as Koa.Middleware);
    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
}

function send(url: string, method: string, body?: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
        const payload = body === undefined ? undefined : Buffer.from(body);
        const req = request(
            url,
            { method, headers: { ...headers, ...(payload ? { 'content-length': String(payload.byteLength) } : {}) } },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(chunk as Buffer));
                response.on('end', () =>
                    resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: response.headers }),
                );
            },
        );
        req.on('error', reject);
        req.end(payload);
    });
}

const json = (body: unknown) => JSON.stringify(body);
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

describe('OAuth discovery', () => {
    it('publishes the station as its own issuer', async () => {
        const url = await serve();
        const response = await send(`${url}/.well-known/oauth-authorization-server`, 'GET');

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({ issuer: ORIGIN, token_endpoint: `${ORIGIN}/api/auth/oauth/token` });
    });

    it('describes the MCP endpoint at both of its addresses', async () => {
        const url = await serve();
        for (const path of ['/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-protected-resource']) {
            const response = await send(`${url}${path}`, 'GET');
            expect(JSON.parse(response.body)).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
        }
    });

    it('answers 404 everywhere while OAuth is off', async () => {
        const url = await serve('false');
        expect((await send(`${url}/.well-known/oauth-authorization-server`, 'GET')).status).toBe(404);
        expect(
            (await send(`${url}/auth/oauth/register`, 'POST', json({ redirect_uris: [REDIRECT] }), { 'content-type': 'application/json' })).status,
        ).toBe(404);
        expect(
            (await send(`${url}/auth/oauth/token`, 'POST', 'grant_type=refresh_token', { 'content-type': 'application/x-www-form-urlencoded' }))
                .status,
        ).toBe(404);
    });
});

describe('dynamic client registration', () => {
    it('registers a public client and answers 201 with its id', async () => {
        const url = await serve();
        const response = await send(
            `${url}/auth/oauth/register`,
            'POST',
            json({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
            {
                'content-type': 'application/json',
            },
        );

        expect(response.status).toBe(201);
        expect(JSON.parse(response.body)).toMatchObject({ client_name: 'Claude', redirect_uris: [REDIRECT] });
        expect(JSON.parse(response.body).client_id).toMatch(/^dyn/);
    });

    it('refuses bad metadata in the RFC 7591 shape', async () => {
        const url = await serve();
        const response = await send(`${url}/auth/oauth/register`, 'POST', json({ redirect_uris: ['http://evil.example/cb'] }), {
            'content-type': 'application/json',
        });

        expect(response.status).toBe(400);
        expect(JSON.parse(response.body)).toHaveProperty('error');
        expect(JSON.parse(response.body)).toHaveProperty('error_description');
    });
});

describe('the token endpoint', () => {
    it('answers an RFC 6749 error for a code nobody issued, form-encoded, and is never cached', async () => {
        const url = await serve();
        const registered = JSON.parse(
            (
                await send(`${url}/auth/oauth/register`, 'POST', json({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }), {
                    'content-type': 'application/json',
                })
            ).body,
        );
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: 'nope',
            redirect_uri: REDIRECT,
            code_verifier: 'x'.repeat(43),
            client_id: registered.client_id,
        });

        const response = await send(`${url}/auth/oauth/token`, 'POST', body.toString(), { 'content-type': 'application/x-www-form-urlencoded' });

        expect(response.status).toBe(400);
        expect(JSON.parse(response.body)).toMatchObject({ error: 'invalid_grant' });
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it('takes JSON too, and names an unsupported grant', async () => {
        const url = await serve();
        const response = await send(`${url}/auth/oauth/token`, 'POST', json({ grant_type: 'password' }), { 'content-type': 'application/json' });
        expect(JSON.parse(response.body)).toMatchObject({ error: 'unsupported_grant_type' });
    });

    it('reads a client authenticating with HTTP Basic, although the authentication middleware deletes the header', async () => {
        const url = await serve();
        const basic = `Basic ${Buffer.from('unknown-client:secret').toString('base64')}`;
        const body = new URLSearchParams({ grant_type: 'authorization_code', code: 'c', redirect_uri: REDIRECT, code_verifier: 'x'.repeat(43) });

        const response = await send(`${url}/auth/oauth/token`, 'POST', body.toString(), {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: basic,
        });

        // The credential was read, and named a client that does not exist: invalid_client, rather than
        // the invalid_request a request with no client at all would get.
        expect(JSON.parse(response.body)).toMatchObject({ error: 'invalid_client' });
        expect(response.status).toBe(401);
    });
});
