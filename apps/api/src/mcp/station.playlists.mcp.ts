// Auto-generated MCP tools
// generated from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PlaylistImportService } from '#src/modules/playlists/playlist.import.service.js';
import { StationPlaylistsService } from '#src/modules/playlists/station.playlists.service.js';
import {
    PlaylistFile,
    PlaylistImportInput,
    PlaylistImportPlan,
    PlaylistImportResult,
    StationPlaylist,
    StationPlaylistDetail,
    StationPlaylistList,
    StationPlaylistUpdate,
} from '../modules/playlists/types/station.playlists.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListStationPlaylistsArgs = z.object({});
const GetStationPlaylistArgs = z.object({ id: z.uuid() });
const UpdateStationPlaylistArgs = z.object({ id: z.uuid(), body: StationPlaylistUpdate });
const DeleteStationPlaylistArgs = z.object({ id: z.uuid() });
const FillStationPlaylistArgs = z.object({ id: z.uuid() });
const ExportStationPlaylistArgs = z.object({ id: z.uuid() });
const PreviewPlaylistImportArgs = z.object({ body: PlaylistImportInput });
const ImportPlaylistArgs = z.object({ body: PlaylistImportInput });

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L17)
 */
@Injectable()
export class ListStationPlaylistsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_station_playlists',
        description: 'Every playlist the station owns, newest first',
        inputSchema: z.toJSONSchema(ListStationPlaylistsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationPlaylistList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(StationPlaylistsService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L35)
 */
@Injectable()
export class GetStationPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_station_playlist',
        description: 'One station playlist with its records in order, placeholders included',
        inputSchema: z.toJSONSchema(GetStationPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationPlaylistDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetStationPlaylistArgs);
        const result = await container.get(StationPlaylistsService).get(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L48)
 */
@Injectable()
export class UpdateStationPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_station_playlist',
        description: 'Renames a station playlist, or rewrites what it is for',
        inputSchema: z.toJSONSchema(UpdateStationPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationPlaylist, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdateStationPlaylistArgs);
        const result = await container.get(StationPlaylistsService).update(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L61)
 */
@Injectable()
export class DeleteStationPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_station_playlist',
        description: 'Deletes a station playlist. The records it named stay in the library',
        inputSchema: z.toJSONSchema(DeleteStationPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteStationPlaylistArgs);
        await container.get(StationPlaylistsService).delete(id);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L75)
 */
@Injectable()
export class FillStationPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'fill_station_playlist',
        description:
            'Looks up the records this playlist names and the library does not hold, in the background, and adds the ones a provider has. The activity feed says how it went',
        inputSchema: z.toJSONSchema(FillStationPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, FillStationPlaylistArgs);
        await container.get(StationPlaylistsService).requestFill(id);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L89)
 */
@Injectable()
export class ExportStationPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'export_station_playlist',
        description: 'One station playlist as a file another station can import',
        inputSchema: z.toJSONSchema(ExportStationPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlaylistFile, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, ExportStationPlaylistArgs);
        const result = await container.get(StationPlaylistsService).export(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L110)
 */
@Injectable()
export class PreviewPlaylistImportMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'preview_playlist_import',
        description: 'Reads a source and reports which of its records the library holds and which it would have to find. Writes nothing',
        inputSchema: z.toJSONSchema(PreviewPlaylistImportArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlaylistImportPlan, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, PreviewPlaylistImportArgs);
        const result = await container.get(PlaylistImportService).preview(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L127)
 */
@Injectable()
export class ImportPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'import_playlist',
        description: 'Makes a new station playlist from a source and answers with what it did',
        inputSchema: z.toJSONSchema(ImportPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PlaylistImportResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, ImportPlaylistArgs);
        const result = await container.get(PlaylistImportService).import(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerStationPlaylistsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_station_playlists', container.get(ListStationPlaylistsMcpTool));
    map.set('get_station_playlist', container.get(GetStationPlaylistMcpTool));
    map.set('update_station_playlist', container.get(UpdateStationPlaylistMcpTool));
    map.set('delete_station_playlist', container.get(DeleteStationPlaylistMcpTool));
    map.set('fill_station_playlist', container.get(FillStationPlaylistMcpTool));
    map.set('export_station_playlist', container.get(ExportStationPlaylistMcpTool));
    map.set('preview_playlist_import', container.get(PreviewPlaylistImportMcpTool));
    map.set('import_playlist', container.get(ImportPlaylistMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerStationPlaylistsMcpToolClasses(registry: Registry): void {
    registry.register(ListStationPlaylistsMcpTool).useClass(ListStationPlaylistsMcpTool).asSingleton();
    registry.register(GetStationPlaylistMcpTool).useClass(GetStationPlaylistMcpTool).asSingleton();
    registry.register(UpdateStationPlaylistMcpTool).useClass(UpdateStationPlaylistMcpTool).asSingleton();
    registry.register(DeleteStationPlaylistMcpTool).useClass(DeleteStationPlaylistMcpTool).asSingleton();
    registry.register(FillStationPlaylistMcpTool).useClass(FillStationPlaylistMcpTool).asSingleton();
    registry.register(ExportStationPlaylistMcpTool).useClass(ExportStationPlaylistMcpTool).asSingleton();
    registry.register(PreviewPlaylistImportMcpTool).useClass(PreviewPlaylistImportMcpTool).asSingleton();
    registry.register(ImportPlaylistMcpTool).useClass(ImportPlaylistMcpTool).asSingleton();
}
