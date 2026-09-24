// Auto-generated MCP tools
// generated from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PodcastsService } from '#src/modules/podcasts/podcasts.service.js';
import {
    StationDirectoryPage,
    StationDirectoryQuery,
    StationEpisode,
    StationEpisodePage,
    StationEpisodeQuery,
    StationShowList,
} from '../modules/podcasts/types/podcasts.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListShowsArgs = z.object({});
const SearchPodcastDirectoryArgs = z.object({ query: StationDirectoryQuery.optional() });
const ListEpisodesArgs = z.object({ query: StationEpisodeQuery.optional() });
const FetchEpisodeArgs = z.object({ id: z.string().min(1).max(100) });
const RefreshPodcastsArgs = z.object({});

/**
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L20)
 */
@Injectable()
export class ListShowsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_shows',
        description: 'Every programme every installed podcast plugin carries',
        inputSchema: z.toJSONSchema(ListShowsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationShowList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PodcastsService).readShows();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L32)
 */
@Injectable()
export class SearchPodcastDirectoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'search_podcast_directory',
        description: 'Looks a show up in the directories the installed podcast plugins can search',
        inputSchema: z.toJSONSchema(SearchPodcastDirectoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationDirectoryPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { query = await parseAndValidate({}, SearchPodcastDirectoryArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            SearchPodcastDirectoryArgs,
        );
        const result = await container.get(PodcastsService).searchDirectory(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L49)
 */
@Injectable()
export class ListEpisodesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_episodes',
        description: 'The episodes the station knows about, newest first, with what it has done with each',
        inputSchema: z.toJSONSchema(ListEpisodesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationEpisodePage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ListEpisodesArgs.shape.query.unwrap()) } = await parseAndValidate(args, ListEpisodesArgs);
        const result = await container.get(PodcastsService).readEpisodes(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L65)
 */
@Injectable()
export class FetchEpisodeMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'fetch_episode',
        description: "Fetches one episode's audio into the station's store now, rather than waiting for its slot to come near",
        inputSchema: z.toJSONSchema(FetchEpisodeArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationEpisode, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, FetchEpisodeArgs);
        const result = await container.get(PodcastsService).requestFetch(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L81)
 */
@Injectable()
export class RefreshPodcastsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'refresh_podcasts',
        description: "Reads every show's feed again, in the background, rather than waiting for the next scheduled refresh",
        inputSchema: z.toJSONSchema(RefreshPodcastsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        await container.get(PodcastsService).requestRefresh();
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerPodcastsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_shows', container.get(ListShowsMcpTool));
    map.set('search_podcast_directory', container.get(SearchPodcastDirectoryMcpTool));
    map.set('list_episodes', container.get(ListEpisodesMcpTool));
    map.set('fetch_episode', container.get(FetchEpisodeMcpTool));
    map.set('refresh_podcasts', container.get(RefreshPodcastsMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerPodcastsMcpToolClasses(registry: Registry): void {
    registry.register(ListShowsMcpTool).useClass(ListShowsMcpTool).asSingleton();
    registry.register(SearchPodcastDirectoryMcpTool).useClass(SearchPodcastDirectoryMcpTool).asSingleton();
    registry.register(ListEpisodesMcpTool).useClass(ListEpisodesMcpTool).asSingleton();
    registry.register(FetchEpisodeMcpTool).useClass(FetchEpisodeMcpTool).asSingleton();
    registry.register(RefreshPodcastsMcpTool).useClass(RefreshPodcastsMcpTool).asSingleton();
}
