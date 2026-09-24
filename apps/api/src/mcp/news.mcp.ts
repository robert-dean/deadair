// Auto-generated MCP tools
// generated from [news.ck](../../data/contracts/news/news.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { NewsService } from '#src/modules/news/news.service.js';
import { NewsPage, NewsQuery, StationFeedList } from '../modules/news/types/news.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListFeedsArgs = z.object({});
const ReadNewsArgs = z.object({ query: NewsQuery.optional() });

/**
 * from [news.ck](../../data/contracts/news/news.ck#L22)
 */
@Injectable()
export class ListFeedsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_feeds',
        description: 'Every feed every installed news plugin currently offers',
        inputSchema: z.toJSONSchema(ListFeedsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationFeedList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(NewsService).readFeeds();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [news.ck](../../data/contracts/news/news.ck#L34)
 */
@Injectable()
export class ReadNewsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_news',
        description: 'Published entries, newest first',
        inputSchema: z.toJSONSchema(ReadNewsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(NewsPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ReadNewsArgs.shape.query.unwrap()) } = await parseAndValidate(args, ReadNewsArgs);
        const result = await container.get(NewsService).readNews(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerNewsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_feeds', container.get(ListFeedsMcpTool));
    map.set('read_news', container.get(ReadNewsMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerNewsMcpToolClasses(registry: Registry): void {
    registry.register(ListFeedsMcpTool).useClass(ListFeedsMcpTool).asSingleton();
    registry.register(ReadNewsMcpTool).useClass(ReadNewsMcpTool).asSingleton();
}
