// Auto-generated MCP tools
// generated from [schedule.ck](../../data/contracts/schedule/schedule.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ScheduleService } from '#src/modules/schedule/schedule.service.js';
import { SlotAirService } from '#src/modules/director/slot.air.service.js';
import { SlotPlaylistService } from '#src/modules/director/slot.playlist.service.js';
import {
    ScheduleNow,
    ScheduleSlotApplied,
    ScheduleSlotInput,
    ScheduleSlotList,
    ScheduleTimetable,
    ScheduleTimetableQuery,
    SlotPlaylistPosition,
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
const ApplyScheduleSlotToAirArgs = z.object({ id: z.string().min(1).max(100) });
const ReadSlotPlaylistPositionArgs = z.object({ id: z.string().min(1).max(100) });
const RestartSlotPlaylistArgs = z.object({ id: z.string().min(1).max(100) });

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule`
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `POST /schedule`
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule/current`
 */
@Injectable()
export class ReadCurrentSlotMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_current_slot',
        description:
            'Which schedule slot the clock says should be on now, and which one the station is actually airing, when the two differ. Use it for questions like what show is on.',
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule/timetable`
 */
@Injectable()
export class ReadTimetableMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_timetable',
        description: "The station's day as contiguous blocks of programmes, for questions like what is on tonight or when a show starts.",
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `PUT /schedule/{id}`
 */
@Injectable()
export class UpdateScheduleSlotMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_schedule_slot',
        description:
            "Rewrites a slot. Takes effect at its next boundary rather than immediately; to change the show on air too, when it is this slot's, apply the slot afterwards with `POST /schedule/{id}/apply`",
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `DELETE /schedule/{id}`
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

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `POST /schedule/{id}/apply`
 */
@Injectable()
export class ApplyScheduleSlotToAirMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'apply_schedule_slot_to_air',
        description:
            "Applies a slot, as it is saved now, to the show on air, which must be that slot's. Its name, brief, period, moods, rules and host change in place and the broadcast carries on; the records still planned are chosen again against the new programme, and the ones already planned keep playing until the new set is ready. A change to its source, mode, end or co-hosts cannot be made mid-show and waits for the slot's next occurrence",
        inputSchema: z.toJSONSchema(ApplyScheduleSlotToAirArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScheduleSlotApplied, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, ApplyScheduleSlotToAirArgs);
        const result = await container.get(SlotAirService).apply(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule/{id}/playlist-position`
 */
@Injectable()
export class ReadSlotPlaylistPositionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_slot_playlist_position',
        description: 'The record a slot that resumes its playlist will open on next time, or nothing when it would start from the top',
        inputSchema: z.toJSONSchema(ReadSlotPlaylistPositionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(SlotPlaylistPosition, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, ReadSlotPlaylistPositionArgs);
        const result = await container.get(SlotPlaylistService).position(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `DELETE /schedule/{id}/playlist-position`
 */
@Injectable()
export class RestartSlotPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'restart_slot_playlist',
        description: 'Forgets where a slot got to in its playlist, so it starts from the top the next time it opens',
        inputSchema: z.toJSONSchema(RestartSlotPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, RestartSlotPlaylistArgs);
        await container.get(SlotPlaylistService).restart(id);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/** Add this file's tools to the tool map. */
export function registerScheduleMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('read_current_slot', container.get(ReadCurrentSlotMcpTool));
    map.set('read_timetable', container.get(ReadTimetableMcpTool));
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerScheduleMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_schedule', container.get(ListScheduleMcpTool));
    map.set('create_schedule_slot', container.get(CreateScheduleSlotMcpTool));
    map.set('read_current_slot', container.get(ReadCurrentSlotMcpTool));
    map.set('read_timetable', container.get(ReadTimetableMcpTool));
    map.set('update_schedule_slot', container.get(UpdateScheduleSlotMcpTool));
    map.set('delete_schedule_slot', container.get(DeleteScheduleSlotMcpTool));
    map.set('apply_schedule_slot_to_air', container.get(ApplyScheduleSlotToAirMcpTool));
    map.set('read_slot_playlist_position', container.get(ReadSlotPlaylistPositionMcpTool));
    map.set('restart_slot_playlist', container.get(RestartSlotPlaylistMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerScheduleMcpToolClasses(registry: Registry): void {
    registry.register(ListScheduleMcpTool).useClass(ListScheduleMcpTool).asSingleton();
    registry.register(CreateScheduleSlotMcpTool).useClass(CreateScheduleSlotMcpTool).asSingleton();
    registry.register(ReadCurrentSlotMcpTool).useClass(ReadCurrentSlotMcpTool).asSingleton();
    registry.register(ReadTimetableMcpTool).useClass(ReadTimetableMcpTool).asSingleton();
    registry.register(UpdateScheduleSlotMcpTool).useClass(UpdateScheduleSlotMcpTool).asSingleton();
    registry.register(DeleteScheduleSlotMcpTool).useClass(DeleteScheduleSlotMcpTool).asSingleton();
    registry.register(ApplyScheduleSlotToAirMcpTool).useClass(ApplyScheduleSlotToAirMcpTool).asSingleton();
    registry.register(ReadSlotPlaylistPositionMcpTool).useClass(ReadSlotPlaylistPositionMcpTool).asSingleton();
    registry.register(RestartSlotPlaylistMcpTool).useClass(RestartSlotPlaylistMcpTool).asSingleton();
}
