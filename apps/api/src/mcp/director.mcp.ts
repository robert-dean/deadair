// Auto-generated MCP tools
// generated from [director.ck](../../data/contracts/director/director.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { DirectorConsoleService } from '#src/modules/director/director.console.service.js';
import {
    AddStationSegmentInput,
    AddStationTrackInput,
    ExtendStationInput,
    HoldStationInput,
    MoveStationItemInput,
    PutOnAirInput,
    ReplanStationInput,
    SetStationAirInput,
    SetStationHostInput,
    StationAir,
    StationOrder,
} from '../modules/director/types/director.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetStationAirArgs = z.object({});
const PutTheStationOnAirArgs = z.object({ body: PutOnAirInput });
const SetTheAirModeArgs = z.object({ body: SetStationAirInput });
const GetTheRunningOrderArgs = z.object({});
const RecastTheBroadcastArgs = z.object({ body: SetStationHostInput });
const ExtendTheRunningOrderArgs = z.object({ body: ExtendStationInput });
const ReplanTheRunningOrderArgs = z.object({ body: ReplanStationInput });
const HoldTheStationAgainstTheScheduleArgs = z.object({ body: HoldStationInput });
const ReleaseTheStationToTheScheduleArgs = z.object({});
const ShuffleTheRunningOrderArgs = z.object({});
const AddASegmentToTheRunningOrderArgs = z.object({ body: AddStationSegmentInput });
const AddARecordToTheRunningOrderArgs = z.object({ body: AddStationTrackInput });
const MoveARunningOrderItemArgs = z.object({ itemId: z.string().min(1).max(100), body: MoveStationItemInput });
const RemoveARunningOrderItemArgs = z.object({ itemId: z.string().min(1).max(100) });
const SkipToARunningOrderItemArgs = z.object({ itemId: z.string().min(1).max(100) });

/**
 * from [director.ck](../../data/contracts/director/director.ck#L21)
 */
@Injectable()
export class GetStationAirMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_station_air',
        description: 'What the station is airing, and whether it is driving at all',
        inputSchema: z.toJSONSchema(GetStationAirArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationAir, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(DirectorConsoleService).getAir();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L33)
 */
@Injectable()
export class PutTheStationOnAirMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'put_the_station_on_air',
        description:
            'Puts the station on air, building the running order from a playlist read at this moment. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track',
        inputSchema: z.toJSONSchema(PutTheStationOnAirArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationAir, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, PutTheStationOnAirArgs);
        const result = await container.get(DirectorConsoleService).putOnAir(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L48)
 */
@Injectable()
export class SetTheAirModeMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_the_air_mode',
        description:
            'Changes what puts the station on air: only while somebody is listening, or whenever there is a programme. Takes effect at once rather than at the next boundary',
        inputSchema: z.toJSONSchema(SetTheAirModeArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationAir, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, SetTheAirModeArgs);
        const result = await container.get(DirectorConsoleService).setAirMode(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L73)
 */
@Injectable()
export class GetTheRunningOrderMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_the_running_order',
        description: 'The live running order, item by item, each saying where it has got to',
        inputSchema: z.toJSONSchema(GetTheRunningOrderArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(DirectorConsoleService).getOrder();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L88)
 */
@Injectable()
export class RecastTheBroadcastMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'recast_the_broadcast',
        description:
            'Changes who is presenting this broadcast. Breaks already written for it in the outgoing character are written again in the new one',
        inputSchema: z.toJSONSchema(RecastTheBroadcastArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, RecastTheBroadcastArgs);
        const result = await container.get(DirectorConsoleService).recast(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L106)
 */
@Injectable()
export class ExtendTheRunningOrderMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'extend_the_running_order',
        description:
            'Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it',
        inputSchema: z.toJSONSchema(ExtendTheRunningOrderArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, ExtendTheRunningOrderArgs);
        await container.get(DirectorConsoleService).extendOrder(body);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L122)
 */
