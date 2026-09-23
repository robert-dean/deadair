// The MCP endpoint, over a real socket, with the real MCP dispatcher and no tools. What it proves is
// the way in: without a token, a 401 naming where to find out how to get one; with a console
// session, refused; with an app's grant for this resource, `initialize` and an empty `tools/list`.

import { AddressInfo } from 'node:net';
import { request, Server } from 'node:http';
import Koa from 'koa';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { errorMiddleware, JsonParser, JsonParserOptions, ServerKitBodyParser, ServerKitParserMappings } from '@maroonedsoftware/koa';
import type { Logger } from '@maroonedsoftware/logger';
import { McpDispatcher, McpResourceHandlerMap, McpServerFactory, McpSessionRegistry, McpToolHandlerMap, type McpConfig } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';

import { McpRouter } from '../../src/routes/mcp.router.js';
import { OAuthGrantPolicy } from '../../src/modules/oauth/oauth.grant.policy.js';
import { oauthChallengeMiddleware } from '../../src/server/middleware/oauth.challenge.middleware.js';
import { settingsConfig } from '../utils/settings.config.js';

const LOOPBACK = '127.0.0.1';
const ORIGIN = 'https://radio.example.com';
const RESOURCE = `${ORIGIN}/api/mcp`;
let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
        return logger;
    },
} as unknown as Logger;

const sessionWith = (claims: Record<string, unknown>): AuthenticationSession => ({
    sessionToken: 's',
    subject: 'actor',
    issuedAt: DateTime.utc(),
    expiresAt: DateTime.utc().plus({ hours: 1 }),
    lastAccessedAt: DateTime.utc(),
    factors: [],
    claims,
});

async function serve(session: AuthenticationSession, enabled = 'true'): Promise<string> {
    const config = settingsConfig({ APP_BASE_URL: ORIGIN, 'oauth.enabled': enabled }).config;
    const mcpConfig: McpConfig = { serverName: 'deadair', version: 'test', sessionMode: 'stateless' };
    const factory = new McpServerFactory(new McpToolHandlerMap(), new McpResourceHandlerMap(), mcpConfig, logger);
    const dispatcher = new McpDispatcher(factory, new McpSessionRegistry(factory, logger), mcpConfig, logger);
    const grant = new OAuthGrantPolicy(config);
    const policies = {
        assert: async (_name: string, context: { session: AuthenticationSession }) => {
            const result = await grant.evaluate(context);
            if (!result.allowed) throw httpError(403);
        },
    };
    const mappings = new ServerKitParserMappings();
    mappings.set('json', new JsonParser(new JsonParserOptions()));
    const bodyParser = new ServerKitBodyParser(mappings);

    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(oauthChallengeMiddleware(config) as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        Object.assign(ctx, { authenticationSession: session, logger, requestId: 'req-1' });
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) =>
                token === ServerKitBodyParser ? bodyParser : token === McpDispatcher ? dispatcher : token === PolicyService ? policies : undefined,
        };
        await next();
    });
    app.use(McpRouter.routes() as unknown as Koa.Middleware);
    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}/mcp`;
}

function post(url: string, body: unknown) {
    return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify(body));
        const req = request(
            url,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json, text/event-stream',
                    'content-length': String(payload.byteLength),
                },
            },
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

const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};
const GRANTED = sessionWith({ actorType: 'user', oauth: { clientId: 'dyn_1', resource: RESOURCE, scope: ['mcp'], grantId: 'g1' } });

describe('POST /mcp', () => {
    it('answers a caller with no token 401, naming where to find out how to get one', async () => {
        const response = await post(await serve(invalidAuthenticationSession), INITIALIZE);

        expect(response.status).toBe(401);
        expect(response.headers['www-authenticate']).toBe(
            `Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
        );
    });

    it('refuses a session that is not an app grant for this resource', async () => {
        expect((await post(await serve(sessionWith({ actorType: 'user' })), INITIALIZE)).status).toBe(403);
        const elsewhere = sessionWith({ actorType: 'user', oauth: { clientId: 'x', resource: 'https://other.example/api/mcp', scope: [] } });
        expect((await post(await serve(elsewhere), INITIALIZE)).status).toBe(403);
    });

    it('refuses even a grant while OAuth is switched off', async () => {
        expect((await post(await serve(GRANTED, 'false'), INITIALIZE)).status).toBe(403);
    });

    it('initializes for an app holding a grant for this resource', async () => {
        const response = await post(await serve(GRANTED), INITIALIZE);

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'deadair' } } });
    });

    it('lists no tools yet', async () => {
        const response = await post(await serve(GRANTED), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        const parsed = JSON.parse(response.body);
        expect(parsed.result?.tools ?? []).toEqual([]);
    });

    it('answers a notification with 202 and nothing', async () => {
        const response = await post(await serve(GRANTED), { jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(response.status).toBe(202);
        expect(response.body).toBe('');
    });
});
