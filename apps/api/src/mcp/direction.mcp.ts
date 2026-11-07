// Auto-generated MCP tools
// generated from [direction.ck](../../data/contracts/director/direction.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { TalkDirectionService } from '#src/modules/director/talk.direction.service.js';
import { TalkDirectionInput, TalkDirectionReading } from '../modules/director/types/direction.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadTheTalkDirectionArgs = z.object({});
const DirectThePresentersArgs = z.object({ body: TalkDirectionInput });
const StopDirectingThePresentersArgs = z.object({});

/**
 * from [direction.ck](../../data/contracts/director/direction.ck) `GET /direction`
 */
@Injectable()
export class ReadTheTalkDirectionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_the_talk_direction',
        description: 'The direction in force, if any',
        inputSchema: z.toJSONSchema(ReadTheTalkDirectionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TalkDirectionReading, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(TalkDirectionService).read();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [direction.ck](../../data/contracts/director/direction.ck) `PUT /direction`
 */
@Injectable()
export class DirectThePresentersMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'direct_the_presenters',
        description:
            'Gives the presenters a line to lean on for a number of hours, replacing any direction already in force. Breaks already written are not rewritten',
        inputSchema: z.toJSONSchema(DirectThePresentersArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TalkDirectionReading, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, DirectThePresentersArgs);
        const result = await container.get(TalkDirectionService).direct(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [direction.ck](../../data/contracts/director/direction.ck) `DELETE /direction`
 */
@Injectable()
export class StopDirectingThePresentersMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'stop_directing_the_presenters',
        description: 'Ends the direction now. Breaks already written are not rewritten',
        inputSchema: z.toJSONSchema(StopDirectingThePresentersArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TalkDirectionReading, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(TalkDirectionService).stop();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerDirectionMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_the_talk_direction', container.get(ReadTheTalkDirectionMcpTool));
    map.set('direct_the_presenters', container.get(DirectThePresentersMcpTool));
    map.set('stop_directing_the_presenters', container.get(StopDirectingThePresentersMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerDirectionMcpToolClasses(registry: Registry): void {
    registry.register(ReadTheTalkDirectionMcpTool).useClass(ReadTheTalkDirectionMcpTool).asSingleton();
    registry.register(DirectThePresentersMcpTool).useClass(DirectThePresentersMcpTool).asSingleton();
    registry.register(StopDirectingThePresentersMcpTool).useClass(StopDirectingThePresentersMcpTool).asSingleton();
}
