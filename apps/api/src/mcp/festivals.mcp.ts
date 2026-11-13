// Auto-generated MCP tools
// generated from [festivals.ck](../../data/contracts/schedule/festivals.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { FestivalService } from '#src/modules/schedule/festival.service.js';
import { FestivalInput, FestivalList } from '../modules/schedule/types/festivals.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListFestivalsArgs = z.object({});
const AddAFestivalArgs = z.object({ body: FestivalInput });
const ChangeAFestivalArgs = z.object({ id: z.uuid(), body: FestivalInput });
const RemoveAFestivalArgs = z.object({ id: z.uuid() });

/**
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `GET /festivals`
 */
@Injectable()
export class ListFestivalsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_festivals',
        description: 'Every festival on this station, soonest first, each saying whether it is still to come, on now or over',
        inputSchema: z.toJSONSchema(ListFestivalsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(FestivalList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(FestivalService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `POST /festivals`
 */
@Injectable()
export class AddAFestivalMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'add_a_festival',
        description: 'Adds a festival. A show names it from the schedule, and nothing is said about it until one does',
        inputSchema: z.toJSONSchema(AddAFestivalArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(FestivalList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, AddAFestivalArgs);
        const result = await container.get(FestivalService).add(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `PUT /festivals/{id}`
 */
@Injectable()
export class ChangeAFestivalMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'change_a_festival',
        description:
            'Replaces a festival and its whole bill. A show naming it plays and talks about the new one from its next refill and its next break',
        inputSchema: z.toJSONSchema(ChangeAFestivalArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(FestivalList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, ChangeAFestivalArgs);
        const result = await container.get(FestivalService).change(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `DELETE /festivals/{id}`
 */
@Injectable()
export class RemoveAFestivalMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'remove_a_festival',
        description: 'Removes a festival. A show that named it carries on as the show it otherwise is',
        inputSchema: z.toJSONSchema(RemoveAFestivalArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(FestivalList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, RemoveAFestivalArgs);
        const result = await container.get(FestivalService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerFestivalsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_festivals', container.get(ListFestivalsMcpTool));
    map.set('add_a_festival', container.get(AddAFestivalMcpTool));
    map.set('change_a_festival', container.get(ChangeAFestivalMcpTool));
    map.set('remove_a_festival', container.get(RemoveAFestivalMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerFestivalsMcpToolClasses(registry: Registry): void {
    registry.register(ListFestivalsMcpTool).useClass(ListFestivalsMcpTool).asSingleton();
    registry.register(AddAFestivalMcpTool).useClass(AddAFestivalMcpTool).asSingleton();
    registry.register(ChangeAFestivalMcpTool).useClass(ChangeAFestivalMcpTool).asSingleton();
    registry.register(RemoveAFestivalMcpTool).useClass(RemoveAFestivalMcpTool).asSingleton();
}