@Injectable()
export class ReplanTheRunningOrderMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'replan_the_running_order',
        description:
            'Queues a fresh set for everything the player is not already holding, and swaps it in once it exists. The old tail keeps playing until then, because emptying the running order first would take the station off air while the model was still choosing',
        inputSchema: z.toJSONSchema(ReplanTheRunningOrderArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, ReplanTheRunningOrderArgs);
        await container.get(DirectorConsoleService).replanOrder(body);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L138)
 */
@Injectable()
export class HoldTheStationAgainstTheScheduleMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'hold_the_station_against_the_schedule',
        description:
            'Holds the running order against the schedule, so a block boundary does not take back what an operator put on. A takeover is otherwise stamped with whichever slot was in force and is replaced when that block ends, which is correct and gives nobody any warning',
        inputSchema: z.toJSONSchema(HoldTheStationAgainstTheScheduleArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationAir, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, HoldTheStationAgainstTheScheduleArgs);
        const result = await container.get(DirectorConsoleService).holdAgainstSchedule(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L153)
 */
@Injectable()
export class ReleaseTheStationToTheScheduleMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'release_the_station_to_the_schedule',
        description:
            'Releases a hold, so the next block boundary changes the station over as it ordinarily would. A station with no hold is unchanged rather than refused',
        inputSchema: z.toJSONSchema(ReleaseTheStationToTheScheduleArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationAir, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(DirectorConsoleService).releaseToSchedule();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L168)
 */
@Injectable()
export class ShuffleTheRunningOrderMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'shuffle_the_running_order',
        description:
            "Shuffles the records not yet handed to the player, and plants the breaks again around the new sequence. The head is already in the player's hands and is left alone",
        inputSchema: z.toJSONSchema(ShuffleTheRunningOrderArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(DirectorConsoleService).shuffleOrder();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L183)
 */
@Injectable()
export class AddASegmentToTheRunningOrderMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'add_a_segment_to_the_running_order',
        description:
            'Puts something the station says into the running order. A segment with no audio yet is refused here rather than accepted and skipped when it comes round, so an operator is told why it cannot play',
        inputSchema: z.toJSONSchema(AddASegmentToTheRunningOrderArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, AddASegmentToTheRunningOrderArgs);
        const result = await container.get(DirectorConsoleService).addSegmentToOrder(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L201)
 */
@Injectable()
export class AddARecordToTheRunningOrderMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'add_a_record_to_the_running_order',
        description:
            'Puts a catalog record into the running order. A record whose audio is not local yet is refused here rather than accepted and held or skipped when its slot comes round, so an operator asking for a specific one is told why it cannot play. What makes this worth having on its own is undo: dropping an item only ever marks a segment, but a track is spliced out of the order entirely, so nothing could put one back until this existed',
        inputSchema: z.toJSONSchema(AddARecordToTheRunningOrderArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, AddARecordToTheRunningOrderArgs);
        const result = await container.get(DirectorConsoleService).addTrackToOrder(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L222)
 */
