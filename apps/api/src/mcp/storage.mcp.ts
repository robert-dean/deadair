// Auto-generated MCP tools
// generated from [storage.ck](../../data/contracts/storage/storage.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { StorageService } from '#src/modules/storage/storage.service.js';
import { StorageReport } from '../modules/storage/types/storage.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ReadStorageArgs = z.object({});

/**
 * from [storage.ck](../../data/contracts/storage/storage.ck#L25)
 */
@Injectable()
export class ReadStorageMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_storage',
        description: 'What is on disk, per store, against what the database says should be',
        inputSchema: z.toJSONSchema(ReadStorageArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StorageReport, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(StorageService).readStorage();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerStorageMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('read_storage', container.get(ReadStorageMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerStorageMcpToolClasses(registry: Registry): void {
    registry.register(ReadStorageMcpTool).useClass(ReadStorageMcpTool).asSingleton();
}
