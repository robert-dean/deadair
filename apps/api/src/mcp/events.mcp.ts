// Auto-generated MCP tools
// generated from [events.ck](../../data/contracts/events/events.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { EventDestinationsService } from '#src/modules/events/event.destinations.service.js';
import {
    EventDeliveryList,
    EventDestination,
    EventDestinationList,
    EventDestinationUpdate,
    EventTestResult,
    EventTypeList,
} from '../modules/events/types/events.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListEventTypesArgs = z.object({});
const ListEventDestinationsArgs = z.object({});
const UpdateEventDestinationArgs = z.object({ id: z.uuid(), body: EventDestinationUpdate });
const DeleteEventDestinationArgs = z.object({ id: z.uuid() });
const TestEventDestinationArgs = z.object({ id: z.uuid() });
const ListEventDeliveriesArgs = z.object({ id: z.uuid() });

/**
 * from [events.ck](../../data/contracts/events/events.ck) `GET /events/types`
 */
@Injectable()
export class ListEventTypesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_event_types',
        description: 'Every kind of event the station sends, each with an example of what a destination receives',
        inputSchema: z.toJSONSchema(ListEventTypesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(EventTypeList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(EventDestinationsService).listTypes();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [events.ck](../../data/contracts/events/events.ck) `GET /events/destinations`
 */
@Injectable()
export class ListEventDestinationsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_event_destinations',
        description: 'Every event destination, oldest first',
        inputSchema: z.toJSONSchema(ListEventDestinationsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(EventDestinationList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(EventDestinationsService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [events.ck](../../data/contracts/events/events.ck) `PATCH /events/destinations/{id}`
 */
@Injectable()
export class UpdateEventDestinationMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_event_destination',
        description: "Change an event destination's name, address, or whether it is on",
        inputSchema: z.toJSONSchema(UpdateEventDestinationArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(EventDestination, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdateEventDestinationArgs);
        const result = await container.get(EventDestinationsService).update(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [events.ck](../../data/contracts/events/events.ck) `DELETE /events/destinations/{id}`
 */
@Injectable()
export class DeleteEventDestinationMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_event_destination',
        description: 'Remove an event destination and its delivery log',
        inputSchema: z.toJSONSchema(DeleteEventDestinationArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteEventDestinationArgs);
        await container.get(EventDestinationsService).remove(id);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [events.ck](../../data/contracts/events/events.ck) `POST /events/destinations/{id}/test`
 */
@Injectable()
export class TestEventDestinationMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'test_event_destination',
        description: 'Send a destination a test event now, and say what it answered. Sent even when the destination is off',
        inputSchema: z.toJSONSchema(TestEventDestinationArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(EventTestResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, TestEventDestinationArgs);
        const result = await container.get(EventDestinationsService).test(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [events.ck](../../data/contracts/events/events.ck) `GET /events/destinations/{id}/deliveries`
 */
@Injectable()
export class ListEventDeliveriesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_event_deliveries',
        description: "A destination's latest delivery attempts, newest first",
        inputSchema: z.toJSONSchema(ListEventDeliveriesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(EventDeliveryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, ListEventDeliveriesArgs);
        const result = await container.get(EventDestinationsService).listDeliveries(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerEventsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_event_types', container.get(ListEventTypesMcpTool));
    map.set('list_event_destinations', container.get(ListEventDestinationsMcpTool));
    map.set('update_event_destination', container.get(UpdateEventDestinationMcpTool));
    map.set('delete_event_destination', container.get(DeleteEventDestinationMcpTool));
    map.set('test_event_destination', container.get(TestEventDestinationMcpTool));
    map.set('list_event_deliveries', container.get(ListEventDeliveriesMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerEventsMcpToolClasses(registry: Registry): void {
    registry.register(ListEventTypesMcpTool).useClass(ListEventTypesMcpTool).asSingleton();
    registry.register(ListEventDestinationsMcpTool).useClass(ListEventDestinationsMcpTool).asSingleton();
    registry.register(UpdateEventDestinationMcpTool).useClass(UpdateEventDestinationMcpTool).asSingleton();
    registry.register(DeleteEventDestinationMcpTool).useClass(DeleteEventDestinationMcpTool).asSingleton();
    registry.register(TestEventDestinationMcpTool).useClass(TestEventDestinationMcpTool).asSingleton();
    registry.register(ListEventDeliveriesMcpTool).useClass(ListEventDeliveriesMcpTool).asSingleton();
}
