// Auto-generated MCP tools
// generated from [traces.ck](../../data/contracts/station/traces.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { TracesService } from '#src/modules/station/traces.service.js';
import { TraceDetail, TracesPage, TracesQuery } from '../modules/station/types/traces.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadTracesArgs = z.object({ query: TracesQuery.optional() });
const ReadTraceArgs = z.object({ id: z.string().min(1).max(200) });

/**
 * from [traces.ck](../../data/contracts/station/traces.ck#L27)
 */
@Injectable()
export class ReadTracesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_traces',
        description: 'Recent decisions, newest first, folded to one row each',
        inputSchema: z.toJSONSchema(ReadTracesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TracesPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { query = await parseAndValidate({}, ReadTracesArgs.shape.query.unwrap()) } = await parseAndValidate(args, ReadTracesArgs);
        const result = await container.get(TracesService).readTraces(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [traces.ck](../../data/contracts/station/traces.ck#L43)
 */
@Injectable()
export class ReadTraceMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_trace',
        description: 'One decision: every call it made, and the decisions on either side of it',
        inputSchema: z.toJSONSchema(ReadTraceArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TraceDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, ReadTraceArgs);
        const result = await container.get(TracesService).readTrace(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerTracesMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_traces', container.get(ReadTracesMcpTool));
    map.set('read_trace', container.get(ReadTraceMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerTracesMcpToolClasses(registry: Registry): void {
    registry.register(ReadTracesMcpTool).useClass(ReadTracesMcpTool).asSingleton();
    registry.register(ReadTraceMcpTool).useClass(ReadTraceMcpTool).asSingleton();
}
