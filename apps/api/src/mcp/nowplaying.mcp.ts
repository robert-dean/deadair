// Auto-generated MCP tools
// generated from [nowplaying.ck](../../data/contracts/nowplaying/nowplaying.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolHandler, McpToolHandlerMap, McpToolContext } from '@maroonedsoftware/mcp';
import { NowPlayingService } from '#src/modules/nowplaying/nowplaying.service.js';
import { NowPlaying } from '../modules/nowplaying/types/nowplaying.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetNowPlayingArgs = z.object({});

/**
 * from [nowplaying.ck](../../data/contracts/nowplaying/nowplaying.ck#L20)
 */
@Injectable()
export class GetNowPlayingMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_now_playing',
        description:
            'What is on air right now: the record, its artist and album, and when it started. Answers onAir: false when the station is quiet, which is an answer rather than an error. Use this when asked what is playing; use get_playout_status for what is queued behind it.',
        inputSchema: z.toJSONSchema(GetNowPlayingArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(NowPlaying, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': 'none' },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        const result = await container.get(NowPlayingService).getNowPlaying();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the tool map. */
export function registerNowplayingMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_now_playing', container.get(GetNowPlayingMcpTool));
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerNowplayingMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('get_now_playing', container.get(GetNowPlayingMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerNowplayingMcpToolClasses(registry: Registry): void {
    registry.register(GetNowPlayingMcpTool).useClass(GetNowPlayingMcpTool).asSingleton();
}
