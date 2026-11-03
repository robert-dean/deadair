// Auto-generated MCP tools
// generated from [occasions.ck](../../data/contracts/schedule/occasions.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { OccasionService } from '#src/modules/schedule/occasion.service.js';
import { OccasionInput, OccasionList, OccasionOrder } from '../modules/schedule/types/occasions.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListOccasionsArgs = z.object({});
const AddAnOccasionArgs = z.object({ body: OccasionInput });
const ReorderOccasionsArgs = z.object({ body: OccasionOrder });
const ChangeAnOccasionArgs = z.object({ id: z.uuid(), body: OccasionInput });
const RemoveAnOccasionArgs = z.object({ id: z.uuid() });

/**
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `GET /occasions`
 */
@Injectable()
export class ListOccasionsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_occasions',
        description: 'Every occasion on this station, in the order a date is matched against them, each saying when it next falls',
        inputSchema: z.toJSONSchema(ListOccasionsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OccasionList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(OccasionService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `POST /occasions`
 */
@Injectable()
export class AddAnOccasionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'add_an_occasion',
        description: 'Adds an occasion at the end of the list. Presenters hear of it from the next break written for its day',
        inputSchema: z.toJSONSchema(AddAnOccasionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OccasionList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, AddAnOccasionArgs);
        const result = await container.get(OccasionService).add(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `PUT /occasions/order`
 */
@Injectable()
export class ReorderOccasionsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'reorder_occasions',
        description: 'Puts the list in a new order, which decides who wins when two fall on one date',
        inputSchema: z.toJSONSchema(ReorderOccasionsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OccasionList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, ReorderOccasionsArgs);
        const result = await container.get(OccasionService).reorder(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `PUT /occasions/{id}`
 */
@Injectable()
export class ChangeAnOccasionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'change_an_occasion',
        description: 'Replaces an occasion, keeping its place in the list',
        inputSchema: z.toJSONSchema(ChangeAnOccasionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OccasionList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, ChangeAnOccasionArgs);
        const result = await container.get(OccasionService).change(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `DELETE /occasions/{id}`
 */
@Injectable()
export class RemoveAnOccasionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'remove_an_occasion',
        description: 'Removes an occasion',
        inputSchema: z.toJSONSchema(RemoveAnOccasionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OccasionList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, RemoveAnOccasionArgs);
        const result = await container.get(OccasionService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerOccasionsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_occasions', container.get(ListOccasionsMcpTool));
    map.set('add_an_occasion', container.get(AddAnOccasionMcpTool));
    map.set('reorder_occasions', container.get(ReorderOccasionsMcpTool));
    map.set('change_an_occasion', container.get(ChangeAnOccasionMcpTool));
    map.set('remove_an_occasion', container.get(RemoveAnOccasionMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerOccasionsMcpToolClasses(registry: Registry): void {
    registry.register(ListOccasionsMcpTool).useClass(ListOccasionsMcpTool).asSingleton();
    registry.register(AddAnOccasionMcpTool).useClass(AddAnOccasionMcpTool).asSingleton();
    registry.register(ReorderOccasionsMcpTool).useClass(ReorderOccasionsMcpTool).asSingleton();
    registry.register(ChangeAnOccasionMcpTool).useClass(ChangeAnOccasionMcpTool).asSingleton();
    registry.register(RemoveAnOccasionMcpTool).useClass(RemoveAnOccasionMcpTool).asSingleton();
}
