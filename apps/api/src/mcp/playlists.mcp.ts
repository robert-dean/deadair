// Auto-generated MCP tools
// generated from [playlists.ck](../../data/contracts/playlists/playlists.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PlaylistsService } from '#src/modules/playlists/playlists.service.js';
import { CatalogPlaylistPage, CatalogPlaylistTracks } from '../modules/playlists/types/playlists.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListImportablePlaylistsArgs = z.object({});
const GetPlaylistTracksArgs = z.object({ pluginId: z.string().min(1).max(200), playlistId: z.string().min(1).max(400) });
const HidePlaylistArgs = z.object({ pluginId: z.string().min(1).max(200), playlistId: z.string().min(1).max(400) });
const ShowPlaylistArgs = z.object({ pluginId: z.string().min(1).max(200), playlistId: z.string().min(1).max(400) });
const RefreshPlaylistsArgs = z.object({});
const RefreshPlaylistArgs = z.object({ pluginId: z.string().min(1).max(200), playlistId: z.string().min(1).max(400) });

/**
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L19)
 */
@Injectable()
export class ListImportablePlaylistsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_importable_playlists',
        description: 'Fans out across every installed plugin that declares AND implements the `catalog` capability',
        inputSchema: z.toJSONSchema(ListImportablePlaylistsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(CatalogPlaylistPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PlaylistsService).listPlaylists();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L40)
 */
@Injectable()
export class GetPlaylistTracksMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_playlist_tracks',
        description: "One playlist's tracks from one plugin",
        inputSchema: z.toJSONSchema(GetPlaylistTracksArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(CatalogPlaylistTracks, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { pluginId, playlistId } = await parseAndValidate(args, GetPlaylistTracksArgs);
        const result = await container.get(PlaylistsService).getPlaylistTracks(pluginId, playlistId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L60)
 */
@Injectable()
export class HidePlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'hide_playlist',
        description:
            'Hides one playlist from this station: the listing marks it hidden, the pickers stop offering it and the library sync stops reading it. Hiding one already hidden changes nothing',
        inputSchema: z.toJSONSchema(HidePlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { pluginId, playlistId } = await parseAndValidate(args, HidePlaylistArgs);
        await container.get(PlaylistsService).hidePlaylist(pluginId, playlistId);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L64)
 */
@Injectable()
export class ShowPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'show_playlist',
        description: 'Shows a hidden playlist again. Showing one that is not hidden changes nothing',
        inputSchema: z.toJSONSchema(ShowPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { pluginId, playlistId } = await parseAndValidate(args, ShowPlaylistArgs);
        await container.get(PlaylistsService).showPlaylist(pluginId, playlistId);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L71)
 */
@Injectable()
export class RefreshPlaylistsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'refresh_playlists',
        description:
            'Reads every playlist on every music source again, in the background, rather than waiting for the next scheduled read. New records reach the library; records gone from every playlist are retired',
        inputSchema: z.toJSONSchema(RefreshPlaylistsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        await container.get(PlaylistsService).requestRefresh();
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L82)
 */
@Injectable()
export class RefreshPlaylistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'refresh_playlist',
        description:
            'Reads one playlist again, in the background. New records reach the library; a record taken out of it stays until the next full read judges it',
        inputSchema: z.toJSONSchema(RefreshPlaylistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { pluginId, playlistId } = await parseAndValidate(args, RefreshPlaylistArgs);
        await container.get(PlaylistsService).requestPlaylistRefresh(pluginId, playlistId);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerPlaylistsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_importable_playlists', container.get(ListImportablePlaylistsMcpTool));
    map.set('get_playlist_tracks', container.get(GetPlaylistTracksMcpTool));
    map.set('hide_playlist', container.get(HidePlaylistMcpTool));
    map.set('show_playlist', container.get(ShowPlaylistMcpTool));
    map.set('refresh_playlists', container.get(RefreshPlaylistsMcpTool));
    map.set('refresh_playlist', container.get(RefreshPlaylistMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerPlaylistsMcpToolClasses(registry: Registry): void {
    registry.register(ListImportablePlaylistsMcpTool).useClass(ListImportablePlaylistsMcpTool).asSingleton();
    registry.register(GetPlaylistTracksMcpTool).useClass(GetPlaylistTracksMcpTool).asSingleton();
    registry.register(HidePlaylistMcpTool).useClass(HidePlaylistMcpTool).asSingleton();
    registry.register(ShowPlaylistMcpTool).useClass(ShowPlaylistMcpTool).asSingleton();
    registry.register(RefreshPlaylistsMcpTool).useClass(RefreshPlaylistsMcpTool).asSingleton();
    registry.register(RefreshPlaylistMcpTool).useClass(RefreshPlaylistMcpTool).asSingleton();
}
