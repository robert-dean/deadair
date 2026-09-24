// Auto-generated MCP tools
// generated from [productions.ck](../../data/contracts/productions/productions.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ProductionsService } from '#src/modules/productions/productions.service.js';
import { Production, ProductionList, ProductionRequest } from '../modules/productions/types/productions.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListProductionsArgs = z.object({});
const RequestProductionArgs = z.object({ body: ProductionRequest });
const CancelProductionArgs = z.object({ id: z.string().min(1).max(100) });

/**
 * from [productions.ck](../../data/contracts/productions/productions.ck#L29)
 */
@Injectable()
export class ListProductionsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_productions',
        description: 'Everything the station has made or is making, newest first',
        inputSchema: z.toJSONSchema(ListProductionsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ProductionList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(ProductionsService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [productions.ck](../../data/contracts/productions/productions.ck#L42)
 */
@Injectable()
export class RequestProductionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'request_production',
        description: 'Asks the station to make one. It is queued, not started',
        inputSchema: z.toJSONSchema(RequestProductionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Production, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, RequestProductionArgs);
        const result = await container.get(ProductionsService).request(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [productions.ck](../../data/contracts/productions/productions.ck#L67)
 */
@Injectable()
export class CancelProductionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'cancel_production',
        description: 'Stops a production being made, for good',
        inputSchema: z.toJSONSchema(CancelProductionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Production, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, CancelProductionArgs);
        const result = await container.get(ProductionsService).cancel(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerProductionsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_productions', container.get(ListProductionsMcpTool));
    map.set('request_production', container.get(RequestProductionMcpTool));
    map.set('cancel_production', container.get(CancelProductionMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerProductionsMcpToolClasses(registry: Registry): void {
    registry.register(ListProductionsMcpTool).useClass(ListProductionsMcpTool).asSingleton();
    registry.register(RequestProductionMcpTool).useClass(RequestProductionMcpTool).asSingleton();
    registry.register(CancelProductionMcpTool).useClass(CancelProductionMcpTool).asSingleton();
}
