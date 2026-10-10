// Auto-generated MCP tools
// generated from [outputs.ck](../../data/contracts/outputs/outputs.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { OutputsService } from '#src/modules/outputs/outputs.service.js';
import { OutputCast, OutputCastList, OutputCastRequest, OutputDeviceList } from '../modules/outputs/types/outputs.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListOutputDevicesArgs = z.object({});
const ListCastsArgs = z.object({});
const StartCastArgs = z.object({ body: OutputCastRequest });
const StopCastArgs = z.object({ pluginId: z.string().min(1).max(200), deviceId: z.string().min(1).max(400) });

/**
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck) `GET /outputs/devices`
 */
@Injectable()
export class ListOutputDevicesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_output_devices',
        description: 'Every speaker the station can play on, from every `output` plugin, with the mounts each can take',
        inputSchema: z.toJSONSchema(ListOutputDevicesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OutputDeviceList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(OutputsService).listDevices();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck) `GET /outputs/casts`
 */
@Injectable()
export class ListCastsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_casts',
        description: 'Every speaker the station is meant to be playing on, each asked how it is doing now',
        inputSchema: z.toJSONSchema(ListCastsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OutputCastList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(OutputsService).listCasts();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck) `POST /outputs/casts`
 */
@Injectable()
export class StartCastMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'start_cast',
        description:
            'Play the station on a speaker, replacing whatever it was playing. The station keeps it playing, through a dropped stream or a restart, until it is stopped here or somebody plays something else on it',
        inputSchema: z.toJSONSchema(StartCastArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(OutputCast, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, StartCastArgs);
        const result = await container.get(OutputsService).startCast(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck) `DELETE /outputs/casts/{pluginId}/{deviceId}`
 */
@Injectable()
export class StopCastMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'stop_cast',
        description: 'Stop the station on a speaker. Answers 204 when it was not playing too',
        inputSchema: z.toJSONSchema(StopCastArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { pluginId, deviceId } = await parseAndValidate(args, StopCastArgs);
        await container.get(OutputsService).stopCast(pluginId, deviceId);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerOutputsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_output_devices', container.get(ListOutputDevicesMcpTool));
    map.set('list_casts', container.get(ListCastsMcpTool));
    map.set('start_cast', container.get(StartCastMcpTool));
    map.set('stop_cast', container.get(StopCastMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerOutputsMcpToolClasses(registry: Registry): void {
    registry.register(ListOutputDevicesMcpTool).useClass(ListOutputDevicesMcpTool).asSingleton();
    registry.register(ListCastsMcpTool).useClass(ListCastsMcpTool).asSingleton();
    registry.register(StartCastMcpTool).useClass(StartCastMcpTool).asSingleton();
    registry.register(StopCastMcpTool).useClass(StopCastMcpTool).asSingleton();
}
