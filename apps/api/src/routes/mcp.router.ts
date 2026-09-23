import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { McpDispatcher, createMcpRequestContext } from '@maroonedsoftware/mcp';

/**
 * The MCP endpoint, `POST /api/mcp`, over Streamable HTTP in stateless mode.
 *
 * Hand-written for now in the shape ContractKit's `mcp` output emits, and replaced by that file when
 * the first operation is flagged `mcp: true`. The one thing it must keep is the guard: `oauth.grant`,
 * a session an app was granted through OAuth for this resource. Without a token the policy throws a
 * 401, and `oauth.challenge.middleware` adds the `resource_metadata` an MCP client needs to find out
 * how to get one.
 */
export const McpRouter = ServerKitRouter();

McpRouter.post('/mcp', requirePolicy({ policy: 'oauth.grant' }), bodyParserMiddleware(['json']), async ctx => {
    const dispatcher = ctx.container.get(McpDispatcher);
    const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger, authenticationSession: ctx.authenticationSession });
    const response = await dispatcher.dispatch(ctx.parsedBody as JSONRPCMessage, context);
    if (response === undefined) {
        // A notification: nothing to answer, as the transport says. An empty body set explicitly,
        // because Koa otherwise writes the status text, and `null` would turn this into a 204.
        ctx.status = 202;
        ctx.body = '';
        return;
    }
    ctx.type = 'application/json';
    ctx.body = response;
});

// A stateless server keeps no stream for a client to listen on, which Streamable HTTP answers with 405.
McpRouter.get('/mcp', async ctx => {
    ctx.set('Allow', 'POST');
    ctx.status = 405;
});
