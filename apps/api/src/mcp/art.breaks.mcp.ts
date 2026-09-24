// Auto-generated MCP tools
// generated from [art.breaks.ck](../../data/contracts/art/art.breaks.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { BreakArtworkService } from '#src/modules/art/break.artwork.service.js';
import { BreakArtworkList } from '../modules/art/types/art.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListBreakArtworkArgs = z.object({});
const RevertBreakArtworkArgs = z.object({ kind: z.string().min(1).max(64) });

/**
 * from [art.breaks.ck](../../data/contracts/art/art.breaks.ck#L28)
 */
@Injectable()
export class ListBreakArtworkMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_break_artwork',
        description: 'Every kind the station holds a picture for',
        inputSchema: z.toJSONSchema(ListBreakArtworkArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BreakArtworkList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(BreakArtworkService).listBreaks();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [art.breaks.ck](../../data/contracts/art/art.breaks.ck#L70)
 */
@Injectable()
export class RevertBreakArtworkMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'revert_break_artwork',
        description:
            'Puts the picture this repository ships back. The shipped file is read at this moment rather than copied at install, so an upgrade that improved it is what comes back',
        inputSchema: z.toJSONSchema(RevertBreakArtworkArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BreakArtworkList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { kind } = await parseAndValidate(args, RevertBreakArtworkArgs);
        const result = await container.get(BreakArtworkService).revertBreak(kind);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerArtBreaksMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_break_artwork', container.get(ListBreakArtworkMcpTool));
    map.set('revert_break_artwork', container.get(RevertBreakArtworkMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerArtBreaksMcpToolClasses(registry: Registry): void {
    registry.register(ListBreakArtworkMcpTool).useClass(ListBreakArtworkMcpTool).asSingleton();
    registry.register(RevertBreakArtworkMcpTool).useClass(RevertBreakArtworkMcpTool).asSingleton();
}
