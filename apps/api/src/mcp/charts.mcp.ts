// Auto-generated MCP tools
// generated from [charts.ck](../../data/contracts/charts/charts.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ChartsService } from '#src/modules/charts/charts.service.js';
import { ChartPage, ChartQuery, StationChartList } from '../modules/charts/types/charts.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListChartsArgs = z.object({});
const ReadChartArgs = z.object({ id: z.string().min(1).max(400), query: ChartQuery.optional() });

/**
 * from [charts.ck](../../data/contracts/charts/charts.ck#L22)
 */
@Injectable()
export class ListChartsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_charts',
        description: 'Every chart every installed chart plugin currently offers',
        inputSchema: z.toJSONSchema(ListChartsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationChartList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(ChartsService).readCharts();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [charts.ck](../../data/contracts/charts/charts.ck#L37)
 */
@Injectable()
export class ReadChartMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_chart',
        description: "One chart's records, ranked",
        inputSchema: z.toJSONSchema(ReadChartArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ChartPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id, query = await parseAndValidate({}, ReadChartArgs.shape.query.unwrap()) } = await parseAndValidate(args, ReadChartArgs);
        const result = await container.get(ChartsService).readChart(id, query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerChartsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_charts', container.get(ListChartsMcpTool));
    map.set('read_chart', container.get(ReadChartMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerChartsMcpToolClasses(registry: Registry): void {
    registry.register(ListChartsMcpTool).useClass(ListChartsMcpTool).asSingleton();
    registry.register(ReadChartMcpTool).useClass(ReadChartMcpTool).asSingleton();
}