@Injectable()
export class MoveARunningOrderItemMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'move_a_running_order_item',
        description: 'Moves an item. A position already handed to the player is refused rather than clamped',
        inputSchema: z.toJSONSchema(MoveARunningOrderItemArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { itemId, body } = await parseAndValidate(args, MoveARunningOrderItemArgs);
        const result = await container.get(DirectorConsoleService).moveOrderItem(itemId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L237)
 */
@Injectable()
export class RemoveARunningOrderItemMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'remove_a_running_order_item',
        description: 'Drops an item that has not been handed to the player yet',
        inputSchema: z.toJSONSchema(RemoveARunningOrderItemArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { itemId } = await parseAndValidate(args, RemoveARunningOrderItemArgs);
        const result = await container.get(DirectorConsoleService).removeOrderItem(itemId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [director.ck](../../data/contracts/director/director.ck#L255)
 */
@Injectable()
export class SkipToARunningOrderItemMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'skip_to_a_running_order_item',
        description:
            'Makes a record further down the running order the next thing heard. Everything still to come in front of it is marked skipped, anything the player was already holding from in front of it is taken back, and the item on air is cut. Only a record can be skipped to, and only one still to come',
        inputSchema: z.toJSONSchema(SkipToARunningOrderItemArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationOrder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { itemId } = await parseAndValidate(args, SkipToARunningOrderItemArgs);
        const result = await container.get(DirectorConsoleService).skipToOrderItem(itemId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerDirectorMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('get_station_air', container.get(GetStationAirMcpTool));
    map.set('put_the_station_on_air', container.get(PutTheStationOnAirMcpTool));
    map.set('set_the_air_mode', container.get(SetTheAirModeMcpTool));
    map.set('get_the_running_order', container.get(GetTheRunningOrderMcpTool));
    map.set('recast_the_broadcast', container.get(RecastTheBroadcastMcpTool));
    map.set('extend_the_running_order', container.get(ExtendTheRunningOrderMcpTool));
    map.set('replan_the_running_order', container.get(ReplanTheRunningOrderMcpTool));
    map.set('hold_the_station_against_the_schedule', container.get(HoldTheStationAgainstTheScheduleMcpTool));
    map.set('release_the_station_to_the_schedule', container.get(ReleaseTheStationToTheScheduleMcpTool));
    map.set('shuffle_the_running_order', container.get(ShuffleTheRunningOrderMcpTool));
    map.set('add_a_segment_to_the_running_order', container.get(AddASegmentToTheRunningOrderMcpTool));
    map.set('add_a_record_to_the_running_order', container.get(AddARecordToTheRunningOrderMcpTool));
    map.set('move_a_running_order_item', container.get(MoveARunningOrderItemMcpTool));
    map.set('remove_a_running_order_item', container.get(RemoveARunningOrderItemMcpTool));
    map.set('skip_to_a_running_order_item', container.get(SkipToARunningOrderItemMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerDirectorMcpToolClasses(registry: Registry): void {
    registry.register(GetStationAirMcpTool).useClass(GetStationAirMcpTool).asSingleton();
    registry.register(PutTheStationOnAirMcpTool).useClass(PutTheStationOnAirMcpTool).asSingleton();
    registry.register(SetTheAirModeMcpTool).useClass(SetTheAirModeMcpTool).asSingleton();
    registry.register(GetTheRunningOrderMcpTool).useClass(GetTheRunningOrderMcpTool).asSingleton();
    registry.register(RecastTheBroadcastMcpTool).useClass(RecastTheBroadcastMcpTool).asSingleton();
    registry.register(ExtendTheRunningOrderMcpTool).useClass(ExtendTheRunningOrderMcpTool).asSingleton();
    registry.register(ReplanTheRunningOrderMcpTool).useClass(ReplanTheRunningOrderMcpTool).asSingleton();
    registry.register(HoldTheStationAgainstTheScheduleMcpTool).useClass(HoldTheStationAgainstTheScheduleMcpTool).asSingleton();
    registry.register(ReleaseTheStationToTheScheduleMcpTool).useClass(ReleaseTheStationToTheScheduleMcpTool).asSingleton();
    registry.register(ShuffleTheRunningOrderMcpTool).useClass(ShuffleTheRunningOrderMcpTool).asSingleton();
    registry.register(AddASegmentToTheRunningOrderMcpTool).useClass(AddASegmentToTheRunningOrderMcpTool).asSingleton();
    registry.register(AddARecordToTheRunningOrderMcpTool).useClass(AddARecordToTheRunningOrderMcpTool).asSingleton();
    registry.register(MoveARunningOrderItemMcpTool).useClass(MoveARunningOrderItemMcpTool).asSingleton();
    registry.register(RemoveARunningOrderItemMcpTool).useClass(RemoveARunningOrderItemMcpTool).asSingleton();
    registry.register(SkipToARunningOrderItemMcpTool).useClass(SkipToARunningOrderItemMcpTool).asSingleton();
}
