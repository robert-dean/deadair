// Auto-generated MCP tools
// generated from [break.kinds.ck](../../data/contracts/director/break.kinds.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { BreakKindsService } from '#src/modules/director/break.kinds.service.js';
import { BreakKindInput, BreakKindList } from '../modules/director/types/break.kinds.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListBreakKindsArgs = z.object({});
const CreateBreakKindArgs = z.object({ body: BreakKindInput });
const UpdateBreakKindArgs = z.object({ id: z.string().min(1).max(100), body: BreakKindInput });
const DeleteBreakKindArgs = z.object({ id: z.string().min(1).max(100) });

/**
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `GET /breaks/kinds`
 */
@Injectable()
export class ListBreakKindsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_break_kinds',
        description: 'Every kind of break you have written, switched on or not, in your own order',
        inputSchema: z.toJSONSchema(ListBreakKindsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BreakKindList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(BreakKindsService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `POST /breaks/kinds`
 */
@Injectable()
export class CreateBreakKindMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_break_kind',
        description: 'Writes a new kind of break. Nothing airs it until it is switched on and a band on the format clock names it',
        inputSchema: z.toJSONSchema(CreateBreakKindArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BreakKindList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreateBreakKindArgs);
        const result = await container.get(BreakKindsService).create(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `PUT /breaks/kinds/{id}`
 */
@Injectable()
export class UpdateBreakKindMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_break_kind',
        description: 'Rewrites one kind of break. Its key cannot change. A break already written keeps the words it was given',
        inputSchema: z.toJSONSchema(UpdateBreakKindArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BreakKindList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdateBreakKindArgs);
        const result = await container.get(BreakKindsService).update(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `DELETE /breaks/kinds/{id}`
 */
@Injectable()
export class DeleteBreakKindMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_break_kind',
        description: 'Removes a kind of break. Refused while a band on the format clock still names it',
        inputSchema: z.toJSONSchema(DeleteBreakKindArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BreakKindList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteBreakKindArgs);
        const result = await container.get(BreakKindsService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerBreakKindsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_break_kinds', container.get(ListBreakKindsMcpTool));
    map.set('create_break_kind', container.get(CreateBreakKindMcpTool));
    map.set('update_break_kind', container.get(UpdateBreakKindMcpTool));
    map.set('delete_break_kind', container.get(DeleteBreakKindMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerBreakKindsMcpToolClasses(registry: Registry): void {
    registry.register(ListBreakKindsMcpTool).useClass(ListBreakKindsMcpTool).asSingleton();
    registry.register(CreateBreakKindMcpTool).useClass(CreateBreakKindMcpTool).asSingleton();
    registry.register(UpdateBreakKindMcpTool).useClass(UpdateBreakKindMcpTool).asSingleton();
    registry.register(DeleteBreakKindMcpTool).useClass(DeleteBreakKindMcpTool).asSingleton();
}
