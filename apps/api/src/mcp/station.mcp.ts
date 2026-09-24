// Auto-generated MCP tools
// generated from [station.ck](../../data/contracts/station/station.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { StationAttentionService } from '#src/modules/station/station.attention.service.js';
import { StationCheckupService } from '#src/modules/station/station.checkup.service.js';
import { StationReleasesService } from '#src/modules/station/station.releases.service.js';
import { StationAttention, StationCheckup, StationReleases, serializeStationReleases } from '../modules/station/types/station.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadStationAttentionArgs = z.object({});
const ReadStationCheckupArgs = z.object({});
const ReadStationReleasesArgs = z.object({});
const CheckStationReleasesArgs = z.object({});

/**
 * from [station.ck](../../data/contracts/station/station.ck#L27)
 */
@Injectable()
export class ReadStationAttentionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_station_attention',
        description: 'Everything wrong or waiting, worst first, each with the console page that can act on it',
        inputSchema: z.toJSONSchema(ReadStationAttentionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationAttention, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(StationAttentionService).read();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [station.ck](../../data/contracts/station/station.ck#L50)
 */
@Injectable()
export class ReadStationCheckupMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_station_checkup',
        description: 'The loops the station runs and how much of the library it has looked at',
        inputSchema: z.toJSONSchema(ReadStationCheckupArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationCheckup, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(StationCheckupService).read();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [station.ck](../../data/contracts/station/station.ck#L65)
 */
@Injectable()
export class ReadStationReleasesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_station_releases',
        description: 'The releases this build contains and what each one changed, newest first',
        inputSchema: z.toJSONSchema(ReadStationReleasesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationReleases, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(StationReleasesService).read();
        const resultJson = JSON.stringify(serializeStationReleases(result));
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [station.ck](../../data/contracts/station/station.ck#L80)
 */
@Injectable()
export class CheckStationReleasesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'check_station_releases',
        description: 'Asks GitHub for newer releases now, and answers with what the station then knows',
        inputSchema: z.toJSONSchema(CheckStationReleasesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationReleases, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(StationReleasesService).check();
        const resultJson = JSON.stringify(serializeStationReleases(result));
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerStationMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_station_attention', container.get(ReadStationAttentionMcpTool));
    map.set('read_station_checkup', container.get(ReadStationCheckupMcpTool));
    map.set('read_station_releases', container.get(ReadStationReleasesMcpTool));
    map.set('check_station_releases', container.get(CheckStationReleasesMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerStationMcpToolClasses(registry: Registry): void {
    registry.register(ReadStationAttentionMcpTool).useClass(ReadStationAttentionMcpTool).asSingleton();
    registry.register(ReadStationCheckupMcpTool).useClass(ReadStationCheckupMcpTool).asSingleton();
    registry.register(ReadStationReleasesMcpTool).useClass(ReadStationReleasesMcpTool).asSingleton();
    registry.register(CheckStationReleasesMcpTool).useClass(CheckStationReleasesMcpTool).asSingleton();
}
