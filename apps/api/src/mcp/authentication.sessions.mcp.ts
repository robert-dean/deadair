// Auto-generated MCP tools
// generated from [authentication.sessions.ck](../../data/contracts/authentication/authentication.sessions.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { SessionsService } from '#src/modules/authentication/sessions.service.js';
import { AuthSession } from '../modules/authentication/types/authentication.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadSessionArgs = z.object({});

/**
 * from [authentication.sessions.ck](../../data/contracts/authentication/authentication.sessions.ck#L32)
 */
@Injectable()
export class ReadSessionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_session',
        description: 'Who the caller is and which platform roles they hold',
        inputSchema: z.toJSONSchema(ReadSessionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(AuthSession, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(SessionsService).readCurrentSession();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerAuthenticationSessionsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_session', container.get(ReadSessionMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerAuthenticationSessionsMcpToolClasses(registry: Registry): void {
    registry.register(ReadSessionMcpTool).useClass(ReadSessionMcpTool).asSingleton();
}
