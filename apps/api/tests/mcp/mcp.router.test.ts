// The MCP endpoint, over a real socket, with the real MCP dispatcher and the real generated tools.
// What it proves is the way in (without a token, a 401 naming where to find out how to get one; with a
// console session, refused; with an app's grant for this resource, `initialize`), and then that every
// tool acts as whoever called it: the tools are built once, and each request brings its own container
// holding its own actor, as the station's authorization middleware does.

import { AddressInfo } from 'node:net';
import { request, Server } from 'node:http';
import Koa from 'koa';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { errorMiddleware, JsonParser, JsonParserOptions, ServerKitBodyParser, ServerKitParserMappings } from '@maroonedsoftware/koa';
import type { Logger } from '@maroonedsoftware/logger';
import {
    explainToolErrors,
    McpDispatcher,
    McpResourceHandlerMap,
    McpServerFactory,
    McpSessionRegistry,
    McpToolHandlerMap,
    type McpConfig,
} from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';

import { McpRouter } from '../../src/mcp/mcp.router.js';
import { GetNowPlayingMcpTool } from '../../src/mcp/nowplaying.mcp.js';
import { GetPlayoutStatusMcpTool } from '../../src/mcp/playout.mcp.js';
import { WHOAMI_TOOL, WhoAmITool } from '../../src/mcp/whoami.tool.js';
import { AuthorizationContext } from '../../src/modules/permissions/authorization.context.js';
import { NowPlayingService } from '../../src/modules/nowplaying/nowplaying.service.js';
import { PlayoutService } from '../../src/modules/playout/playout.service.js';
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

const sessionWith = (claims: Record<string, unknown>, subject = 'actor'): AuthenticationSession => ({
    sessionToken: 's',
    subject,
    issuedAt: DateTime.utc(),
    expiresAt: DateTime.utc().plus({ hours: 1 }),
    lastAccessedAt: DateTime.utc(),
    factors: [],
    claims,
});

// Who each subject is on the station, standing in for the tuples the authorization middleware reads.
const ROLES: Record<string, string[]> = { actor: ['listener'], listener: ['listener'], stranger: [] };
const NOW_PLAYING = { onAir: false };
const STATUS = { playing: false, queue: [] };

async function serve(session: AuthenticationSession, enabled = 'true'): Promise<string> {
    const config = settingsConfig({ APP_BASE_URL: ORIGIN, 'oauth.enabled': enabled, 'station.timezone': 'Europe/London' }).config;
    const mcpConfig: McpConfig = { serverName: 'deadair', version: 'test', sessionMode: 'stateless' };
    // Built once, as `McpModule` builds them: nothing about a caller is in the tools themselves.
    const tools = explainToolErrors(
        new McpToolHandlerMap([
            ['get_now_playing', new GetNowPlayingMcpTool()],
            ['get_playout_status', new GetPlayoutStatusMcpTool()],
            [WHOAMI_TOOL, new WhoAmITool(config)],
        ]),
    );
    const factory = new McpServerFactory(tools, new McpResourceHandlerMap(), mcpConfig, logger);
    const dispatcher = new McpDispatcher(factory, new McpSessionRegistry(factory, logger), mcpConfig, logger);
    const grant = new OAuthGrantPolicy(config);
    const policiesFor = (roles: string[]) => ({
        assert: async (name: string, context: { session: AuthenticationSession }) => {
            if (name === 'oauth.grant') {
                const result = await grant.evaluate(context);
                if (!result.allowed) throw httpError(403);
                return;
            }
            if (name === 'platform.view' && roles.length > 0) return;
            throw httpError(403);
        },
    });
    const mappings = new ServerKitParserMappings();
    mappings.set('json', new JsonParser(new JsonParserOptions()));
    const bodyParser = new ServerKitBodyParser(mappings);

    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(oauthChallengeMiddleware(config) as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        Object.assign(ctx, { authenticationSession: session, logger, requestId: 'req-1' });
        // One container per request, holding this caller's actor: what `serverKitContextMiddleware`
        // and the authorization middleware give every real request.
        const roles = ROLES[session.subject] ?? [];
        const authorization = {
            requireUser: () => ({
                kind: 'user',
                actorId: session.subject,
                platformRoles: new Set(roles),
                grant: { id: 'g1', clientId: 'dyn_1', grants: new Set(['view']) },
            }),
        };
        const scoped = new Map<unknown, unknown>([
            [ServerKitBodyParser, bodyParser],
            [McpDispatcher, dispatcher],
            [PolicyService, policiesFor(roles)],
            [AuthorizationContext, authorization],
            [NowPlayingService, { getNowPlaying: async () => NOW_PLAYING }],
            [PlayoutService, { getStatus: async () => STATUS }],
        ]);
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = { get: (token: unknown) => scoped.get(token) };
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

async function call(url: string, name: string) {
    const response = await post(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: {} } });
    expect(response.status).toBe(200);
    return JSON.parse(response.body);
}

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

    it('lists the flagged operations and whoami, each read-only', async () => {
        const response = await post(await serve(GRANTED), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        const tools = JSON.parse(response.body).result.tools as Array<{ name: string; annotations: Record<string, boolean> }>;

        expect(tools.map(tool => tool.name).sort()).toEqual(['get_now_playing', 'get_playout_status', 'whoami']);
        for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    });

    it('answers whoami as the caller, not as the actor the tools were built under', async () => {
        const listener = sessionWith(
            { actorType: 'user', oauth: { clientId: 'dyn_1', clientName: 'Claude', resource: RESOURCE, scope: ['mcp'], grantId: 'g1' } },
            'listener',
        );
        const result = (await call(await serve(listener), WHOAMI_TOOL)).result;

        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toMatchObject({
            actorId: 'listener',
            roles: ['listener'],
            app: { clientId: 'dyn_1', name: 'Claude' },
            scopes: ['view'],
            station: { timezone: 'Europe/London' },
        });
    });

    it('runs a generated tool with the service resolved from the request', async () => {
        const result = (await call(await serve(GRANTED), 'get_playout_status')).result;
        expect(result.structuredContent).toEqual(STATUS);
    });

    it('lets anybody holding a grant ask what is playing, since the route is public', async () => {
        const stranger = sessionWith(GRANTED.claims, 'stranger');
        const result = (await call(await serve(stranger), 'get_now_playing')).result;
        expect(result.structuredContent).toEqual(NOW_PLAYING);
    });

    it('tells the model a caller without the role is not allowed, rather than failing the protocol', async () => {
        const stranger = sessionWith(GRANTED.claims, 'stranger');
        const parsed = await call(await serve(stranger), 'get_playout_status');

        expect(parsed.error).toBeUndefined();
        expect(parsed.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'This caller is not allowed to do that.' }] });
    });

    it('answers a notification with 202 and nothing', async () => {
        const response = await post(await serve(GRANTED), { jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(response.status).toBe(202);
        expect(response.body).toBe('');
    });
});
