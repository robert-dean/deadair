// Auto-generated MCP tools
// generated from [activity.ck](../../data/contracts/activity/activity.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ActivityService } from '#src/modules/activity/activity.service.js';
import { ActivityPage, ActivityQuery } from '../modules/activity/types/activity.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadActivityArgs = z.object({ query: ActivityQuery.optional() });

/**
 * from [activity.ck](../../data/contracts/activity/activity.ck#L25)
 */
@Injectable()
export class ReadActivityMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_activity',
        description: 'The feed, newest first, one page at a time',
        inputSchema: z.toJSONSchema(ReadActivityArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ActivityPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ReadActivityArgs.shape.query.unwrap()) } = await parseAndValidate(args, ReadActivityArgs);
        const result = await container.get(ActivityService).readActivity(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerActivityMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_activity', container.get(ReadActivityMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerActivityMcpToolClasses(registry: Registry): void {
    registry.register(ReadActivityMcpTool).useClass(ReadActivityMcpTool).asSingleton();
}
