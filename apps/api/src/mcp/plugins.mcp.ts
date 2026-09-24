// Auto-generated MCP tools
// generated from [plugins.ck](../../data/contracts/plugins/plugins.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PluginProvidersService } from '#src/modules/plugins/plugin.providers.service.js';
import { PluginsService } from '#src/modules/plugins/plugins.service.js';
import {
    PluginDetail,
    PluginFieldSuggestions,
    PluginGrantList,
    PluginLogLevelInput,
    PluginLogPage,
    PluginLogQuery,
    PluginSummary,
    PluginTestResult,
    ProviderCatalogue,
} from '../modules/plugins/types/plugins.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListPluginsArgs = z.object({});
const ListPluginGrantsArgs = z.object({});
const ListCapabilityProvidersArgs = z.object({});
const RescanPluginsArgs = z.object({});
const GetPluginArgs = z.object({ id: z.string().min(1).max(200) });
const EnablePluginArgs = z.object({ id: z.string().min(1).max(200) });
const DisablePluginArgs = z.object({ id: z.string().min(1).max(200) });
const ReloadPluginArgs = z.object({ id: z.string().min(1).max(200) });
const TestPluginConnectionArgs = z.object({ id: z.string().min(1).max(200) });
const SuggestPluginConfigOptionsArgs = z.object({ id: z.string().min(1).max(200) });
const GetPluginLogsArgs = z.object({ id: z.string().min(1).max(200), query: PluginLogQuery.optional() });
const SetPluginLogLevelArgs = z.object({ id: z.string().min(1).max(200), body: PluginLogLevelInput });

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L29)
 */
@Injectable()
export class ListPluginsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_plugins',
        description: 'Lists every plugin the host knows about',
        inputSchema: z.toJSONSchema(ListPluginsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(z.object({ items: z.array(PluginSummary) }), { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PluginsService).listPlugins();
        const resultJson = JSON.stringify({ items: result });
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L47)
 */
@Injectable()
export class ListPluginGrantsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_plugin_grants',
        description: 'Every capability an installed plugin is asking the operator for, with the answer so far',
        inputSchema: z.toJSONSchema(ListPluginGrantsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginGrantList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PluginsService).listGrants();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L65)
 */
@Injectable()
export class ListCapabilityProvidersMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_capability_providers',
        description: 'Every capability more than one plugin could answer, who can answer it, and in what order the station asks them',
        inputSchema: z.toJSONSchema(ListCapabilityProvidersArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ProviderCatalogue, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PluginProvidersService).listProviders();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L83)
 */
