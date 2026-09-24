// Auto-generated MCP tools
// generated from [playout.ck](../../data/contracts/playout/playout.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { PlayoutService } from '#src/modules/playout/playout.service.js';
import { PlayoutStatus } from '../modules/playout/types/playout.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetPlayoutStatusArgs = z.object({});

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L17)
 */
@Injectable()
export class GetPlayoutStatusMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_playout_status',
        description:
            'What the station is playing and the records queued behind it, in running order. Use this when asked what is coming up; get_now_playing is enough for what is on air.',
        inputSchema: z.toJSONSchema(GetPlayoutStatusArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PlayoutService).getStatus();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the tool map. */
export function registerPlayoutMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_playout_status', container.get(GetPlayoutStatusMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerPlayoutMcpToolClasses(registry: Registry): void {
    registry.register(GetPlayoutStatusMcpTool).useClass(GetPlayoutStatusMcpTool).asSingleton();
}
