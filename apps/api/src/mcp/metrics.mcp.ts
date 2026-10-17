// Auto-generated MCP tools
// generated from [metrics.ck](../../data/contracts/metrics/metrics.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { MetricsService } from '#src/modules/metrics/metrics.service.js';
import { MetricNames, MetricSeriesPage, MetricSeriesQuery } from '../modules/metrics/types/metrics.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadMetricSeriesArgs = z.object({ query: MetricSeriesQuery.optional() });
const ReadMetricNamesArgs = z.object({});

/**
 * from [metrics.ck](../../data/contracts/metrics/metrics.ck) `GET /metrics/series`
 */
@Injectable()
export class ReadMetricSeriesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_metric_series',
        description: 'Trends over a range, at minute resolution for two days or less and hourly beyond',
        inputSchema: z.toJSONSchema(ReadMetricSeriesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(MetricSeriesPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ReadMetricSeriesArgs.shape.query.unwrap()) } = await parseAndValidate(args, ReadMetricSeriesArgs);
        const result = await container.get(MetricsService).readSeries(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [metrics.ck](../../data/contracts/metrics/metrics.ck) `GET /metrics/names`
 */
@Injectable()
export class ReadMetricNamesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_metric_names',
        description: 'Every metric the station holds, with its labels and when it was last measured',
        inputSchema: z.toJSONSchema(ReadMetricNamesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(MetricNames, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(MetricsService).readNames();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerMetricsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_metric_series', container.get(ReadMetricSeriesMcpTool));
    map.set('read_metric_names', container.get(ReadMetricNamesMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerMetricsMcpToolClasses(registry: Registry): void {
    registry.register(ReadMetricSeriesMcpTool).useClass(ReadMetricSeriesMcpTool).asSingleton();
    registry.register(ReadMetricNamesMcpTool).useClass(ReadMetricNamesMcpTool).asSingleton();
}