@Injectable()
export class RescanPluginsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'rescan_plugins',
        description: 'Rescans the mounted plugin directory: registers new plugins, unloads removed ones',
        inputSchema: z.toJSONSchema(RescanPluginsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(z.object({ items: z.array(PluginSummary) }), { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(PluginsService).rescanPlugins();
        const resultJson = JSON.stringify({ items: result });
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L122)
 */
@Injectable()
export class GetPluginMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_plugin',
        description: 'One plugin, including its stored non-secret configuration and last error',
        inputSchema: z.toJSONSchema(GetPluginArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetPluginArgs);
        const result = await container.get(PluginsService).getPlugin(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L174)
 */
@Injectable()
export class EnablePluginMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'enable_plugin',
        description: 'Enables a plugin without resubmitting its configuration',
        inputSchema: z.toJSONSchema(EnablePluginArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, EnablePluginArgs);
        const result = await container.get(PluginsService).enablePlugin(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L189)
 */
@Injectable()
export class DisablePluginMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'disable_plugin',
        description: 'Disables a plugin and tears its instance down, keeping its configuration',
        inputSchema: z.toJSONSchema(DisablePluginArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DisablePluginArgs);
        const result = await container.get(PluginsService).disablePlugin(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L223)
 */
@Injectable()
export class ReloadPluginMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'reload_plugin',
        description: "Reapplies the plugin's stored configuration: disposes the running instance and initializes it again",
        inputSchema: z.toJSONSchema(ReloadPluginArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, ReloadPluginArgs);
        const result = await container.get(PluginsService).reloadPlugin(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L238)
 */
@Injectable()
export class TestPluginConnectionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'test_plugin_connection',
        description: "Runs the plugin's own `testConnection()` through the invoker",
        inputSchema: z.toJSONSchema(TestPluginConnectionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginTestResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, TestPluginConnectionArgs);
        const result = await container.get(PluginsService).testPlugin(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L253)
 */
@Injectable()
export class SuggestPluginConfigOptionsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'suggest_plugin_config_options',
        description: 'Asks the plugin what to offer for its config fields right now, through the invoker',
        inputSchema: z.toJSONSchema(SuggestPluginConfigOptionsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginFieldSuggestions, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, SuggestPluginConfigOptionsArgs);
        const result = await container.get(PluginsService).suggestPluginConfigOptions(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L272)
 */
@Injectable()
export class GetPluginLogsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_plugin_logs',
        description: "Returns the plugin's buffered log lines at or above the current log level",
        inputSchema: z.toJSONSchema(GetPluginLogsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginLogPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, query = await parseAndValidate({}, GetPluginLogsArgs.shape.query.unwrap()) } = await parseAndValidate(args, GetPluginLogsArgs);
        const result = await container.get(PluginsService).getPluginLogs(id, query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L306)
 */
@Injectable()
export class SetPluginLogLevelMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_plugin_log_level',
        description: "Sets the minimum severity the plugin's log store retains going forward",
        inputSchema: z.toJSONSchema(SetPluginLogLevelArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PluginDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, SetPluginLogLevelArgs);
        const result = await container.get(PluginsService).setPluginLogLevel(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerPluginsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_plugins', container.get(ListPluginsMcpTool));
    map.set('list_plugin_grants', container.get(ListPluginGrantsMcpTool));
    map.set('list_capability_providers', container.get(ListCapabilityProvidersMcpTool));
    map.set('rescan_plugins', container.get(RescanPluginsMcpTool));
    map.set('get_plugin', container.get(GetPluginMcpTool));
    map.set('enable_plugin', container.get(EnablePluginMcpTool));
    map.set('disable_plugin', container.get(DisablePluginMcpTool));
    map.set('reload_plugin', container.get(ReloadPluginMcpTool));
    map.set('test_plugin_connection', container.get(TestPluginConnectionMcpTool));
    map.set('suggest_plugin_config_options', container.get(SuggestPluginConfigOptionsMcpTool));
    map.set('get_plugin_logs', container.get(GetPluginLogsMcpTool));
    map.set('set_plugin_log_level', container.get(SetPluginLogLevelMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerPluginsMcpToolClasses(registry: Registry): void {
    registry.register(ListPluginsMcpTool).useClass(ListPluginsMcpTool).asSingleton();
    registry.register(ListPluginGrantsMcpTool).useClass(ListPluginGrantsMcpTool).asSingleton();
    registry.register(ListCapabilityProvidersMcpTool).useClass(ListCapabilityProvidersMcpTool).asSingleton();
    registry.register(RescanPluginsMcpTool).useClass(RescanPluginsMcpTool).asSingleton();
    registry.register(GetPluginMcpTool).useClass(GetPluginMcpTool).asSingleton();
    registry.register(EnablePluginMcpTool).useClass(EnablePluginMcpTool).asSingleton();
    registry.register(DisablePluginMcpTool).useClass(DisablePluginMcpTool).asSingleton();
    registry.register(ReloadPluginMcpTool).useClass(ReloadPluginMcpTool).asSingleton();
    registry.register(TestPluginConnectionMcpTool).useClass(TestPluginConnectionMcpTool).asSingleton();
    registry.register(SuggestPluginConfigOptionsMcpTool).useClass(SuggestPluginConfigOptionsMcpTool).asSingleton();
    registry.register(GetPluginLogsMcpTool).useClass(GetPluginLogsMcpTool).asSingleton();
    registry.register(SetPluginLogLevelMcpTool).useClass(SetPluginLogLevelMcpTool).asSingleton();
}
