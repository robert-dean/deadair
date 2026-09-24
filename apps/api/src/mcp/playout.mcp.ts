// Auto-generated MCP tools
// generated from [playout.ck](../../data/contracts/playout/playout.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PlayoutService } from '#src/modules/playout/playout.service.js';
import { PlayoutChartInput, PlayoutPlaylistInput, PlayoutStationPlaylistInput, PlayoutStatus } from '../modules/playout/types/playout.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetPlayoutStatusArgs = z.object({});
const PlayAPlaylistArgs = z.object({ body: PlayoutPlaylistInput });
const PlayAStationPlaylistArgs = z.object({ body: PlayoutStationPlaylistInput });
const PlayAChartArgs = z.object({ body: PlayoutChartInput });
const SkipTheCurrentItemArgs = z.object({});
const StartPlayoutArgs = z.object({});
const StopPlayoutArgs = z.object({});

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L17)
 */
@Injectable()
export class GetPlayoutStatusMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_playout_status',
        description:
            'What the station is playing and the records queued behind it, in running order. Use this when asked what is coming up; get_now_playing is enough for what is on air.',
        inputSchema: z.toJSONSchema(GetPlayoutStatusArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PlayoutService).getStatus();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L35)
 */
@Injectable()
export class PlayAPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'play_a_playlist',
        description:
            'Loads a plugin playlist into the running order and starts handing it to the player. Replaces whatever was queued; what is on air finishes rather than being cut off',
        inputSchema: z.toJSONSchema(PlayAPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, PlayAPlaylistArgs);
        const result = await container.get(PlayoutService).playPlaylist(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L53)
 */
@Injectable()
export class PlayAStationPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'play_a_station_playlist',
        description:
            'Loads a playlist the station owns into the running order and starts handing it to the player. The same replacement a plugin playlist makes, from records the library already holds',
        inputSchema: z.toJSONSchema(PlayAStationPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, PlayAStationPlaylistArgs);
        const result = await container.get(PlayoutService).playStationPlaylist(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L71)
 */
@Injectable()
export class PlayAChartMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'play_a_chart',
        description:
            'Builds the running order from a published chart and starts handing it to the player. The same replacement a playlist makes, from a document somebody else ranked',
        inputSchema: z.toJSONSchema(PlayAChartArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, PlayAChartArgs);
        const result = await container.get(PlayoutService).playChart(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L89)
 */
@Injectable()
export class SkipTheCurrentItemMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'skip_the_current_item',
        description:
            'Cuts what is on air now for every listener and starts the next item at once. It cannot be undone, so confirm with the person first unless they asked for it in so many words.',
        inputSchema: z.toJSONSchema(SkipTheCurrentItemArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(PlayoutService).skip();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L107)
 */
@Injectable()
export class StartPlayoutMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'start_playout',
        description:
            'Puts the station back on air with the running order it already has, picking it up where Stop left it. Distinct from putting a playlist on air, which builds a new broadcast and throws away what was there. Refused when there is nothing left to resume',
        inputSchema: z.toJSONSchema(StartPlayoutArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(PlayoutService).start();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playout.ck](../../data/contracts/playout/playout.ck#L122)
 */
@Injectable()
export class StopPlayoutMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'stop_playout',
        description:
            'Stands the station down: stops what is on air at once and hands the mount back. The running order is LEFT as it is, so `/playout/start` can pick it up where this stopped it. deadair holds the mount on a lease it renews while it has something to play, so stopping goes quiet rather than falling through to a bed nobody programmed',
        inputSchema: z.toJSONSchema(StopPlayoutArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlayoutStatus, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(PlayoutService).stop();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the tool map. */
export function registerPlayoutMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_playout_status', container.get(GetPlayoutStatusMcpTool));
    map.set('skip_the_current_item', container.get(SkipTheCurrentItemMcpTool));
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerPlayoutMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('get_playout_status', container.get(GetPlayoutStatusMcpTool));
    map.set('play_a_playlist', container.get(PlayAPlaylistMcpTool));
    map.set('play_a_station_playlist', container.get(PlayAStationPlaylistMcpTool));
    map.set('play_a_chart', container.get(PlayAChartMcpTool));
    map.set('skip_the_current_item', container.get(SkipTheCurrentItemMcpTool));
    map.set('start_playout', container.get(StartPlayoutMcpTool));
    map.set('stop_playout', container.get(StopPlayoutMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerPlayoutMcpToolClasses(registry: Registry): void {
    registry.register(GetPlayoutStatusMcpTool).useClass(GetPlayoutStatusMcpTool).asSingleton();
    registry.register(PlayAPlaylistMcpTool).useClass(PlayAPlaylistMcpTool).asSingleton();
    registry.register(PlayAStationPlaylistMcpTool).useClass(PlayAStationPlaylistMcpTool).asSingleton();
    registry.register(PlayAChartMcpTool).useClass(PlayAChartMcpTool).asSingleton();
    registry.register(SkipTheCurrentItemMcpTool).useClass(SkipTheCurrentItemMcpTool).asSingleton();
    registry.register(StartPlayoutMcpTool).useClass(StartPlayoutMcpTool).asSingleton();
    registry.register(StopPlayoutMcpTool).useClass(StopPlayoutMcpTool).asSingleton();
}
