// Auto-generated MCP tools
// generated from [schedule.ck](../../data/contracts/schedule/schedule.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ScheduleService } from '#src/modules/schedule/schedule.service.js';
import {
    ScheduleNow,
    ScheduleSlotInput,
    ScheduleSlotList,
    ScheduleTimetable,
    ScheduleTimetableQuery,
} from '../modules/schedule/types/schedule.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListScheduleArgs = z.object({});
const CreateScheduleSlotArgs = z.object({ body: ScheduleSlotInput });
const ReadCurrentSlotArgs = z.object({});
const ReadTimetableArgs = z.object({ query: ScheduleTimetableQuery.optional() });
const UpdateScheduleSlotArgs = z.object({ id: z.string().min(1).max(100), body: ScheduleSlotInput });
const DeleteScheduleSlotArgs = z.object({ id: z.string().min(1).max(100) });

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck#L27)
 */
@Injectable()
export class ListScheduleMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_schedule',
        description: "Every slot in this station's schedule, earliest in the day first",
        inputSchema: z.toJSONSchema(ListScheduleArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScheduleSlotList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(ScheduleService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck#L40)
 */
@Injectable()
export class CreateScheduleSlotMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_schedule_slot',
        description: 'Adds a slot. The station does not change over until its start time comes round',
        inputSchema: z.toJSONSchema(CreateScheduleSlotArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScheduleSlotList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreateScheduleSlotArgs);
        const result = await container.get(ScheduleService).create(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck#L59)
 */
@Injectable()
export class ReadCurrentSlotMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_current_slot',
        description: 'Which slot the clock says should be on, and which one the station is actually airing',
        inputSchema: z.toJSONSchema(ReadCurrentSlotArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScheduleNow, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(ScheduleService).current();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck#L81)
 */
@Injectable()
export class ReadTimetableMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_timetable',
        description: "The station's day as blocks, contiguous and gapless, for drawing",
        inputSchema: z.toJSONSchema(ReadTimetableArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScheduleTimetable, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ReadTimetableArgs.shape.query.unwrap()) } = await parseAndValidate(args, ReadTimetableArgs);
        const result = await container.get(ScheduleService).timetable(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck#L101)
 */
@Injectable()
export class UpdateScheduleSlotMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_schedule_slot',
        description: 'Rewrites a slot. Takes effect at its next boundary rather than immediately',
        inputSchema: z.toJSONSchema(UpdateScheduleSlotArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScheduleSlotList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdateScheduleSlotArgs);
        const result = await container.get(ScheduleService).update(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck#L113)
 */
@Injectable()
export class DeleteScheduleSlotMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_schedule_slot',
        description: 'Removes a slot. Whatever is on air stays on until the next slot begins',
        inputSchema: z.toJSONSchema(DeleteScheduleSlotArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScheduleSlotList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteScheduleSlotArgs);
        const result = await container.get(ScheduleService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerScheduleMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_schedule', container.get(ListScheduleMcpTool));
    map.set('create_schedule_slot', container.get(CreateScheduleSlotMcpTool));
    map.set('read_current_slot', container.get(ReadCurrentSlotMcpTool));
    map.set('read_timetable', container.get(ReadTimetableMcpTool));
    map.set('update_schedule_slot', container.get(UpdateScheduleSlotMcpTool));
    map.set('delete_schedule_slot', container.get(DeleteScheduleSlotMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerScheduleMcpToolClasses(registry: Registry): void {
    registry.register(ListScheduleMcpTool).useClass(ListScheduleMcpTool).asSingleton();
    registry.register(CreateScheduleSlotMcpTool).useClass(CreateScheduleSlotMcpTool).asSingleton();
    registry.register(ReadCurrentSlotMcpTool).useClass(ReadCurrentSlotMcpTool).asSingleton();
    registry.register(ReadTimetableMcpTool).useClass(ReadTimetableMcpTool).asSingleton();
    registry.register(UpdateScheduleSlotMcpTool).useClass(UpdateScheduleSlotMcpTool).asSingleton();
    registry.register(DeleteScheduleSlotMcpTool).useClass(DeleteScheduleSlotMcpTool).asSingleton();
}
