// Auto-generated MCP tools
// generated from [settings.ck](../../data/contracts/settings/settings.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { SettingsService } from '#src/modules/settings/settings.service.js';
import { StationSettings } from '../modules/settings/types/settings.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetSettingsArgs = z.object({});

/**
 * from [settings.ck](../../data/contracts/settings/settings.ck#L27)
 */
@Injectable()
export class GetSettingsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_settings',
        description: 'Every station setting, its descriptor and its current value',
        inputSchema: z.toJSONSchema(GetSettingsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(StationSettings, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(SettingsService).read();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerSettingsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('get_settings', container.get(GetSettingsMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerSettingsMcpToolClasses(registry: Registry): void {
    registry.register(GetSettingsMcpTool).useClass(GetSettingsMcpTool).asSingleton();
}
