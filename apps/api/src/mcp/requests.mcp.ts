// Auto-generated MCP tools
// generated from [requests.ck](../../data/contracts/requests/requests.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { RequestsService } from '#src/modules/requests/requests.service.js';
import {
    ListenerRequest,
    ListenerRequestCreate,
    ListenerRequestDecline,
    ListenerRequestList,
    RequestStatus,
    RequestableTrackList,
} from '../modules/requests/types/requests.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const SearchRequestableRecordsArgs = z.object({
    query: z
        .object({
            q: z.string().min(1).max(200).describe('What to look for: a title, an artist, or both'),
            limit: z
                .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(25))
                .optional()
                .describe('How many to answer with. Ten when omitted'),
        })
        .optional(),
});
const ListRequestsArgs = z.object({ query: z.object({ status: RequestStatus.optional().describe('Only requests in this state') }).optional() });
const CreateRequestArgs = z.object({ body: ListenerRequestCreate });
const ListMyRequestsArgs = z.object({});
const GrantRequestArgs = z.object({ id: z.uuid() });
const DeclineRequestArgs = z.object({ id: z.uuid(), body: ListenerRequestDecline });

/**
 * from [requests.ck](../../data/contracts/requests/requests.ck#L17)
 */
@Injectable()
export class SearchRequestableRecordsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'search_requestable_records',
        description: 'Records the station could be asked to play, matching a title or an artist',
        inputSchema: z.toJSONSchema(SearchRequestableRecordsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(RequestableTrackList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, SearchRequestableRecordsArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            SearchRequestableRecordsArgs,
        );
        const result = await container.get(RequestsService).search(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [requests.ck](../../data/contracts/requests/requests.ck#L33)
 */
@Injectable()
export class ListRequestsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_requests',
        description: 'Every recent request, for the operator deciding on them',
        inputSchema: z.toJSONSchema(ListRequestsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ListenerRequestList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { query = await parseAndValidate({}, ListRequestsArgs.shape.query.unwrap()) } = await parseAndValidate(args, ListRequestsArgs);
        const result = await container.get(RequestsService).list(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [requests.ck](../../data/contracts/requests/requests.ck#L48)
 */
@Injectable()
export class CreateRequestMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_request',
        description: 'Ask the station to play a record. Answers with the request whatever became of it, so a refusal says why in `reason`',
        inputSchema: z.toJSONSchema(CreateRequestArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ListenerRequest, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { body } = await parseAndValidate(args, CreateRequestArgs);
        const result = await container.get(RequestsService).create(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [requests.ck](../../data/contracts/requests/requests.ck#L63)
 */
@Injectable()
export class ListMyRequestsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_my_requests',
        description: "The signed-in account's own recent requests",
        inputSchema: z.toJSONSchema(ListMyRequestsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ListenerRequestList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(RequestsService).mine();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [requests.ck](../../data/contracts/requests/requests.ck#L78)
 */
@Injectable()
export class GrantRequestMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'grant_request',
        description: 'Let a waiting request through. It goes into the running order once its audio is here',
        inputSchema: z.toJSONSchema(GrantRequestArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ListenerRequest, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, GrantRequestArgs);
        const result = await container.get(RequestsService).grant(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [requests.ck](../../data/contracts/requests/requests.ck#L96)
 */
@Injectable()
export class DeclineRequestMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'decline_request',
        description: 'Turn a request down. One already in the running order is left there; take it out of the order instead',
        inputSchema: z.toJSONSchema(DeclineRequestArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ListenerRequest, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, DeclineRequestArgs);
        const result = await container.get(RequestsService).decline(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerRequestsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('search_requestable_records', container.get(SearchRequestableRecordsMcpTool));
    map.set('list_requests', container.get(ListRequestsMcpTool));
    map.set('create_request', container.get(CreateRequestMcpTool));
    map.set('list_my_requests', container.get(ListMyRequestsMcpTool));
    map.set('grant_request', container.get(GrantRequestMcpTool));
    map.set('decline_request', container.get(DeclineRequestMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerRequestsMcpToolClasses(registry: Registry): void {
    registry.register(SearchRequestableRecordsMcpTool).useClass(SearchRequestableRecordsMcpTool).asSingleton();
    registry.register(ListRequestsMcpTool).useClass(ListRequestsMcpTool).asSingleton();
    registry.register(CreateRequestMcpTool).useClass(CreateRequestMcpTool).asSingleton();
    registry.register(ListMyRequestsMcpTool).useClass(ListMyRequestsMcpTool).asSingleton();
    registry.register(GrantRequestMcpTool).useClass(GrantRequestMcpTool).asSingleton();
    registry.register(DeclineRequestMcpTool).useClass(DeclineRequestMcpTool).asSingleton();
}
