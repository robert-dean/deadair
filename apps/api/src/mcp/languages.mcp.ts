// Auto-generated MCP tools
// generated from [languages.ck](../../data/contracts/languages/languages.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ConsoleLanguagesService } from '#src/modules/languages/console.languages.service.js';
import { ConsoleLanguageChoice, ConsoleLanguageList, ConsoleLanguagePack } from '../modules/languages/types/languages.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetMyConsoleLanguageArgs = z.object({});
const ChooseMyConsoleLanguageArgs = z.object({ body: ConsoleLanguageChoice });
const ListConsoleLanguagesArgs = z.object({});
const GetConsoleLanguageArgs = z.object({ locale: z.string().min(2).max(35) });
const ImportConsoleLanguageArgs = z.object({ locale: z.string().min(2).max(35), body: ConsoleLanguagePack });
const RemoveConsoleLanguageArgs = z.object({ locale: z.string().min(2).max(35) });

/**
 * from [languages.ck](../../data/contracts/languages/languages.ck#L19)
 */
@Injectable()
export class GetMyConsoleLanguageMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_my_console_language',
        description: 'The language you chose for the console, if you chose one',
        inputSchema: z.toJSONSchema(GetMyConsoleLanguageArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ConsoleLanguageChoice, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(ConsoleLanguagesService).choice();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [languages.ck](../../data/contracts/languages/languages.ck#L35)
 */
@Injectable()
export class ChooseMyConsoleLanguageMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'choose_my_console_language',
        description: 'Chooses the language your console is shown in, or, without one, goes back to following the browser',
        inputSchema: z.toJSONSchema(ChooseMyConsoleLanguageArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ConsoleLanguageChoice, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { body } = await parseAndValidate(args, ChooseMyConsoleLanguageArgs);
        const result = await container.get(ConsoleLanguagesService).choose(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [languages.ck](../../data/contracts/languages/languages.ck#L57)
 */
@Injectable()
export class ListConsoleLanguagesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_console_languages',
        description: 'Every language this station holds a pack for, without the strings',
        inputSchema: z.toJSONSchema(ListConsoleLanguagesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ConsoleLanguageList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': 'none' },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        const result = await container.get(ConsoleLanguagesService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [languages.ck](../../data/contracts/languages/languages.ck#L75)
 */
@Injectable()
export class GetConsoleLanguageMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_console_language',
        description: "One language's pack, strings and all, as it was imported",
        inputSchema: z.toJSONSchema(GetConsoleLanguageArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ConsoleLanguagePack, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': 'none' },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        const { locale } = await parseAndValidate(args, GetConsoleLanguageArgs);
        const result = await container.get(ConsoleLanguagesService).get(locale);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [languages.ck](../../data/contracts/languages/languages.ck#L86)
 */
@Injectable()
export class ImportConsoleLanguageMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'import_console_language',
        description: "Installs a language pack, replacing any pack already installed for the language. The tag in the path must be the pack's own",
        inputSchema: z.toJSONSchema(ImportConsoleLanguageArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ConsoleLanguageList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { locale, body } = await parseAndValidate(args, ImportConsoleLanguageArgs);
        const result = await container.get(ConsoleLanguagesService).import(locale, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [languages.ck](../../data/contracts/languages/languages.ck#L98)
 */
@Injectable()
export class RemoveConsoleLanguageMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'remove_console_language',
        description: 'Removes a language. Anybody who had chosen it sees English',
        inputSchema: z.toJSONSchema(RemoveConsoleLanguageArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ConsoleLanguageList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { locale } = await parseAndValidate(args, RemoveConsoleLanguageArgs);
        const result = await container.get(ConsoleLanguagesService).remove(locale);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerLanguagesMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('get_my_console_language', container.get(GetMyConsoleLanguageMcpTool));
    map.set('choose_my_console_language', container.get(ChooseMyConsoleLanguageMcpTool));
    map.set('list_console_languages', container.get(ListConsoleLanguagesMcpTool));
    map.set('get_console_language', container.get(GetConsoleLanguageMcpTool));
    map.set('import_console_language', container.get(ImportConsoleLanguageMcpTool));
    map.set('remove_console_language', container.get(RemoveConsoleLanguageMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerLanguagesMcpToolClasses(registry: Registry): void {
    registry.register(GetMyConsoleLanguageMcpTool).useClass(GetMyConsoleLanguageMcpTool).asSingleton();
    registry.register(ChooseMyConsoleLanguageMcpTool).useClass(ChooseMyConsoleLanguageMcpTool).asSingleton();
    registry.register(ListConsoleLanguagesMcpTool).useClass(ListConsoleLanguagesMcpTool).asSingleton();
    registry.register(GetConsoleLanguageMcpTool).useClass(GetConsoleLanguageMcpTool).asSingleton();
    registry.register(ImportConsoleLanguageMcpTool).useClass(ImportConsoleLanguageMcpTool).asSingleton();
    registry.register(RemoveConsoleLanguageMcpTool).useClass(RemoveConsoleLanguageMcpTool).asSingleton();
}
