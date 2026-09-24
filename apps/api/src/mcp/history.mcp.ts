// Auto-generated MCP tools
// generated from [history.ck](../../data/contracts/history/history.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { HistoryService } from '#src/modules/history/history.service.js';
import { HistoryPage, HistoryQuery } from '../modules/history/types/history.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadHistoryArgs = z.object({ query: HistoryQuery.optional() });

/**
 * from [history.ck](../../data/contracts/history/history.ck#L23)
 */
@Injectable()
export class ReadHistoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_history',
        description: 'What the station played, newest first, one page at a time',
        inputSchema: z.toJSONSchema(ReadHistoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(HistoryPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ReadHistoryArgs.shape.query.unwrap()) } = await parseAndValidate(args, ReadHistoryArgs);
        const result = await container.get(HistoryService).readHistory(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerHistoryMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_history', container.get(ReadHistoryMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerHistoryMcpToolClasses(registry: Registry): void {
    registry.register(ReadHistoryMcpTool).useClass(ReadHistoryMcpTool).asSingleton();
}
