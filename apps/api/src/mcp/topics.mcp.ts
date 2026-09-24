// Auto-generated MCP tools
// generated from [topics.ck](../../data/contracts/topics/topics.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { TopicsService } from '#src/modules/topics/topics.service.js';
import { TopicInput, TopicKindList, TopicList, TopicQuery } from '../modules/topics/types/topics.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListTopicsArgs = z.object({ query: TopicQuery.optional() });
const CreateTopicArgs = z.object({ body: TopicInput });
const ListTopicKindsArgs = z.object({});
const UpdateTopicArgs = z.object({ id: z.string().min(1).max(100), body: TopicInput });
const DeleteTopicArgs = z.object({ id: z.string().min(1).max(100) });

/**
 * from [topics.ck](../../data/contracts/topics/topics.ck#L25)
 */
@Injectable()
export class ListTopicsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_topics',
        description: 'Every subject this station has named, for one sort of break or for all of them',
        inputSchema: z.toJSONSchema(ListTopicsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TopicList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ListTopicsArgs.shape.query.unwrap()) } = await parseAndValidate(args, ListTopicsArgs);
        const result = await container.get(TopicsService).list(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [topics.ck](../../data/contracts/topics/topics.ck#L39)
 */
@Injectable()
export class CreateTopicMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_topic',
        description: 'Names a new subject. Nothing uses it until something points at it',
        inputSchema: z.toJSONSchema(CreateTopicArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TopicList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreateTopicArgs);
        const result = await container.get(TopicsService).create(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [topics.ck](../../data/contracts/topics/topics.ck#L59)
 */
@Injectable()
export class ListTopicKindsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_topic_kinds',
        description: "Which sorts of break have subjects, and the form each one's settings are edited with",
        inputSchema: z.toJSONSchema(ListTopicKindsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TopicKindList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(TopicsService).kinds();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [topics.ck](../../data/contracts/topics/topics.ck#L77)
 */
@Injectable()
export class UpdateTopicMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_topic',
        description: 'Rewrites one subject. A break already written keeps the words it was given',
        inputSchema: z.toJSONSchema(UpdateTopicArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TopicList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdateTopicArgs);
        const result = await container.get(TopicsService).update(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [topics.ck](../../data/contracts/topics/topics.ck#L89)
 */
@Injectable()
export class DeleteTopicMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_topic',
        description: 'Removes a subject, and any band on the format clock that asked for it',
        inputSchema: z.toJSONSchema(DeleteTopicArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TopicList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteTopicArgs);
        const result = await container.get(TopicsService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerTopicsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_topics', container.get(ListTopicsMcpTool));
    map.set('create_topic', container.get(CreateTopicMcpTool));
    map.set('list_topic_kinds', container.get(ListTopicKindsMcpTool));
    map.set('update_topic', container.get(UpdateTopicMcpTool));
    map.set('delete_topic', container.get(DeleteTopicMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerTopicsMcpToolClasses(registry: Registry): void {
    registry.register(ListTopicsMcpTool).useClass(ListTopicsMcpTool).asSingleton();
    registry.register(CreateTopicMcpTool).useClass(CreateTopicMcpTool).asSingleton();
    registry.register(ListTopicKindsMcpTool).useClass(ListTopicKindsMcpTool).asSingleton();
    registry.register(UpdateTopicMcpTool).useClass(UpdateTopicMcpTool).asSingleton();
    registry.register(DeleteTopicMcpTool).useClass(DeleteTopicMcpTool).asSingleton();
}
