// Auto-generated MCP tools
// generated from [narrations.ck](../../data/contracts/narrations/narrations.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { NarrationsService } from '#src/modules/narrations/narrations.service.js';
import { StationPiece, StationPiecePage, StationPieceQuery, StationSeriesList } from '../modules/narrations/types/narrations.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListSeriesArgs = z.object({});
const ListPiecesArgs = z.object({ query: StationPieceQuery.optional() });
const RenderPieceArgs = z.object({ id: z.string().min(1).max(100) });
const RefreshNarrationsArgs = z.object({});

/**
 * from [narrations.ck](../../data/contracts/narrations/narrations.ck#L20)
 */
@Injectable()
export class ListSeriesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_series',
        description: 'Every series every installed narration plugin offers',
        inputSchema: z.toJSONSchema(ListSeriesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationSeriesList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(NarrationsService).readSeries();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [narrations.ck](../../data/contracts/narrations/narrations.ck#L32)
 */
@Injectable()
export class ListPiecesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_pieces',
        description: "The pieces the station knows about, in their series' own order, with what it has done with each",
        inputSchema: z.toJSONSchema(ListPiecesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationPiecePage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ListPiecesArgs.shape.query.unwrap()) } = await parseAndValidate(args, ListPiecesArgs);
        const result = await container.get(NarrationsService).readPieces(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [narrations.ck](../../data/contracts/narrations/narrations.ck#L48)
 */
@Injectable()
export class RenderPieceMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'render_piece',
        description: 'Has one piece spoken now, rather than waiting for its slot to come near',
        inputSchema: z.toJSONSchema(RenderPieceArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationPiece, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, RenderPieceArgs);
        const result = await container.get(NarrationsService).requestRender(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [narrations.ck](../../data/contracts/narrations/narrations.ck#L65)
 */
@Injectable()
export class RefreshNarrationsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'refresh_narrations',
        description: 'Reads every series again, in the background, rather than waiting for the next scheduled refresh',
        inputSchema: z.toJSONSchema(RefreshNarrationsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        await container.get(NarrationsService).requestRefresh();
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerNarrationsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_series', container.get(ListSeriesMcpTool));
    map.set('list_pieces', container.get(ListPiecesMcpTool));
    map.set('render_piece', container.get(RenderPieceMcpTool));
    map.set('refresh_narrations', container.get(RefreshNarrationsMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerNarrationsMcpToolClasses(registry: Registry): void {
    registry.register(ListSeriesMcpTool).useClass(ListSeriesMcpTool).asSingleton();
    registry.register(ListPiecesMcpTool).useClass(ListPiecesMcpTool).asSingleton();
    registry.register(RenderPieceMcpTool).useClass(RenderPieceMcpTool).asSingleton();
    registry.register(RefreshNarrationsMcpTool).useClass(RefreshNarrationsMcpTool).asSingleton();
}
