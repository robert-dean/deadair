// Auto-generated MCP tools
// generated from [messaging.ck](../../data/contracts/messaging/messaging.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { MessagingLinksService } from '#src/modules/messaging/messaging.links.service.js';
import { MessagingLinkList } from '../modules/messaging/types/messaging.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListMessagingLinksArgs = z.object({});
const RemoveMessagingLinkArgs = z.object({ pluginId: z.string().max(200), platformUserId: z.string().max(200) });

/**
 * from [messaging.ck](../../data/contracts/messaging/messaging.ck#L18)
 */
@Injectable()
export class ListMessagingLinksMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_messaging_links',
        description: 'The chat accounts linked to the signed-in account',
        inputSchema: z.toJSONSchema(ListMessagingLinksArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(MessagingLinkList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(MessagingLinksService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [messaging.ck](../../data/contracts/messaging/messaging.ck#L47)
 */
@Injectable()
export class RemoveMessagingLinkMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'remove_messaging_link',
        description: 'Unlink a chat account. Its operator commands are refused from the next one on',
        inputSchema: z.toJSONSchema(RemoveMessagingLinkArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { pluginId, platformUserId } = await parseAndValidate(args, RemoveMessagingLinkArgs);
        await container.get(MessagingLinksService).remove(pluginId, platformUserId);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerMessagingMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_messaging_links', container.get(ListMessagingLinksMcpTool));
    map.set('remove_messaging_link', container.get(RemoveMessagingLinkMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerMessagingMcpToolClasses(registry: Registry): void {
    registry.register(ListMessagingLinksMcpTool).useClass(ListMessagingLinksMcpTool).asSingleton();
    registry.register(RemoveMessagingLinkMcpTool).useClass(RemoveMessagingLinkMcpTool).asSingleton();
}
